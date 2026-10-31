import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/components/theme';
import type { Job } from '@/lib/types';
import { useHermes } from '@/state/HermesContext';

const when = (v?: string | number | null) => {
  if (v == null || v === '') return '—';
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toLocaleString();
};
const scheduleText = (j: Job) =>
  j.schedule_display ?? (typeof j.schedule === 'string' ? j.schedule : (j.schedule as any)?.display ?? (j.schedule as any)?.expr ?? JSON.stringify(j.schedule ?? ''));
const isPaused = (j: Job) => j.enabled === false || j.state === 'paused';

export default function JobsScreen() {
  const t = useTheme();
  const { client } = useHermes();
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setJobs(await client.listJobs());
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }, [client]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const act = async (j: Job, action: 'pause' | 'resume' | 'run') => {
    if (!client) return;
    setBusy(`${j.id}:${action}`);
    try {
      await client.jobAction(j.id, action);
      if (action === 'run') Alert.alert('Started', `${j.name ?? 'Job'} is running now.`);
      await load();
    } catch (e: any) {
      Alert.alert('Action failed', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  if (jobs === null && !error) return <View style={styles.center}><ActivityIndicator /></View>;
  return (
    <FlatList
      data={jobs ?? []}
      keyExtractor={(j) => j.id}
      contentContainerStyle={{ padding: 12, gap: 8 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }} />}
      ListHeaderComponent={error ? <Text style={{ color: t.danger, marginBottom: 8 }}>{error}</Text> : undefined}
      ListEmptyComponent={<Text style={[styles.empty, { color: t.muted }]}>No scheduled jobs. Ask Hermes in a task, e.g. “every morning at 8, summarise my inbox”.</Text>}
      renderItem={({ item: j }) => (
        <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }]}>
          <View style={styles.rowBetween}>
            <Text style={[styles.title, { color: t.text }]} numberOfLines={1}>{j.name ?? j.id}</Text>
            <Text style={{ color: isPaused(j) ? t.warn : t.ok, fontSize: 12, fontWeight: '700' }}>{isPaused(j) ? 'PAUSED' : 'ACTIVE'}</Text>
          </View>
          <Text style={{ color: t.muted, fontSize: 13 }}>{scheduleText(j)}</Text>
          {!!j.prompt && <Text style={{ color: t.text, fontSize: 13 }} numberOfLines={3}>{j.prompt}</Text>}
          <Text style={{ color: t.muted, fontSize: 12 }}>Next: {when(j.next_run_at)} · Last: {when(j.last_run_at)}{j.last_status ? ` (${j.last_status})` : ''}</Text>
          <View style={styles.actions}>
            {(['run', isPaused(j) ? 'resume' : 'pause'] as const).map((a) => (
              <Pressable key={a} disabled={!!busy} onPress={() => act(j, a)} style={({ pressed }) => [styles.action, { borderColor: t.accent, opacity: pressed || busy ? 0.6 : 1 }]}>
                {busy === `${j.id}:${a}` ? <ActivityIndicator size="small" /> : <Text style={{ color: t.accent, fontWeight: '600' }}>{a === 'run' ? 'Run now' : a === 'pause' ? 'Pause' : 'Resume'}</Text>}
              </Pressable>
            ))}
          </View>
        </View>
      )}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: 12, borderWidth: StyleSheet.hairlineWidth, padding: 14, gap: 6 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  title: { fontSize: 16, fontWeight: '600', flex: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 4 },
  action: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 7, minWidth: 80, alignItems: 'center' },
  empty: { textAlign: 'center', marginTop: 60, fontSize: 15, paddingHorizontal: 20 },
});
