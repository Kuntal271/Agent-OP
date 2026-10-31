import { Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ApprovalCard, ClarifyCard, LiveBlock } from '@/components/LiveRun';
import { MessageItem } from '@/components/MessageItem';
import { useTheme } from '@/components/theme';
import { messageText, sessionTitle, visibleMessages } from '@/lib/format';
import { newIdempotencyKey } from '@/lib/storage';
import type { Message, Session } from '@/lib/types';
import { useHermes } from '@/state/HermesContext';
import { useLiveRun } from '@/state/useLiveRun';

const STATUS_LABEL: Record<string, string> = {
  started: 'Starting…', queued: 'Queued…', running: 'Working…', stopping: 'Stopping…', waiting_for_approval: 'Waiting for your approval',
};

export default function SessionScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const sessionId = String(id);
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { client, trackRun, updateRun } = useHermes();
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const fetchChat = useCallback(
    () => Promise.all([client!.getSession(sessionId), client!.getMessages(sessionId)]),
    [client, sessionId],
  );
  const reload = useCallback(async () => {
    if (!client) return;
    try {
      const [s, m] = await fetchChat();
      setSession(s);
      setMessages(m);
      setLoadError(null);
    } catch (e: any) {
      setLoadError(e?.message ?? String(e));
    }
  }, [client, fetchChat]);

  const { run, active, live, setLive } = useLiveRun(sessionId, reload);
  useEffect(() => {
    if (!client) return;
    let gone = false;
    fetchChat()
      .then(([s, m]) => { if (!gone) { setSession(s); setMessages(m); setLoadError(null); } })
      .catch((e) => { if (!gone) setLoadError(e?.message ?? String(e)); });
    return () => { gone = true; };
  }, [client, fetchChat]);

  // While a turn runs, its partial transcript rows are shown by the live block instead.
  const pendingInput = active ? run?.input?.trim() : undefined;
  const shown = useMemo(() => {
    let rows = visibleMessages(messages ?? []);
    if (pendingInput) {
      const i = rows.map((m) => m.role === 'user' && messageText(m.content).trim() === pendingInput).lastIndexOf(true);
      rows = i >= 0 ? rows.slice(0, i + 1) : [...rows, { role: 'user', content: pendingInput, id: 'pending' }];
    }
    return rows;
  }, [messages, pendingInput]);

  const send = async () => {
    const text = draft.trim();
    if (!text || !client || sending) return;
    setSending(true);
    try {
      if (active && run) {
        await client.steerRun(run.runId, text); // guide the running turn instead of queueing a new one
        setLive((l) => ({ ...l, text: `${l.text}\n\n↪ You steered: ${text}\n\n` }));
      } else {
        const r = await client.startRun(sessionId, text, newIdempotencyKey());
        const now = Date.now();
        trackRun({ runId: r.run_id, sessionId, status: r.status || 'started', input: text, startedAt: now, updatedAt: now });
      }
      setDraft('');
    } catch (e: any) {
      Alert.alert(active ? 'Steer failed' : 'Send failed', e?.message ?? String(e));
    } finally {
      setSending(false);
    }
  };

  const stop = async () => {
    if (!client || !run) return;
    try {
      await client.stopRun(run.runId);
      updateRun(sessionId, { status: 'stopping' });
    } catch (e: any) {
      Alert.alert('Stop failed', e?.message ?? String(e));
    }
  };

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
        <Text style={{ color: t.danger, fontSize: 13 }}>Last turn {run.status}{run.error ? `: ${run.error}` : ''}</Text>
      )}
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}>
      <Stack.Screen options={{ title: session ? sessionTitle(session) : '' }} />
      {messages === null ? (
        <View style={styles.center}>{loadError ? <Text style={{ color: t.danger, padding: 20 }}>{loadError}</Text> : <ActivityIndicator />}</View>
      ) : (
        <FlatList
          inverted
          data={[...shown].reverse()}
          keyExtractor={(m, i) => String(m.id ?? `i${i}`)}
          renderItem={({ item }) => <MessageItem m={item} />}
          ListHeaderComponent={footer}
          ListEmptyComponent={!active ? <Text style={[styles.empty, { color: t.muted }]}>What should Hermes work on?</Text> : undefined}
          contentContainerStyle={{ padding: 12, gap: 10 }}
          keyboardShouldPersistTaps="handled"
        />
      )}
      <View style={[styles.composer, { borderColor: t.border, backgroundColor: t.card, paddingBottom: 8 + insets.bottom }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={active ? 'Steer the running task…' : 'Message Hermes'}
          placeholderTextColor={t.muted}
          multiline
          style={[styles.input, { color: t.text, backgroundColor: t.bg, borderColor: t.border }]}
        />
        {active && (
          <Pressable onPress={stop} style={({ pressed }) => [styles.btn, { borderColor: t.danger, borderWidth: 1, opacity: pressed ? 0.7 : 1 }]}>
            <Text style={{ color: t.danger, fontWeight: '700' }}>Stop</Text>
          </Pressable>
        )}
        <Pressable onPress={send} disabled={sending || !draft.trim()} style={({ pressed }) => [styles.btn, { backgroundColor: t.accent, opacity: pressed || sending || !draft.trim() ? 0.6 : 1 }]}>
          {sending ? <ActivityIndicator color={t.accentText} /> : <Text style={{ color: t.accentText, fontWeight: '700' }}>{active ? 'Steer' : 'Send'}</Text>}
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  empty: { textAlign: 'center', marginVertical: 40, fontSize: 15, transform: [{ scaleY: -1 }] },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, maxHeight: 140, minHeight: 42, borderWidth: 1, borderRadius: 20, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10, fontSize: 15 },
  btn: { height: 42, paddingHorizontal: 16, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
});
