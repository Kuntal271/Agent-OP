import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { RunEvent } from '@/lib/types';
import { haptic } from '@/lib/haptics';
import { Markdown } from './Markdown';
import { Icon } from './ui';
import { mono, useTheme } from './theme';

export type Activity = { key: string; tool: string; preview?: string; state: 'running' | 'done' | 'error'; duration?: number };

const CHOICE_LABEL: Record<string, string> = { once: 'Allow once', session: 'Allow for this task', always: 'Always allow', deny: 'Deny' };
const CHOICE_ORDER = ['once', 'session', 'always', 'deny'];
/** Server default `approvals.timeout`; the deployment raises it to 1800 s. Unanswered = denied. */
const DEFAULT_WAIT_S = 1800;

export function ApprovalCard({ ev, onChoose }: { ev: RunEvent; onChoose: (choice: string) => Promise<void> }) {
  const t = useTheme();
  const [busy, setBusy] = useState<string | null>(null);
  const raw = ev.choices?.length ? ev.choices : ['once', 'deny'];
  const choices = [...raw].sort((a, b) => (CHOICE_ORDER.indexOf(a) + 99) % 99 - (CHOICE_ORDER.indexOf(b) + 99) % 99);
  const waitS = Number(ev.timeout_s ?? DEFAULT_WAIT_S);
  const deadline = ev.timestamp ? new Date((Number(ev.timestamp) + waitS) * 1000) : null;
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.warn }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="shield-checkmark" size={18} color={t.warn} /><Text style={{ color: t.warn, fontWeight: '700' }}>Approval needed</Text></View>
      {!!ev.description && <Text style={{ color: t.text }}>{String(ev.description)}</Text>}
      {!!ev.command && (
        <View style={[styles.cmd, { backgroundColor: t.code }]}>
          <Text selectable style={[mono, { color: t.text, fontSize: 12.5 }]}>{String(ev.command)}</Text>
        </View>
      )}
      <Text style={{ color: t.muted, fontSize: 12 }}>
        Hermes waits{deadline ? ` until ${deadline.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ` ${Math.round(waitS / 60)} min`}; no answer means deny.
      </Text>
      <View style={styles.choices}>
        {choices.map((c) => (
          <Pressable
            key={c}
            disabled={!!busy}
            onPress={async () => { setBusy(c); if (c === 'deny') haptic.warning();
              else haptic.success(); try { await onChoose(c); } finally { setBusy(null); } }}
            style={({ pressed }) => [styles.choice, { borderColor: c === 'deny' ? t.danger : t.accent, opacity: pressed || (busy && busy !== c) ? 0.6 : 1 }]}>
            {busy === c ? <ActivityIndicator size="small" /> : <Text style={{ color: c === 'deny' ? t.danger : t.accent, fontWeight: '600' }}>{CHOICE_LABEL[c] ?? c}</Text>}
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function ClarifyCard({ ev, onAnswer }: { ev: RunEvent; onAnswer: (answer: string) => Promise<void> }) {
  const t = useTheme();
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (a: string) => { if (!a.trim()) return; setBusy(true); try { await onAnswer(a.trim()); } finally { setBusy(false); } };
  return (
    <View style={[styles.card, { backgroundColor: t.card, borderColor: t.accent }]}>
      <Text style={{ color: t.accent, fontWeight: '700' }}>Hermes is asking</Text>
      <Text style={{ color: t.text }}>{String(ev.question ?? ev.text ?? ev.description ?? '')}</Text>
      {!!ev.choices?.length && (
        <View style={styles.choices}>
          {ev.choices.map((c) => (
            <Pressable key={c} disabled={busy} onPress={() => send(c)} style={[styles.choice, { borderColor: t.accent }]}>
              <Text style={{ color: t.accent, fontWeight: '600' }}>{c}</Text>
            </Pressable>
          ))}
        </View>
      )}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={answer} onChangeText={setAnswer} placeholder="Your answer" placeholderTextColor={t.muted} style={[styles.input, { color: t.text, borderColor: t.border }]} />
        <Pressable disabled={busy} onPress={() => send(answer)} style={[styles.choice, { borderColor: t.accent }]}>
          {busy ? <ActivityIndicator size="small" /> : <Text style={{ color: t.accent, fontWeight: '600' }}>Send</Text>}
        </Pressable>
      </View>
    </View>
  );
}

/** What the running turn is doing right now: tool steps, then the streamed answer. */
export function LiveBlock({ text, activity, statusLabel }: { text: string; activity: Activity[]; statusLabel: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {activity.map((a) => (
        <View key={a.key} style={styles.step}>
          {a.state === 'running' ? <ActivityIndicator size="small" color={t.accent} style={{ width: 14, height: 14 }} />
            : <Icon name={a.state === 'error' ? 'close-circle' : 'checkmark-circle'} size={14} color={a.state === 'error' ? t.danger : t.ok} />}
          <Text numberOfLines={2} style={[mono, { color: a.state === 'error' ? t.danger : t.muted, fontSize: 12, flex: 1 }]}>
            {a.tool}{a.preview ? ` · ${a.preview}` : ''}{a.duration != null && a.state !== 'running' ? ` (${Math.round(Number(a.duration))}s)` : ''}
          </Text>
        </View>
      ))}
      {!!text && (
        <View style={[styles.live, { backgroundColor: t.botBubble, borderColor: t.border }]}>
          <Markdown>{text}</Markdown>
        </View>
      )}
      <View style={styles.status}>
        <ActivityIndicator size="small" color={t.accent} />
        <Text style={{ color: t.muted, fontSize: 13 }}>{statusLabel}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 12, padding: 12, gap: 8 },
  cmd: { borderRadius: 8, padding: 10 },
  choices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 8, minWidth: 64, alignItems: 'center' },
  input: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  live: { borderRadius: 16, borderBottomLeftRadius: 4, paddingHorizontal: 14, paddingVertical: 10, borderWidth: StyleSheet.hairlineWidth, alignSelf: 'flex-start', maxWidth: '92%' },
  status: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 6 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 6 },
});
