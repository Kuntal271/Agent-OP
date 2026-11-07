import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ActivityIndicator, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView,
  StyleSheet, Switch, Text, TextInput, View, type StyleProp, type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { haptic } from '@/lib/haptics';
import { radius, useTheme } from './theme';

export type IconName = React.ComponentProps<typeof Ionicons>['name'];
type IconColor = React.ComponentProps<typeof Ionicons>['color'];

export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color?: IconColor }) {
  const t = useTheme();
  return <Ionicons name={name} size={size} color={color ?? t.text} />;
}

type ButtonProps = {
  title: string; onPress?: () => void; variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: IconName; loading?: boolean; disabled?: boolean; style?: StyleProp<ViewStyle>; compact?: boolean;
};

export function Button({ title, onPress, variant = 'primary', icon, loading, disabled, style, compact }: ButtonProps) {
  const t = useTheme();
  const bg = { primary: t.accent, secondary: t.surface, danger: t.dangerSoft, ghost: 'transparent' }[variant];
  const fg = { primary: t.accentText, secondary: t.text, danger: t.danger, ghost: t.accent }[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      disabled={off}
      onPress={() => { haptic.press(); onPress?.(); }}
      style={({ pressed }) => [styles.btn, compact && styles.btnCompact, { backgroundColor: bg, opacity: off ? 0.5 : pressed ? 0.8 : 1 }, style]}>
      {loading ? <ActivityIndicator color={fg} /> : (
        <View style={styles.row}>
          {icon && <Icon name={icon} size={18} color={fg} />}
          <Text style={[styles.btnText, { color: fg }]}>{title}</Text>
        </View>
      )}
    </Pressable>
  );
}

export function IconButton({ name, onPress, label, color, size = 22, disabled }: { name: IconName; onPress?: () => void; label: string; color?: string; size?: number; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} hitSlop={8} disabled={disabled}
      onPress={() => { haptic.tap(); onPress?.(); }}
      style={({ pressed }) => [styles.iconBtn, { opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}>
      <Ionicons name={name} size={size} color={color ?? t.text} />
    </Pressable>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useTheme();
  return <View style={[styles.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}

export function Chip({ label, icon, active, onPress, tone }: { label: string; icon?: IconName; active?: boolean; onPress?: () => void; tone?: 'warn' | 'ok' | 'danger' }) {
  const t = useTheme();
  const toneColor = tone === 'warn' ? t.warn : tone === 'ok' ? t.ok : tone === 'danger' ? t.danger : undefined;
  const fg = active ? t.accentText : toneColor ?? t.muted;
  const bg = active ? t.accent : tone === 'warn' ? t.warnSoft : tone === 'ok' ? t.okSoft : tone === 'danger' ? t.dangerSoft : t.surface;
  const body = (
    <View style={[styles.chip, { backgroundColor: bg }]}>
      {icon && <Ionicons name={icon} size={13} color={fg} />}
      <Text style={[styles.chipText, { color: fg }]} numberOfLines={1}>{label}</Text>
    </View>
  );
  return onPress ? <Pressable onPress={() => { haptic.tap(); onPress(); }} accessibilityRole="button" accessibilityLabel={label}>{body}</Pressable> : body;
}

export function SectionHeader({ title, right }: { title: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={styles.sectionHeader}>
      <Text style={[styles.sectionTitle, { color: t.muted }]}>{title.toUpperCase()}</Text>
      {right}
    </View>
  );
}

export function Banner({ tone = 'warn', text, action, onAction }: { tone?: 'warn' | 'danger' | 'ok' | 'info'; text: string; action?: string; onAction?: () => void }) {
  const t = useTheme();
  const c = tone === 'danger' ? [t.dangerSoft, t.danger] : tone === 'ok' ? [t.okSoft, t.ok] : tone === 'info' ? [t.accentSoft, t.accent] : [t.warnSoft, t.warn];
  const icon: IconName = tone === 'ok' ? 'checkmark-circle' : tone === 'info' ? 'information-circle' : 'alert-circle';
  return (
    <View style={[styles.banner, { backgroundColor: c[0] }]}>
      <Ionicons name={icon} size={18} color={c[1]} />
      <Text style={{ color: c[1], flex: 1, fontSize: 13 }}>{text}</Text>
      {action && <Pressable onPress={onAction} accessibilityRole="button"><Text style={{ color: c[1], fontWeight: '700', fontSize: 13 }}>{action}</Text></Pressable>}
    </View>
  );
}

export function EmptyState({ icon, title, body, action, onAction }: { icon: IconName; title: string; body?: string; action?: string; onAction?: () => void }) {
  const t = useTheme();
  return (
    <View style={styles.empty}>
      <View style={[styles.emptyIcon, { backgroundColor: t.accentSoft }]}><Ionicons name={icon} size={30} color={t.accent} /></View>
      <Text style={[styles.emptyTitle, { color: t.text }]}>{title}</Text>
      {!!body && <Text style={[styles.emptyBody, { color: t.muted }]}>{body}</Text>}
      {action && <Button title={action} onPress={onAction} compact style={{ marginTop: 14, alignSelf: 'center' }} />}
    </View>
  );
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  const t = useTheme();
  const [v] = useState(() => new Animated.Value(0.4));
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(v, { toValue: 0.4, duration: 700, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [v]);
  return (
    <View style={{ padding: 12, gap: 10 }}>
      {Array.from({ length: rows }, (_, i) => (
        <Animated.View key={i} style={[styles.skel, { backgroundColor: t.surface, opacity: v }]} />
      ))}
    </View>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={[styles.segment, { backgroundColor: t.surface }]}>
      {options.map((o) => (
        <Pressable key={o.value} onPress={() => { haptic.tap(); onChange(o.value); }} accessibilityRole="button" accessibilityState={{ selected: o.value === value }}
          style={[styles.segItem, o.value === value && { backgroundColor: t.card }]}>
          <Text style={{ color: o.value === value ? t.text : t.muted, fontWeight: o.value === value ? '700' : '500', fontSize: 13 }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Settings-style row: icon, title, optional subtitle, and a trailing switch / value / chevron. */
export function Row({ icon, title, subtitle, value, onPress, toggle, onToggle, danger, last }: {
  icon?: IconName; title: string; subtitle?: string; value?: string; onPress?: () => void;
  toggle?: boolean; onToggle?: (v: boolean) => void; danger?: boolean; last?: boolean;
}) {
  const t = useTheme();
  const color = danger ? t.danger : t.text;
  return (
    <Pressable disabled={!onPress} onPress={() => { haptic.tap(); onPress?.(); }} accessibilityRole={onPress ? 'button' : 'text'}
      style={({ pressed }) => [styles.listRow, { borderBottomColor: t.border, borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth, opacity: pressed ? 0.7 : 1 }]}>
      {icon && <View style={[styles.rowIcon, { backgroundColor: danger ? t.dangerSoft : t.accentSoft }]}><Ionicons name={icon} size={17} color={danger ? t.danger : t.accent} /></View>}
      <View style={{ flex: 1 }}>
        <Text style={{ color, fontSize: 15, fontWeight: '500' }}>{title}</Text>
        {!!subtitle && <Text style={{ color: t.muted, fontSize: 12, marginTop: 2 }}>{subtitle}</Text>}
      </View>
      {value !== undefined && <Text style={{ color: t.muted, fontSize: 14, maxWidth: 160 }} numberOfLines={1}>{value}</Text>}
      {onToggle && <Switch value={!!toggle} onValueChange={(v) => { haptic.tap(); onToggle(v); }} trackColor={{ true: t.accent, false: t.border }} />}
      {onPress && !onToggle && <Ionicons name="chevron-forward" size={16} color={t.muted} />}
    </Pressable>
  );
}

/** Bottom sheet. Children render inside a scrollable, safe-area-aware panel. */
export function Sheet({ visible, onClose, title, children }: { visible: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={[styles.backdrop, { backgroundColor: t.overlay }]} onPress={onClose} accessibilityLabel="Close" />
      <View style={[styles.sheet, { backgroundColor: t.card, paddingBottom: 12 + insets.bottom }]}>
        <View style={[styles.grabber, { backgroundColor: t.border }]} />
        {!!title && <Text style={[styles.sheetTitle, { color: t.text }]} numberOfLines={1}>{title}</Text>}
        <ScrollView keyboardShouldPersistTaps="handled" bounces={false}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

export type SheetAction = { label: string; icon: IconName; onPress: () => void; destructive?: boolean; hidden?: boolean };

export function ActionSheet({ visible, onClose, title, actions }: { visible: boolean; onClose: () => void; title?: string; actions: SheetAction[] }) {
  const t = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title}>
      {actions.filter((a) => !a.hidden).map((a) => (
        <Pressable key={a.label} accessibilityRole="button" accessibilityLabel={a.label}
          onPress={() => { onClose(); haptic.tap(); setTimeout(a.onPress, 120); }}
          style={({ pressed }) => [styles.action, { opacity: pressed ? 0.6 : 1 }]}>
          <Ionicons name={a.icon} size={20} color={a.destructive ? t.danger : t.text} />
          <Text style={{ color: a.destructive ? t.danger : t.text, fontSize: 16 }}>{a.label}</Text>
        </Pressable>
      ))}
    </Sheet>
  );
}

/** Single-field text prompt (Android has no Alert.prompt). The body remounts on every open, so it starts from `initial`. */
export function PromptModal(props: {
  visible: boolean; title: string; initial?: string; placeholder?: string; multiline?: boolean; confirmLabel?: string;
  onCancel: () => void; onSubmit: (text: string) => void;
}) {
  const t = useTheme();
  return (
    <Modal visible={props.visible} transparent animationType="fade" onRequestClose={props.onCancel} statusBarTranslucent>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={[styles.promptWrap, { backgroundColor: t.overlay }]}>
        {props.visible && <PromptBody {...props} />}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function PromptBody({ title, initial = '', placeholder, multiline, confirmLabel = 'Save', onCancel, onSubmit }: Parameters<typeof PromptModal>[0]) {
  const t = useTheme();
  const [text, setText] = useState(initial);
  return (
    <View style={[styles.prompt, { backgroundColor: t.card }]}>
      <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
      <TextInput autoFocus value={text} onChangeText={setText} placeholder={placeholder} placeholderTextColor={t.muted} multiline={multiline}
        style={[styles.promptInput, { color: t.text, borderColor: t.border, backgroundColor: t.bg, minHeight: multiline ? 90 : undefined }]} />
      <View style={{ flexDirection: 'row', gap: 10, justifyContent: 'flex-end' }}>
        <Button title="Cancel" variant="ghost" compact onPress={onCancel} />
        <Button title={confirmLabel} compact onPress={() => onSubmit(text.trim())} disabled={!text.trim()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btn: { minHeight: 48, borderRadius: radius.md, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnCompact: { minHeight: 40, paddingHorizontal: 16 },
  btnText: { fontSize: 15, fontWeight: '700' },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  card: { borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.pill },
  chipText: { fontSize: 12, fontWeight: '600', maxWidth: 160 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 20, paddingBottom: 8 },
  sectionTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 10 },
  empty: { alignItems: 'center', paddingHorizontal: 32, paddingTop: 56, paddingBottom: 24 },
  emptyIcon: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  emptyTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center' },
  emptyBody: { fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  skel: { height: 64, borderRadius: radius.lg },
  segment: { flexDirection: 'row', borderRadius: radius.md, padding: 3 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: radius.sm },
  listRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 13, minHeight: 52 },
  rowIcon: { width: 30, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  backdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, maxHeight: '82%', borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, paddingHorizontal: 16, paddingTop: 8 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 10 },
  sheetTitle: { fontSize: 15, fontWeight: '700', marginBottom: 6, paddingHorizontal: 4 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 14, paddingHorizontal: 4, minHeight: 50 },
  promptWrap: { flex: 1, justifyContent: 'center', padding: 24 },
  prompt: { borderRadius: radius.xl, padding: 18, gap: 14 },
  promptInput: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, fontSize: 16, textAlignVertical: 'top' },
});
