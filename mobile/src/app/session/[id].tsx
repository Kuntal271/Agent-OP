import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Composer } from '@/components/Composer';
import { ApprovalCard, ClarifyCard, LiveBlock } from '@/components/LiveRun';
import { MessageItem } from '@/components/MessageItem';
import { ModelPicker } from '@/components/ModelPicker';
import { useTheme } from '@/components/theme';
import { ActionSheet, Banner, Button, EmptyState, Icon, IconButton, PromptModal, type SheetAction } from '@/components/ui';
import type { Attachment } from '@/lib/attachments';
import { messageText, prettyModel, sessionTitle, sourceLabel, compactNumber, visibleMessages } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { newIdempotencyKey } from '@/lib/storage';
import type { ChatInput, Message, Session } from '@/lib/types';
import { speak, stopSpeaking } from '@/lib/voice';
import { useHermes } from '@/state/HermesContext';
import { useSettings } from '@/state/SettingsContext';
import { useLiveRun } from '@/state/useLiveRun';

const STATUS_LABEL: Record<string, string> = {
  started: 'Starting…', queued: 'Queued…', running: 'Working…', stopping: 'Stopping…', waiting_for_approval: 'Waiting for your approval',
};
const DEFAULT_IMAGE_PROMPT = 'What do you see in this image?';

export default function SessionScreen() {
  const { id, prefill } = useLocalSearchParams<{ id: string; prefill?: string }>();
  const sessionId = String(id);
  const t = useTheme();
  const router = useRouter();
  const { client, trackRun, updateRun, online } = useHermes();
  const { settings, setSessionModel } = useSettings();

  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [menu, setMenu] = useState(false);
  const [picker, setPicker] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [picked, setPicked] = useState<{ m: Message; text: string } | null>(null);
  const [showJump, setShowJump] = useState(false);
  const [branching, setBranching] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  const chosen = settings.sessionModels[sessionId] ?? settings.defaultModel ?? null;

  const fetchChat = useCallback(() => Promise.all([client!.getSession(sessionId), client!.getMessages(sessionId)]), [client, sessionId]);
  const reload = useCallback(async () => {
    if (!client) return null;
    try {
      const [s, m] = await fetchChat();
      setSession(s);
      setMessages(m);
      setLoadError(null);
      return m;
    } catch (e: any) {
      setLoadError(e?.message ?? String(e));
      return null;
    }
  }, [client, fetchChat]);

  const onFinished = useCallback(async () => {
    const m = await reload();
    haptic.success();
    if (m && settings.readAloud) {
      const last = [...visibleMessages(m)].reverse().find((x) => x.role === 'assistant' && messageText(x.content).trim());
      if (last) speak(messageText(last.content));
    }
  }, [reload, settings.readAloud]);

  const { run, active, live, setLive } = useLiveRun(sessionId, onFinished);

  useEffect(() => {
    if (!client) return;
    let gone = false;
    fetchChat()
      .then(([s, m]) => { if (!gone) { setSession(s); setMessages(m); setLoadError(null); } })
      .catch((e) => { if (!gone) setLoadError(e?.message ?? String(e)); });
    return () => { gone = true; stopSpeaking(); };
  }, [client, fetchChat]);

  // While a turn runs, its partial transcript rows are shown by the live block instead.
  const pendingInput = active ? run?.input?.trim() : undefined;
  const shown = useMemo(() => {
    let rows = visibleMessages(messages ?? []);
    if (pendingInput) {
      const same = (m: Message) => m.role === 'user' && messageText(m.content).replace(/\n?\[image\]/g, '').trim() === pendingInput;
      const i = rows.map(same).lastIndexOf(true);
      rows = i >= 0 ? rows.slice(0, i + 1) : [...rows, { role: 'user', content: pendingInput, id: 'pending' }];
    }
    return rows;
  }, [messages, pendingInput]);

  const lastUserId = useMemo(() => [...shown].reverse().find((m) => m.role === 'user')?.id, [shown]);
  const foreign = !!session?.source && session.source !== 'api_server';

  const send = useCallback(
    async (text: string, atts: Attachment[]): Promise<boolean> => {
      if (!client) return false;
      try {
        if (active && run) {
          if (atts.length) {
            Alert.alert('Wait for this task to finish', 'Images can only be added when you start a new message.');
            return false;
          }
          await client.steerRun(run.runId, text); // guide the running turn instead of queueing a new one
          setLive((l) => ({ ...l, text: `${l.text}\n\n↪ You steered: ${text}\n\n` }));
          return true;
        }
        const sent = text || DEFAULT_IMAGE_PROMPT;
        const input: ChatInput = atts.length
          ? [{ type: 'text', text: sent }, ...atts.map((a) => ({ type: 'image_url' as const, image_url: { url: a.dataUrl } }))]
          : sent;
        const r = await client.startRun(sessionId, input, newIdempotencyKey(), chosen);
        const now = Date.now();
        trackRun({ runId: r.run_id, sessionId, status: r.status || 'started', input: sent, startedAt: now, updatedAt: now });
        return true;
      } catch (e: any) {
        haptic.error();
        Alert.alert(active ? 'Steer failed' : 'Send failed', e?.message ?? String(e));
        return false;
      }
    },
    [client, active, run, sessionId, chosen, trackRun, setLive],
  );

  const stop = async () => {
    if (!client || !run) return;
    try {
      await client.stopRun(run.runId);
      updateRun(sessionId, { status: 'stopping' });
    } catch (e: any) {
      Alert.alert('Stop failed', e?.message ?? String(e));
    }
  };

  const branch = async () => {
    if (!client || branching) return;
    setBranching(true);
    try {
      const copy = await client.forkSession(sessionId);
      router.replace({ pathname: '/session/[id]', params: { id: copy.id } });
    } catch (e: any) {
      Alert.alert('Could not branch', e?.message ?? String(e));
    } finally {
      setBranching(false);
    }
  };

  const copyTranscript = async () => {
    const text = shown
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `${m.role === 'user' ? 'You' : 'Hermes'}:\n${messageText(m.content).trim()}`)
      .filter((x) => x.length > 8)
      .join('\n\n');
    await Clipboard.setStringAsync(text);
    haptic.success();
  };

  const remove = () =>
    Alert.alert('Delete this task?', 'The conversation is removed from the server too.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await client?.deleteSession(sessionId).catch(() => {}); router.back(); } },
    ]);

  const details = () =>
    Alert.alert(
      'Task details',
      [
        `Model: ${prettyModel(chosen?.model ?? session?.model)}`,
        `Messages: ${session?.message_count ?? shown.length}`,
        `Tokens: ${compactNumber(session?.input_tokens)} in · ${compactNumber(session?.output_tokens)} out`,
        `Tool calls: ${session?.tool_call_count ?? 0}`,
        session?.source ? `Source: ${sourceLabel(session.source) ?? 'Hermes mobile'}` : '',
        `ID: ${sessionId}`,
      ].filter(Boolean).join('\n'),
    );

  const menuActions: SheetAction[] = [
    { label: 'Rename', icon: 'pencil-outline', onPress: () => setRenaming(true) },
    { label: 'Change model', icon: 'hardware-chip-outline', onPress: () => setPicker(true), hidden: foreign },
    { label: 'Branch into a new task', icon: 'git-branch-outline', onPress: branch },
    { label: session?.pinned ? 'Unpin' : 'Pin to top', icon: 'pin-outline', onPress: async () => { const s = await client?.patchSession(sessionId, { pinned: !session?.pinned }); if (s) setSession(s); } },
    { label: 'Copy conversation', icon: 'copy-outline', onPress: copyTranscript },
    { label: 'Task details', icon: 'information-circle-outline', onPress: details },
    { label: 'Archive', icon: 'archive-outline', onPress: async () => { await client?.patchSession(sessionId, { archived: true }); router.back(); } },
    { label: 'Delete', icon: 'trash-outline', onPress: remove, destructive: true },
  ];

  const msgActions: SheetAction[] = picked
    ? [
        { label: 'Copy text', icon: 'copy-outline', onPress: async () => { await Clipboard.setStringAsync(picked.text); haptic.success(); } },
        { label: 'Read aloud', icon: 'volume-high-outline', onPress: () => speak(picked.text), hidden: picked.m.role !== 'assistant' },
        { label: 'Retry this message', icon: 'refresh-outline', onPress: () => { send(picked.text, []); }, hidden: picked.m.role !== 'user' || picked.m.id !== lastUserId || active || foreign },
      ]
    : [];

  const footer = (
    <View style={{ gap: 10, paddingTop: 6 }}>
      {active && <LiveBlock text={live.text} activity={live.activity} statusLabel={STATUS_LABEL[run!.status] ?? 'Working…'} />}
      {live.approval && run && (
        <ApprovalCard ev={live.approval} onChoose={async (c) => { await client!.respondApproval(run.runId, c, live.approval!); setLive((l) => ({ ...l, approval: null })); }} />
      )}
      {live.clarify && run && (
        <ClarifyCard ev={live.clarify} onAnswer={async (a) => { await client!.respondClarify(run.runId, a, live.clarify!); setLive((l) => ({ ...l, clarify: null })); }} />
      )}
      {!active && run && (run.status === 'failed' || run.status === 'interrupted') && (
        <Banner tone="danger" text={`Last turn ${run.status}${run.error ? `: ${run.error}` : ''}`} />
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.bg }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen
        options={{
          title: session ? sessionTitle(session) : '',
          headerRight: () => <IconButton name="ellipsis-horizontal" label="Task menu" onPress={() => setMenu(true)} />,
        }}
      />
      {!online && <Banner tone="danger" text="Can’t reach Hermes. Check that Tailscale is on." />}
      <View style={{ flex: 1 }}>
        {messages === null ? (
          <View style={styles.center}>{loadError ? <EmptyState icon="cloud-offline-outline" title="Couldn’t load this task" body={loadError} action="Retry" onAction={reload} /> : <ActivityIndicator />}</View>
        ) : (
          <FlatList
            ref={listRef}
            inverted
            data={[...shown].reverse()}
            keyExtractor={(m, i) => String(m.id ?? `i${i}`)}
            renderItem={({ item }) => <MessageItem m={item} onLongPress={(m, text) => setPicked({ m, text })} />}
            ListHeaderComponent={footer}
            ListEmptyComponent={!active ? <View style={{ transform: [{ scaleY: -1 }] }}><EmptyState icon="sparkles-outline" title="What should Hermes work on?" body="Describe a task, attach a photo, or tap the mic and talk." /></View> : undefined}
            contentContainerStyle={{ padding: 12, gap: 10 }}
            keyboardShouldPersistTaps="handled"
            scrollEventThrottle={100}
            onScroll={(e) => setShowJump(e.nativeEvent.contentOffset.y > 500)}
            refreshing={false}
          />
        )}
        {showJump && (
          <Pressable accessibilityRole="button" accessibilityLabel="Jump to latest" style={[styles.jump, { backgroundColor: t.card, borderColor: t.border }]}
            onPress={() => { haptic.tap(); listRef.current?.scrollToOffset({ offset: 0, animated: true }); }}>
            <Icon name="arrow-down" size={18} color={t.text} />
          </Pressable>
        )}
      </View>

      {foreign ? (
        <View style={[styles.foreign, { backgroundColor: t.card, borderColor: t.border }]}>
          <Text style={{ color: t.muted, fontSize: 13, textAlign: 'center' }}>
            This task came from {sourceLabel(session?.source)}. You can read it here; branch it to continue from your phone.
          </Text>
          <Button title="Branch & continue" icon="git-branch-outline" onPress={branch} loading={branching} />
        </View>
      ) : (
        <Composer onSend={send} onStop={stop} active={active} modelLabel={chosen?.model ?? session?.model} onModelPress={() => setPicker(true)} initialText={typeof prefill === 'string' ? prefill : ''} />
      )}

      <ActionSheet visible={menu} onClose={() => setMenu(false)} title={session ? sessionTitle(session) : 'Task'} actions={menuActions} />
      <ActionSheet visible={!!picked} onClose={() => setPicked(null)} actions={msgActions} />
      <ModelPicker visible={picker} onClose={() => setPicker(false)} value={chosen} serverModel={session?.model} onSelect={(c) => setSessionModel(sessionId, c)} />
      <PromptModal visible={renaming} title="Rename task" initial={session ? sessionTitle(session) : ''} onCancel={() => setRenaming(false)}
        onSubmit={async (title) => { setRenaming(false); const s = await client?.patchSession(sessionId, { title }).catch(() => null); if (s) setSession(s); }} />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  jump: { position: 'absolute', right: 14, bottom: 14, width: 40, height: 40, borderRadius: 20, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', elevation: 3 },
  foreign: { padding: 14, gap: 10, borderTopWidth: StyleSheet.hairlineWidth },
});
