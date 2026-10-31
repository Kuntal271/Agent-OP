import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

import type { TrackedRun } from '@/lib/storage';
import { isTerminal } from '@/lib/types';
import { useTheme } from './theme';

/** Per-task run state shown in the task list. */
export function RunBadge({ run }: { run?: TrackedRun }) {
  const t = useTheme();
  if (!run) return null;
  if (run.status === 'waiting_for_approval') return <Pill color={t.warn} label="Needs approval" />;
  if (run.status === 'unknown') return <Pill color={t.warn} label="Needs attention" />;
  if (!isTerminal(run.status)) {
    return (
      <View style={styles.row}>
        <ActivityIndicator size="small" color={t.accent} />
        <Text style={[styles.text, { color: t.accent }]}>Working</Text>
      </View>
    );
  }
  if (run.status === 'failed' || run.status === 'interrupted') return <Pill color={t.danger} label={run.status === 'failed' ? 'Failed' : 'Interrupted'} />;
  if (run.unread) return <View style={[styles.dot, { backgroundColor: t.accent }]} />;
  return null;
}

function Pill({ color, label }: { color: string; label: string }) {
  return (
    <View style={[styles.pill, { borderColor: color }]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { fontSize: 12, fontWeight: '600' },
  pill: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
