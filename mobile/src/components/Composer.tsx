import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { MAX_ATTACHMENTS, pickFromLibrary, takePhoto, type Attachment } from '@/lib/attachments';
import { prettyModel } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import { useDictation } from '@/lib/voice';
import { useSettings } from '@/state/SettingsContext';
import { ActionSheet, Chip, Icon } from './ui';
import { radius, useTheme } from './theme';

type Props = {
  /** Resolves true when the message was accepted, so the composer can clear itself. */
  onSend: (text: string, attachments: Attachment[]) => Promise<boolean>;
  onStop?: () => void;
  onModelPress: () => void;
  modelLabel?: string | null;
  active: boolean;
  initialText?: string;
};

export function Composer({ onSend, onStop, onModelPress, modelLabel, active, initialText = '' }: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { settings } = useSettings();
  const [text, setText] = useState(initialText);
  const [atts, setAtts] = useState<Attachment[]>([]);
  const [sending, setSending] = useState(false);
  const [menu, setMenu] = useState(false);
  const [busyPick, setBusyPick] = useState(false);
  const baseRef = useRef('');
  const textRef = useRef(text);
  const attsRef = useRef(atts);
  useEffect(() => {
    textRef.current = text;
    attsRef.current = atts;
  });

  const submit = useCallback(async () => {
    const body = textRef.current.trim();
    if ((!body && attsRef.current.length === 0) || sending) return;
    setSending(true);
    try {
      if (await onSend(body, attsRef.current)) {
        setText('');
        setAtts([]);
      }
    } finally {
      setSending(false);
    }
  }, [onSend, sending]);

  const dictation = useDictation({
    onText: (spoken) => setText(`${baseRef.current}${baseRef.current && spoken ? ' ' : ''}${spoken}`),
    onEnd: () => {
      if (settings.voiceAutoSend && textRef.current.trim()) submit();
    },
    onError: (m) => Alert.alert('Voice input', m),
  });

  const toggleMic = () => {
    haptic.press();
    if (dictation.listening) return dictation.stop();
    baseRef.current = textRef.current.trim();
    dictation.start();
  };

  const attach = async (kind: 'library' | 'camera') => {
    setBusyPick(true);
    try {
      const room = MAX_ATTACHMENTS - attsRef.current.length;
      const added = kind === 'library' ? await pickFromLibrary(room) : [await takePhoto()].filter((a): a is Attachment => !!a);
      if (added.length) setAtts((cur) => [...cur, ...added].slice(0, MAX_ATTACHMENTS));
    } catch (e: any) {
      Alert.alert('Attachment', e?.message ?? String(e));
    } finally {
      setBusyPick(false);
    }
  };

  const canSend = text.trim().length > 0 || atts.length > 0;

  return (
    <View style={[styles.wrap, { backgroundColor: t.card, borderColor: t.border, paddingBottom: 8 + insets.bottom }]}>
      <View style={styles.metaRow}>
        <Chip icon="hardware-chip-outline" label={modelLabel ? prettyModel(modelLabel) : 'Default model'} onPress={onModelPress} />
        {dictation.listening && <Chip icon="mic" label="Listening…" tone="danger" />}
        <View style={{ flex: 1 }} />
        {active && (
          <Pressable onPress={() => { haptic.warning(); onStop?.(); }} accessibilityRole="button" accessibilityLabel="Stop task"
            style={[styles.stop, { backgroundColor: t.dangerSoft }]}>
            <Icon name="stop" size={14} color={t.danger} />
            <Text style={{ color: t.danger, fontWeight: '700', fontSize: 13 }}>Stop</Text>
          </Pressable>
        )}
      </View>

      {atts.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 8 }}>
          {atts.map((a) => (
            <View key={a.id}>
              <Image source={{ uri: a.uri }} style={styles.thumb} accessibilityLabel="Attached image" />
              <Pressable onPress={() => setAtts((c) => c.filter((x) => x.id !== a.id))} accessibilityRole="button" accessibilityLabel="Remove image" hitSlop={8}
                style={[styles.remove, { backgroundColor: t.text }]}>
                <Icon name="close" size={12} color={t.bg} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.inputRow}>
        <Pressable onPress={() => setMenu(true)} disabled={busyPick || atts.length >= MAX_ATTACHMENTS} accessibilityRole="button" accessibilityLabel="Attach image"
          style={[styles.round, { backgroundColor: t.surface, opacity: atts.length >= MAX_ATTACHMENTS ? 0.4 : 1 }]}>
          {busyPick ? <ActivityIndicator size="small" /> : <Icon name="add" size={24} color={t.text} />}
        </Pressable>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={active ? 'Steer the running task…' : 'Message Hermes'}
          placeholderTextColor={t.muted}
          multiline
          accessibilityLabel="Message"
          style={[styles.input, { color: t.text, backgroundColor: t.bg, borderColor: t.border }]}
        />
        {canSend || sending ? (
          <Pressable onPress={() => { haptic.press(); submit(); }} disabled={sending} accessibilityRole="button" accessibilityLabel={active ? 'Steer' : 'Send'}
            style={[styles.round, { backgroundColor: t.accent, opacity: sending ? 0.6 : 1 }]}>
            {sending ? <ActivityIndicator size="small" color={t.accentText} /> : <Icon name={active ? 'return-down-forward' : 'arrow-up'} size={22} color={t.accentText} />}
          </Pressable>
        ) : (
          <Pressable onPress={toggleMic} accessibilityRole="button" accessibilityLabel={dictation.listening ? 'Stop dictation' : 'Dictate'}
            style={[styles.round, { backgroundColor: dictation.listening ? t.danger : t.surface }]}>
            <Icon name={dictation.listening ? 'mic' : 'mic-outline'} size={22} color={dictation.listening ? '#fff' : t.text} />
          </Pressable>
        )}
      </View>

      <ActionSheet visible={menu} onClose={() => setMenu(false)} title="Attach"
        actions={[
          { label: 'Photo library', icon: 'images-outline', onPress: () => attach('library') },
          { label: 'Take a photo', icon: 'camera-outline', onPress: () => attach('camera') },
        ]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  stop: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.pill },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: { flex: 1, maxHeight: 140, minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 16, paddingTop: 11, paddingBottom: 11, fontSize: 15.5 },
  round: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: 64, height: 64, borderRadius: radius.md },
  remove: { position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
