import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RunBadge } from '@/components/RunBadge';
import { ScreenHeader } from '@/components/ScreenHeader';
import { radius, useTheme } from '@/components/theme';
import { ActionSheet, Banner, Chip, EmptyState, Icon, PromptModal, Skeleton, type SheetAction } from '@/components/ui';
import { groupSessions, relativeTime, sessionTitle, sourceLabel } from '@/lib/format';
import { isAuthError } from '@/lib/connect';
import { attempt } from '@/lib/guard';
import { haptic } from '@/lib/haptics';
import type { TrackedRun } from '@/lib/storage';
import { isTerminal, type Session } from '@/lib/types';
import { useHermes } from '@/state/HermesContext';

type Filter = 'all' | 'attention' | 'pinned' | 'routines' | 'archived';
const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: 'All' }, { key: 'attention', label: 'Needs you' }, { key: 'pinned', label: 'Pinned' },
  { key: 'routines', label: 'Routines' }, { key: 'archived', label: 'Archived' },
];
const SUGGESTIONS = [
  'Check disk usage and what is running on this server',
  'Research today’s top AI news and give me 5 bullet points',
  'Write a small Python script to rename photos by date, and test it',
];
const REFRESH_MS = 10_000;

const needsYou = (r?: TrackedRun) => !!r && (r.status === 'waiting_for_approval' || r.status === 'failed' || r.status === 'interrupted' || (isTerminal(r.status) && !!r.unread));
const isActive = (r?: TrackedRun) => !!r && !isTerminal(r.status);

export default function TasksScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, runs, forgetRun, online } = useHermes();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [menuFor, setMenuFor] = useState<Session | null>(null);
  const [renaming, setRenaming] = useState<Session | null>(null);
  const inflight = useRef(false);

  const load = useCallback(async () => {
    if (!client || inflight.current) return;
    inflight.current = true;
    try {
      const { data } = await client.listSessions(150);
      setSessions(data.filter((s) => !s.hidden && !s.is_internal_child));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      inflight.current = false;
      setRefreshing(false);
    }
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      load();
      const id = setInterval(load, REFRESH_MS);
      return () => clearInterval(id);
    }, [load]),
  );

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    let rows = (sessions ?? []).filter((s) => (filter === 'archived' ? !!s.archived : !s.archived));
    if (filter === 'attention') rows = rows.filter((s) => needsYou(runs[s.id]) || isActive(runs[s.id]));
    if (filter === 'pinned') rows = rows.filter((s) => s.pinned);
    if (filter === 'routines') rows = rows.filter((s) => s.source === 'cron');
    if (q) rows = rows.filter((s) => `${s.title ?? ''} ${s.preview ?? ''}`.toLowerCase().includes(q));
    const attention = new Set(filter === 'all' ? rows.filter((s) => needsYou(runs[s.id]) || isActive(runs[s.id])).map((s) => s.id) : []);
    return groupSessions(rows, attention);
  }, [sessions, runs, query, filter]);

  const open = (id: string, prefill?: string) => router.push({ pathname: '/session/[id]', params: prefill ? { id, prefill } : { id } });

  const newTask = async (prefill?: string) => {
    if (!client || creating) return;
    haptic.press();
    setCreating(true);
    try {
      const s = await client.createSession();
      open(s.id, prefill);
    } catch (e: any) {
      Alert.alert('Could not start a task', e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  };

  const del = (s: Session) =>
    Alert.alert('Delete this task?', sessionTitle(s), [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await attempt('Could not delete', async () => { await client!.deleteSession(s.id); forgetRun(s.id); }); load(); } },
    ]);

  const actions: SheetAction[] = menuFor
    ? [
        { label: 'Rename', icon: 'pencil-outline', onPress: () => setRenaming(menuFor) },
        { label: menuFor.pinned ? 'Unpin' : 'Pin to top', icon: 'pin-outline', onPress: async () => { await attempt('Could not update', () => client!.patchSession(menuFor.id, { pinned: !menuFor.pinned })); load(); } },
        { label: menuFor.archived ? 'Unarchive' : 'Archive', icon: menuFor.archived ? 'arrow-undo-outline' : 'archive-outline', onPress: async () => { await attempt('Could not update', async () => { await client!.patchSession(menuFor.id, { archived: !menuFor.archived }); forgetRun(menuFor.id); }); load(); } },
        { label: 'Delete', icon: 'trash-outline', onPress: () => del(menuFor), destructive: true },
      ]
    : [];

  const attentionCount = Object.values(runs).filter(needsYou).length;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="Tasks" subtitle={attentionCount ? `${attentionCount} need${attentionCount === 1 ? 's' : ''} you` : 'Everything Hermes is working on'} />
      {!online && <Banner tone="danger" text="Can’t reach Hermes. Check that Tailscale is on." />}
      <View style={[styles.search, { backgroundColor: t.card, borderColor: t.border }]}>
        <Icon name="search" size={18} color={t.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search tasks" placeholderTextColor={t.muted} style={{ flex: 1, color: t.text, fontSize: 15, paddingVertical: 10 }} accessibilityLabel="Search tasks" />
        {!!query && <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel="Clear search"><Icon name="close-circle" size={18} color={t.muted} /></Pressable>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={styles.filters}>
        {FILTERS.map((f) => {
          const urgent = f.key === 'attention' && attentionCount > 0;
          return <Chip key={f.key} label={urgent ? `${f.label} · ${attentionCount}` : f.label} tone={urgent && filter !== f.key ? 'warn' : undefined} active={filter === f.key} onPress={() => setFilter(f.key)} />;
        })}
      </ScrollView>

      {sessions === null && !error ? <Skeleton /> : (
        <SectionList
          sections={groups}
          keyExtractor={(s) => s.id}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => <Text style={[styles.group, { color: t.muted }]}>{section.title.toUpperCase()}</Text>}
          renderItem={({ item }) => <TaskRow s={item} run={runs[item.id]} onPress={() => open(item.id)} onLongPress={() => { haptic.press(); setMenuFor(item); }} />}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={t.accent} />}
          contentContainerStyle={{ paddingBottom: 110 + insets.bottom, flexGrow: 1 }}
          ListEmptyComponent={
            error && isAuthError(error) ? <EmptyState icon="key-outline" title="This phone’s key was rejected" body="The server is reachable, but the API key is wrong or was rotated. Paste the new one." action="Update key" onAction={() => router.push('/connect')} />
            : error ? <EmptyState icon="cloud-offline-outline" title="Can’t load tasks" body={error} action="Retry" onAction={load} />
            : query || filter !== 'all' ? <EmptyState icon="search-outline" title="Nothing here" body="No tasks match this filter." />
            : (
              <View>
                <EmptyState icon="chatbubbles-outline" title="Start your first task" body="Hermes keeps working when you close the app. Pick an idea or write your own." />
                <View style={{ paddingHorizontal: 16, gap: 8 }}>
                  {SUGGESTIONS.map((s) => (
                    <Pressable key={s} onPress={() => newTask(s)} accessibilityRole="button" style={({ pressed }) => [styles.suggest, { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.7 : 1 }]}>
                      <Icon name="sparkles-outline" size={16} color={t.accent} />
                      <Text style={{ color: t.text, flex: 1, fontSize: 14 }}>{s}</Text>
                    </Pressable>
                  ))}
                </View>
              </View>
            )
          }
        />
      )}

      <Pressable onPress={() => newTask()} disabled={creating} accessibilityRole="button" accessibilityLabel="New task"
        style={({ pressed }) => [styles.fab, { backgroundColor: t.accent, bottom: 20, opacity: pressed || creating ? 0.8 : 1 }]}>
        {creating ? <ActivityIndicator color={t.accentText} /> : <><Icon name="add" size={24} color={t.accentText} /><Text style={{ color: t.accentText, fontWeight: '700', fontSize: 15 }}>New task</Text></>}
      </Pressable>

      <ActionSheet visible={!!menuFor} onClose={() => setMenuFor(null)} title={menuFor ? sessionTitle(menuFor) : undefined} actions={actions} />
      <PromptModal visible={!!renaming} title="Rename task" initial={renaming ? sessionTitle(renaming) : ''} onCancel={() => setRenaming(null)}
        onSubmit={async (title) => { const s = renaming; setRenaming(null); if (s) { await attempt('Could not rename', () => client!.patchSession(s.id, { title })); load(); } }} />
    </View>
  );
}

const TaskRow = memo(function TaskRow({ s, run, onPress, onLongPress }: { s: Session; run?: TrackedRun; onPress: () => void; onLongPress: () => void }) {
  const t = useTheme();
  const unread = !!run?.unread;
  const src = sourceLabel(s.source);
  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} accessibilityRole="button" accessibilityLabel={sessionTitle(s)}
      style={({ pressed }) => [styles.row, { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.75 : 1 }]}>
      <View style={{ flex: 1, gap: 3 }}>
        <View style={styles.titleLine}>
          <Text numberOfLines={1} style={{ color: t.text, fontSize: 15.5, fontWeight: unread ? '800' : '600', flex: 1 }}>{sessionTitle(s)}</Text>
          {s.pinned && <Icon name="pin" size={14} color={t.accent} />}
          <Text style={{ color: t.muted, fontSize: 12 }}>{relativeTime(s.last_active ?? s.started_at)}</Text>
        </View>
        {!!s.preview && s.preview !== s.title && <Text numberOfLines={1} style={{ color: t.muted, fontSize: 13.5 }}>{s.preview}</Text>}
        <View style={styles.metaLine}>
          <RunBadge run={run} />
          {!!src && <Chip label={src} icon={s.source === 'cron' ? 'timer-outline' : 'desktop-outline'} />}
        </View>
      </View>
    </Pressable>
  );
});

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  filters: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  group: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 6 },
  row: { marginHorizontal: 16, marginBottom: 8, padding: 14, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaLine: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 4 },
  suggest: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  fab: { position: 'absolute', right: 16, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, height: 52, borderRadius: 26, elevation: 5, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
});
