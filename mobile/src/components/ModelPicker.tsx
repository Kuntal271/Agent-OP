import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';

import { prettyModel } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { ModelChoice, ModelOptions } from '@/lib/types';
import { useHermes } from '@/state/HermesContext';
import { Icon, Sheet } from './ui';
import { radius, useTheme } from './theme';

type Item = ModelChoice & { current: boolean };

/** Searchable model list from the server. `null` means "use the server default". */
export function ModelPicker({ visible, onClose, value, serverModel, onSelect }: {
  visible: boolean; onClose: () => void; value: ModelChoice | null; serverModel?: string | null; onSelect: (c: ModelChoice | null) => void;
}) {
  const t = useTheme();
  const { client } = useHermes();
  const [opts, setOpts] = useState<ModelOptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!visible || opts || !client) return;
    client.modelOptions().then(setOpts).catch((e) => setError(e?.message ?? String(e)));
  }, [visible, opts, client]);

  const items = useMemo<Item[]>(() => {
    const needle = q.trim().toLowerCase();
    const out: Item[] = [];
    for (const p of opts?.providers ?? []) {
      if (!p.authenticated && !p.is_current) continue;
      for (const m of p.models ?? []) {
        if (needle && !`${m} ${prettyModel(m)}`.toLowerCase().includes(needle)) continue;
        out.push({ model: m, provider: p.slug, current: !!p.is_current });
      }
    }
    const rank = (i: Item) => (i.current ? 0 : 2) + (/claude|sonnet|opus|haiku/i.test(i.model) ? 0 : 1);
    return out.sort((a, b) => rank(a) - rank(b) || prettyModel(b.model).localeCompare(prettyModel(a.model))).slice(0, 80);
  }, [opts, q]);

  const pick = (c: ModelChoice | null) => {
    haptic.tap();
    onSelect(c);
    onClose();
  };

  return (
    <Sheet visible={visible} onClose={onClose} title="Model for this task">
      <TextInput value={q} onChangeText={setQ} placeholder="Search models" placeholderTextColor={t.muted} autoCapitalize="none" autoCorrect={false}
        style={{ color: t.text, backgroundColor: t.bg, borderColor: t.border, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 8, fontSize: 15 }} />
      {!opts && !error && <ActivityIndicator style={{ margin: 20 }} />}
      {!!error && <Text style={{ color: t.danger, padding: 12 }}>{error}</Text>}
      {!q && opts && <Option label="Server default" sub={serverModel ? prettyModel(serverModel) : opts.model ? prettyModel(opts.model) : undefined} selected={!value} onPress={() => pick(null)} />}
      {items.map((i) => (
        <Option key={`${i.provider}:${i.model}`} label={prettyModel(i.model)} sub={i.model} selected={value?.model === i.model && value.provider === i.provider} onPress={() => pick({ model: i.model, provider: i.provider })} />
      ))}
      {!!opts && items.length === 0 && <Text style={{ color: t.muted, padding: 16, textAlign: 'center' }}>No models match “{q}”.</Text>}
    </Sheet>
  );
}

function Option({ label, sub, selected, onPress }: { label: string; sub?: string; selected: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 11, paddingHorizontal: 4, opacity: pressed ? 0.6 : 1 })}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 15, fontWeight: selected ? '700' : '500' }}>{label}</Text>
        {!!sub && <Text style={{ color: t.muted, fontSize: 11.5, marginTop: 1 }} numberOfLines={1}>{sub}</Text>}
      </View>
      {selected && <Icon name="checkmark-circle" size={20} color={t.accent} />}
    </Pressable>
  );
}
