import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Text, View, StyleSheet } from 'react-native';
import type { ReactNode } from 'react';

import { useTheme } from './theme';

/** Large in-screen title for tab screens (tabs run headerless so the title can scroll with a search field). */
export function ScreenHeader({ title, subtitle, right }: { title: string; subtitle?: string; right?: ReactNode }) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 10, backgroundColor: t.bg }]}>
      <View style={{ flex: 1 }}>
        <Text style={[styles.title, { color: t.text }]} accessibilityRole="header">{title}</Text>
        {!!subtitle && <Text style={{ color: t.muted, fontSize: 13, marginTop: 1 }}>{subtitle}</Text>}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 8 },
  title: { fontSize: 28, fontWeight: '800', letterSpacing: -0.4 },
});
