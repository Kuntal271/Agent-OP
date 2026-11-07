import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Alert, FlatList, Pressable, RefreshControl, StyleSheet, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { radius, useTheme } from '@/components/theme';
import { Banner, Chip, EmptyState, Icon, Skeleton } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { humanSchedule, jobDate, relativeWhen } from '@/lib/jobs';
import type { Job } from '@/lib/types';
import { useHermes } from '@/state/HermesContext';
import { useAsync } from '@/state/useAsync';

export default function RoutinesScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, online } = useHermes();
  const fetchJobs = useCallback(() => client!.listJobs(), [client]);
  const { data, error, loading, refreshing, refresh, reload } = useAsync(client ? fetchJobs : null, { pollMs: 15_000 });

  const toggle = async (j: Job, on: boolean) => {
    try {
      await client!.jobAction(j.id, on ? 'resume' : 'pause');
      reload();
    } catch (e: any) {
      Alert.alert('Could not update routine', e?.message ?? String(e));
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="Routines" subtitle="Hermes tasks that run on a schedule" />
      {!online && <Banner tone="danger" text="Can’t reach Hermes. Check that Tailscale is on." />}
      {loading ? <Skeleton rows={3} /> : (
        <FlatList
          data={data ?? []}
          keyExtractor={(j) => j.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 110 + insets.bottom, gap: 10, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.accent} />}
          ListEmptyComponent={
            error ? <EmptyState icon="cloud-offline-outline" title="Can’t load routines" body={error} action="Retry" onAction={reload} />
            : <EmptyState icon="timer-outline" title="No routines yet" body="Ask Hermes to do something every morning, hourly, or every Monday — it runs even when your phone is off." action="Create a routine" onAction={() => router.push({ pathname: '/routine/[id]', params: { id: 'new' } })} />
          }
          renderItem={({ item: j }) => {
            const on = j.enabled !== false && j.state !== 'paused';
            const next = jobDate(j.next_run_at);
            const last = jobDate(j.last_run_at);
            return (
              <Pressable onPress={() => router.push({ pathname: '/routine/[id]', params: { id: j.id } })} accessibilityRole="button" accessibilityLabel={j.name ?? 'Routine'}
                style={({ pressed }) => [styles.card, { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.75 : 1 }]}>
                <View style={{ flex: 1, gap: 4 }}>
                  <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>{j.name || 'Untitled routine'}</Text>
                  <Text numberOfLines={1} style={{ color: t.muted, fontSize: 13 }}>{humanSchedule(j)}</Text>
                  <View style={styles.meta}>
                    {on ? <Chip icon="play" label={next ? `Next ${relativeWhen(next)}` : 'Active'} tone="ok" /> : <Chip icon="pause" label="Paused" tone="warn" />}
                    {last
                      ? <Chip icon={j.last_status === 'error' || j.last_error ? 'alert-circle' : 'checkmark-circle'} label={`${j.last_status === 'error' || j.last_error ? 'Failed' : 'Ran'} ${relativeWhen(last)}`} tone={j.last_status === 'error' || j.last_error ? 'danger' : undefined} />
                      : <Chip icon="time-outline" label="Never run" />}
                  </View>
                </View>
                <Switch value={on} onValueChange={(v) => { haptic.tap(); toggle(j, v); }} trackColor={{ true: t.accent, false: t.track }} thumbColor="#FFFFFF" ios_backgroundColor={t.track} accessibilityLabel={on ? 'Pause routine' : 'Resume routine'} />
              </Pressable>
            );
          }}
        />
      )}
      <Pressable onPress={() => router.push({ pathname: '/routine/[id]', params: { id: 'new' } })} accessibilityRole="button" accessibilityLabel="New routine"
        style={({ pressed }) => [styles.fab, { backgroundColor: t.accent, opacity: pressed ? 0.8 : 1 }]}>
        <Icon name="add" size={24} color={t.accentText} />
        <Text style={{ color: t.accentText, fontWeight: '700', fontSize: 15 }}>New routine</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  meta: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  fab: { position: 'absolute', right: 16, bottom: 20, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, height: 52, borderRadius: 26, elevation: 5, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
});
