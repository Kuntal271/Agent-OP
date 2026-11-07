import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { radius, useTheme } from '@/components/theme';
import { Banner, Card, EmptyState, Icon, Segmented, SectionHeader, Skeleton, type IconName } from '@/components/ui';
import { compactNumber, money, sessionTitle } from '@/lib/format';
import { summarizeUsage } from '@/lib/usage';
import { useHermes } from '@/state/HermesContext';
import { useAsync } from '@/state/useAsync';

type Range = '7' | '30' | '0';

export default function UsageScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, online } = useHermes();
  const [range, setRange] = useState<Range>('7');
  const fetchAll = useCallback(async () => (await client!.listSessions(200)).data, [client]);
  const { data, error, loading, refreshing, refresh, reload } = useAsync(client ? fetchAll : null);
  const u = useMemo(() => (data ? summarizeUsage(data, Number(range)) : null), [data, range]);
  const peak = Math.max(1, ...(u?.days.map((d) => d.tokens) ?? [1]));
  const modelTotal = Math.max(1, u?.models.reduce((n, m) => n + m.tokens, 0) ?? 1);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="Usage" subtitle="Tokens and activity across your tasks" />
      {!online && <Banner tone="danger" text="Can’t reach Hermes. Check that Tailscale is on." />}
      {loading ? <Skeleton rows={4} /> : error && !u ? (
        <EmptyState icon="cloud-offline-outline" title="Can’t load usage" body={error} action="Retry" onAction={reload} />
      ) : u && (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 + insets.bottom, gap: 12 }} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.accent} />}>
          <Segmented<Range> value={range} onChange={setRange} options={[{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '0', label: 'All time' }]} />

          <View style={styles.grid}>
            <Stat icon="flash-outline" label="Tokens" value={compactNumber(u.input + u.output)} sub={`${compactNumber(u.input)} in · ${compactNumber(u.output)} out`} />
            <Stat icon="chatbubbles-outline" label="Tasks" value={String(u.sessions)} sub={`${compactNumber(u.calls)} model calls`} />
            <Stat icon="construct-outline" label="Tool calls" value={compactNumber(u.tools)} sub={`${(u.tools / Math.max(1, u.sessions)).toFixed(1)} per task`} />
            <Stat icon="server-outline" label="Cache hits" value={`${Math.round(u.cacheHit * 100)}%`} sub={`${compactNumber(u.cacheRead)} cached`} />
          </View>
          {u.cost > 0
            ? <Card style={styles.pad}><Text style={{ color: t.muted, fontSize: 12 }}>Estimated cost</Text><Text style={{ color: t.text, fontSize: 22, fontWeight: '800' }}>{money(u.cost)}</Text></Card>
            : <Banner rounded tone="info" text="Cost isn’t reported for this provider. Tokens are exact." />}

          <SectionHeader flush title={`Last ${u.days.length} days`} />
          <Card style={styles.pad}>
            <View style={styles.chart} accessibilityLabel={`Tokens per day, last ${u.days.length} days`}>
              {u.days.map((d, i) => (
                <View key={d.key} style={styles.barCol}>
                  <View style={[styles.bar, { height: Math.max(3, (d.tokens / peak) * 100), backgroundColor: d.tokens ? t.accent : t.border, opacity: d.tokens && i !== u.days.length - 1 ? 0.6 : 1 }]} />
                  <Text style={{ color: i === u.days.length - 1 ? t.accent : t.muted, fontSize: 10, fontWeight: i === u.days.length - 1 ? '800' : '500' }}>{u.days.length > 14 ? (i % 5 === 4 || i === u.days.length - 1 ? d.day : '') : d.label}</Text>
                </View>
              ))}
            </View>
            <Text style={{ color: t.muted, fontSize: 12, marginTop: 6 }}>Peak day: {compactNumber(peak === 1 ? 0 : peak)} tokens</Text>
          </Card>

          <SectionHeader flush title="By model" />
          <Card style={{ paddingVertical: 4 }}>
            {u.models.length === 0 && <Text style={[styles.pad, { color: t.muted }]}>No activity in this period.</Text>}
            {u.models.map((m, i) => (
              <View key={m.model} style={[styles.modelRow, { borderTopColor: t.border, borderTopWidth: i ? StyleSheet.hairlineWidth : 0 }]}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: t.text, fontWeight: '600' }}>{m.label}</Text>
                  <Text style={{ color: t.muted }}>{compactNumber(m.tokens)} · {Math.round((m.tokens / modelTotal) * 100)}% · {m.sessions} task{m.sessions === 1 ? '' : 's'}</Text>
                </View>
                <View style={[styles.track, { backgroundColor: t.surface }]}><View style={{ width: `${(m.tokens / modelTotal) * 100}%`, height: 6, borderRadius: 3, backgroundColor: t.accent }} /></View>
              </View>
            ))}
          </Card>

          {u.top.length > 0 && <SectionHeader flush title="Heaviest tasks" />}
          {u.top.length > 0 && (
            <Card>
              {u.top.map((s, i) => (
                <Pressable key={s.id} onPress={() => router.push({ pathname: '/session/[id]', params: { id: s.id } })} accessibilityRole="button"
                  style={({ pressed }) => [styles.topRow, { borderTopColor: t.border, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, opacity: pressed ? 0.7 : 1 }]}>
                  <Text numberOfLines={1} style={{ color: t.text, flex: 1 }}>{sessionTitle(s)}</Text>
                  <Text style={{ color: t.muted }}>{compactNumber((s.input_tokens ?? 0) + (s.output_tokens ?? 0))}</Text>
                  <Icon name="chevron-forward" size={14} color={t.muted} />
                </Pressable>
              ))}
            </Card>
          )}
        </ScrollView>
      )}
    </View>
  );
}

function Stat({ icon, label, value, sub }: { icon: IconName; label: string; value: string; sub?: string }) {
  const t = useTheme();
  return (
    <Card style={styles.stat}>
      <View style={styles.statHead}><Icon name={icon} size={15} color={t.accent} /><Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>{label}</Text></View>
      <Text style={{ color: t.text, fontSize: 26, fontWeight: '800', letterSpacing: -0.5 }}>{value}</Text>
      {!!sub && <Text style={{ color: t.muted, fontSize: 11.5 }}>{sub}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  stat: { width: '48.5%', padding: 14, gap: 3, borderRadius: radius.lg },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  pad: { padding: 14 },
  chart: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 124 },
  barCol: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4, height: '100%' },
  bar: { width: '100%', borderRadius: 4 },
  modelRow: { paddingHorizontal: 14, paddingVertical: 11, gap: 8 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 13 },
});
