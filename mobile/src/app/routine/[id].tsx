import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { mono, radius, useTheme } from '@/components/theme';
import { Banner, Button, Chip, Segmented } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import {
  composeSchedule, describeSchedule, jobDate, parseSchedule, relativeWhen, validateDraft, WEEKDAYS,
  type Freq, type ScheduleDraft,
} from '@/lib/jobs';
import type { Job } from '@/lib/types';
import { useHermes } from '@/state/HermesContext';

const FREQS: { value: Freq; label: string }[] = [
  { value: 'interval', label: 'Every' }, { value: 'daily', label: 'Daily' }, { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' }, { value: 'custom', label: 'Custom' },
];

export default function RoutineEditor() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === 'new';
  const t = useTheme();
  const router = useRouter();
  const { client } = useHermes();
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [draft, setDraft] = useState<ScheduleDraft>(parseSchedule(null));
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNew || !client) return;
    let gone = false;
    client.listJobs()
      .then((jobs) => {
        if (gone) return;
        const j = jobs.find((x) => x.id === id) ?? null;
        setJob(j);
        if (j) { setName(j.name ?? ''); setPrompt(j.prompt ?? ''); setDraft(parseSchedule(j)); }
        else setError('This routine no longer exists.');
      })
      .catch((e) => !gone && setError(e?.message ?? String(e)))
      .finally(() => !gone && setLoading(false));
    return () => { gone = true; };
  }, [client, id, isNew]);

  const set = (patch: Partial<ScheduleDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const schedule = composeSchedule(draft);
  const problem = validateDraft(draft) ?? (!name.trim() ? 'Give the routine a name.' : !prompt.trim() ? 'Describe what Hermes should do.' : null);

  const save = async () => {
    if (problem || !client) return Alert.alert('Almost there', problem ?? '');
    setBusy('save');
    try {
      const body = { name: name.trim(), prompt: prompt.trim(), schedule };
      if (isNew) await client.createJob({ ...body, deliver: 'local' });
      else await client.updateJob(String(id), body);
      haptic.success();
      router.back();
    } catch (e: any) {
      haptic.error();
      Alert.alert('Could not save', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const act = async (kind: 'run' | 'pause' | 'resume') => {
    if (!client || !job) return;
    setBusy(kind);
    try {
      const res = await client.jobAction(job.id, kind);
      setJob(res.job ?? job);
      haptic.success();
      if (kind === 'run') Alert.alert('Started', 'The routine is running now. Its result will appear in Tasks.');
    } catch (e: any) {
      Alert.alert('Failed', e?.message ?? String(e));
    } finally {
      setBusy(null);
    }
  };

  const remove = () =>
    Alert.alert('Delete this routine?', name || 'Routine', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await client?.deleteJob(String(id)).catch(() => {}); router.back(); } },
    ]);

  if (loading) return <View style={styles.center}><ActivityIndicator /></View>;
  if (error && !isNew) return <View style={styles.center}><Banner tone="danger" text={error} /></View>;

  const paused = job ? job.enabled === false || job.state === 'paused' : false;
  const field = [styles.input, { color: t.text, backgroundColor: t.card, borderColor: t.border }];
  const next = jobDate(job?.next_run_at);

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: isNew ? 'New routine' : 'Edit routine' }} />
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: t.muted }]}>Name</Text>
        <TextInput value={name} onChangeText={setName} placeholder="Morning briefing" placeholderTextColor={t.muted} style={field} accessibilityLabel="Routine name" />

        <Text style={[styles.label, { color: t.muted }]}>What should Hermes do?</Text>
        <TextInput value={prompt} onChangeText={setPrompt} multiline placeholder="Summarise overnight AI news and list anything I should act on." placeholderTextColor={t.muted}
          style={[...field, { minHeight: 110, textAlignVertical: 'top' }]} accessibilityLabel="Routine prompt" />

        <Text style={[styles.label, { color: t.muted }]}>Schedule</Text>
        <View style={styles.chips}>{FREQS.map((f) => <Chip key={f.value} label={f.label} active={draft.freq === f.value} onPress={() => set({ freq: f.value })} />)}</View>

        {draft.freq === 'interval' && (
          <View style={styles.inline}>
            <Text style={{ color: t.text }}>Every</Text>
            <TextInput value={draft.every} onChangeText={(v) => set({ every: v.replace(/\D/g, '') })} keyboardType="number-pad" style={[...field, styles.small]} accessibilityLabel="Interval" />
            <View style={{ flex: 1 }}><Segmented value={draft.unit} options={[{ value: 'm', label: 'minutes' }, { value: 'h', label: 'hours' }]} onChange={(unit) => set({ unit })} /></View>
          </View>
        )}
        {(draft.freq === 'daily' || draft.freq === 'weekdays' || draft.freq === 'weekly') && (
          <View style={{ gap: 10 }}>
            {draft.freq === 'weekly' && (
              <View style={styles.chips}>{WEEKDAYS.map((d, i) => <Chip key={d} label={d} active={draft.weekday === i} onPress={() => set({ weekday: i })} />)}</View>
            )}
            <View style={styles.inline}>
              <Text style={{ color: t.text }}>At</Text>
              <TextInput value={draft.hh} onChangeText={(v) => set({ hh: v.replace(/\D/g, '').slice(0, 2) })} keyboardType="number-pad" maxLength={2} style={[...field, styles.small]} accessibilityLabel="Hour" />
              <Text style={{ color: t.text, fontWeight: '700' }}>:</Text>
              <TextInput value={draft.mm} onChangeText={(v) => set({ mm: v.replace(/\D/g, '').slice(0, 2) })} keyboardType="number-pad" maxLength={2} style={[...field, styles.small]} accessibilityLabel="Minute" />
              <Text style={{ color: t.muted, fontSize: 12 }}>24-hour, server time</Text>
            </View>
          </View>
        )}
        {draft.freq === 'custom' && (
          <TextInput value={draft.custom} onChangeText={(custom) => set({ custom })} autoCapitalize="none" autoCorrect={false} placeholder="every 30m  ·  0 9 * * 1-5  ·  2026-12-01T09:00" placeholderTextColor={t.muted}
            style={[...field, mono]} accessibilityLabel="Custom schedule" />
        )}
        <Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>{describeSchedule(draft)}{schedule && draft.freq !== 'custom' && draft.freq !== 'interval' ? `  ·  ${schedule}` : ''}</Text>

        {!isNew && job && (
          <View style={[styles.status, { backgroundColor: t.card, borderColor: t.border }]}>
            <Text style={{ color: t.text, fontWeight: '600' }}>{paused ? 'Paused' : next ? `Next run ${relativeWhen(next)}` : 'Active'}</Text>
            {!!job.last_error && <Text style={{ color: t.danger, fontSize: 12 }}>Last error: {job.last_error}</Text>}
            <View style={styles.chips}>
              <Button title="Run now" icon="play" variant="secondary" compact onPress={() => act('run')} loading={busy === 'run'} />
              <Button title={paused ? 'Resume' : 'Pause'} icon={paused ? 'play-forward' : 'pause'} variant="secondary" compact onPress={() => act(paused ? 'resume' : 'pause')} loading={busy === 'pause' || busy === 'resume'} />
            </View>
          </View>
        )}

        <Button title={isNew ? 'Create routine' : 'Save changes'} icon="checkmark" onPress={save} loading={busy === 'save'} style={{ marginTop: 12 }} />
        {!isNew && <Button title="Delete routine" icon="trash-outline" variant="danger" onPress={remove} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { padding: 16, gap: 10, paddingBottom: 48 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginTop: 8, textTransform: 'uppercase' },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 11, fontSize: 15.5 },
  small: { width: 64, textAlign: 'center' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  status: { marginTop: 8, padding: 14, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, gap: 10 },
});
