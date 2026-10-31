import { Link, Redirect, router, Stack, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { RunBadge } from '@/components/RunBadge';
import { useTheme } from '@/components/theme';
import { relativeTime, sessionTitle } from '@/lib/format';
import type { Session } from '@/lib/types';
import { isTerminal } from '@/lib/types';
import { useHermes } from '@/state/HermesContext';

const REFRESH_MS = 10_000;

export default function TasksScreen() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { ready, config, client, runs, forgetRun } = useHermes();
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState(false);
  const inflight = useRef(false);

  const load = useCallback(async () => {
    if (!client || inflight.current) return;
    inflight.current = true;
    try {
      const { data } = await client.listSessions(100);
      setSessions(data.filter((s) => !s.archived && !s.hidden && !s.is_internal_child));
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      inflight.current = false;
    }
  }, [client]);

  useFocusEffect(
    useCallback(() => {
      load();
      const id = setInterval(load, REFRESH_MS);
      return () => clearInterval(id);
    }, [load]),
  );

  // Running/attention tasks first, then pinned, then most recent activity.
  const ordered = useMemo(() => {
    const rank = (s: Session) => {
      const r = runs[s.id];
      if (r && !isTerminal(r.status)) return 0;
      if (s.pinned) return 1;
      return 2;
    };
    return [...(sessions ?? [])].sort((a, b) => rank(a) - rank(b) || (b.last_active ?? b.started_at ?? 0) - (a.last_active ?? a.started_at ?? 0));
  }, [sessions, runs]);

  if (!ready) return <Center><ActivityIndicator /></Center>;
  if (!config) return <Redirect href="/connect" />;

  const newTask = async () => {
    if (!client) return;
    setCreating(true);
    try {
      const s = await client.createSession();
      router.push({ pathname: '/session/[id]', params: { id: s.id } });
    } catch (e: any) {
      Alert.alert('Could not start a task', e?.message ?? String(e));
    } finally {
      setCreating(false);
    }
  };

  const manage = (s: Session) => {
    Alert.alert(sessionTitle(s), undefined, [
      { text: s.pinned ? 'Unpin' : 'Pin', onPress: () => client?.patchSession(s.id, { pinned: !s.pinned }).then(load) },
      { text: 'Archive', onPress: () => client?.patchSession(s.id, { archived: true }).then(() => { forgetRun(s.id); load(); }) },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Delete this task?', 'Its transcript is removed from Hermes.', [
            { text: 'Cancel', style: 'cancel' },
            { text: 'Delete', style: 'destructive', onPress: () => client?.deleteSession(s.id).then(() => { forgetRun(s.id); load(); }).catch((e) => Alert.alert('Delete failed', e.message)) },
          ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen
        options={{
          headerRight: () => (
            <View style={styles.headerActions}>
              <Link href="/jobs" style={[styles.headerLink, { color: t.accent }]}>Jobs</Link>
              <Link href="/connect" style={[styles.headerLink, { color: t.accent }]}>Settings</Link>
            </View>
          ),
        }}
      />
      {error && (
        <Pressable onPress={() => router.push('/connect')} style={[styles.banner, { backgroundColor: t.card, borderColor: t.danger }]}>
          <Text style={{ color: t.danger, fontWeight: '600' }}>Offline</Text>
          <Text style={{ color: t.muted, fontSize: 13 }}>{error}</Text>
        </Pressable>
      )}
      {sessions === null && !error ? (
        <Center><ActivityIndicator /></Center>
      ) : (
        <FlatList
          data={ordered}
          keyExtractor={(s) => s.id}
          contentContainerStyle={{ padding: 12, paddingBottom: 100 + insets.bottom, gap: 8 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
          ListEmptyComponent={<Text style={[styles.empty, { color: t.muted }]}>No tasks yet. Start one below.</Text>}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => router.push({ pathname: '/session/[id]', params: { id: item.id } })}
              onLongPress={() => manage(item)}
              style={({ pressed }) => [styles.row, { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.8 : 1 }]}>
              <View style={{ flex: 1, gap: 4 }}>
                <Text numberOfLines={1} style={[styles.title, { color: t.text }]}>{item.pinned ? '📌 ' : ''}{sessionTitle(item)}</Text>
                <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>
                  {relativeTime(item.last_active ?? item.started_at)} · {item.message_count ?? 0} messages
                </Text>
              </View>
              <RunBadge run={runs[item.id]} />
            </Pressable>
          )}
        />
      )}
      <Pressable onPress={newTask} disabled={creating} style={({ pressed }) => [styles.fab, { backgroundColor: t.accent, bottom: 20 + insets.bottom, opacity: pressed || creating ? 0.8 : 1 }]}>
        {creating ? <ActivityIndicator color={t.accentText} /> : <Text style={[styles.fabText, { color: t.accentText }]}>＋ New task</Text>}
      </Pressable>
    </View>
  );
}

const Center = ({ children }: { children: React.ReactNode }) => <View style={styles.center}>{children}</View>;

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', gap: 16 },
  headerLink: { fontSize: 15, fontWeight: '600' },
  banner: { margin: 12, marginBottom: 0, padding: 12, borderRadius: 10, borderWidth: 1, gap: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, borderWidth: StyleSheet.hairlineWidth },
  title: { fontSize: 16, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 60, fontSize: 15 },
  fab: { position: 'absolute', alignSelf: 'center', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999, elevation: 4 },
  fabText: { fontSize: 16, fontWeight: '700' },
});
