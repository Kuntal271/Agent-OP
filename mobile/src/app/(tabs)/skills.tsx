import { useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, RefreshControl, SectionList, StyleSheet, Text, TextInput, View, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ScreenHeader } from '@/components/ScreenHeader';
import { radius, useTheme } from '@/components/theme';
import { Banner, Button, EmptyState, Icon, Sheet, Skeleton } from '@/components/ui';
import type { Skill } from '@/lib/types';
import { useHermes } from '@/state/HermesContext';
import { useAsync } from '@/state/useAsync';

export default function SkillsScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { client, online } = useHermes();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Skill | null>(null);
  const [starting, setStarting] = useState(false);
  const fetchSkills = useCallback(() => client!.listSkills(), [client]);
  const { data, error, loading, refreshing, refresh, reload } = useAsync(client ? fetchSkills : null, { focus: false });

  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    const by = new Map<string, Skill[]>();
    for (const s of data ?? []) {
      if (q && !`${s.name} ${s.description ?? ''} ${s.category ?? ''}`.toLowerCase().includes(q)) continue;
      const cat = s.category || 'General';
      by.set(cat, [...(by.get(cat) ?? []), s]);
    }
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([title, items]) => ({ title, data: items.sort((a, b) => a.name.localeCompare(b.name)) }));
  }, [data, query]);

  const startWithSkill = async (s: Skill) => {
    if (!client || starting) return;
    setStarting(true);
    try {
      const sess = await client.createSession();
      setPicked(null);
      router.push({ pathname: '/session/[id]', params: { id: sess.id, prefill: `Use the “${s.name}” skill to ` } });
    } catch (e: any) {
      Alert.alert('Could not start a task', e?.message ?? String(e));
    } finally {
      setStarting(false);
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="Skills" subtitle={data ? `${data.length} things Hermes already knows how to do` : 'Reusable abilities'} />
      {!online && <Banner tone="danger" text="Can’t reach Hermes. Check that Tailscale is on." />}
      <View style={[styles.search, { backgroundColor: t.card, borderColor: t.border }]}>
        <Icon name="search" size={18} color={t.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="Search skills" placeholderTextColor={t.muted} style={{ flex: 1, color: t.text, fontSize: 15, paddingVertical: 10 }} accessibilityLabel="Search skills" />
      </View>
      {loading ? <Skeleton /> : (
        <SectionList
          sections={sections}
          keyExtractor={(s) => s.name}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 40 + insets.bottom, flexGrow: 1 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.accent} />}
          renderSectionHeader={({ section }) => <Text style={[styles.group, { color: t.muted }]}>{section.title.toUpperCase()}</Text>}
          ListEmptyComponent={
            error ? <EmptyState icon="warning-outline" title="Skills aren’t available" body={error} action="Retry" onAction={reload} />
            : <EmptyState icon="flash-outline" title="No skills found" body={query ? `Nothing matches “${query}”.` : undefined} />
          }
          renderItem={({ item }) => (
            <Pressable onPress={() => setPicked(item)} accessibilityRole="button" accessibilityLabel={item.name}
              style={({ pressed }) => [styles.row, { backgroundColor: t.card, borderColor: t.border, opacity: pressed ? 0.75 : 1 }]}>
              <View style={[styles.badge, { backgroundColor: t.accentSoft }]}><Icon name="flash" size={16} color={t.accent} /></View>
              <View style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ color: t.text, fontWeight: '700', fontSize: 15 }}>{item.name}</Text>
                {!!item.description && <Text numberOfLines={2} style={{ color: t.muted, fontSize: 13, marginTop: 1 }}>{item.description}</Text>}
              </View>
            </Pressable>
          )}
        />
      )}
      <Sheet visible={!!picked} onClose={() => setPicked(null)} title={picked?.name}>
        {!!picked?.category && <Text style={{ color: t.accent, fontSize: 12, fontWeight: '700', marginBottom: 6 }}>{picked.category.toUpperCase()}</Text>}
        <Text style={{ color: t.text, fontSize: 15, lineHeight: 22, marginBottom: 16 }}>{picked?.description || 'No description provided.'}</Text>
        <Button title="Use in a new task" icon="chatbubble-ellipses-outline" onPress={() => picked && startWithSkill(picked)} loading={starting} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 16, marginBottom: 4, paddingHorizontal: 12, borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth },
  group: { fontSize: 12, fontWeight: '700', letterSpacing: 0.6, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 16, marginBottom: 8, padding: 12, borderRadius: radius.lg, borderWidth: StyleSheet.hairlineWidth },
  badge: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
});
