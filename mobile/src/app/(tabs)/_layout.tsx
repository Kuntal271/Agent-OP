import { Tabs } from 'expo-router';
import { useMemo } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ColorValue } from 'react-native';

import { useTheme } from '@/components/theme';
import { Icon, type IconName } from '@/components/ui';
import { haptic } from '@/lib/haptics';
import { isTerminal } from '@/lib/types';
import { useHermes } from '@/state/HermesContext';

const tab = (title: string, active: IconName, idle: IconName) => ({
  title,
  tabBarIcon: ({ focused, color }: { focused: boolean; color: ColorValue }) => <Icon name={focused ? active : idle} size={23} color={color as string} />,
});

export default function TabsLayout() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { runs } = useHermes();
  // Badge = tasks that need a human: waiting for approval, failed, or finished unseen.
  const attention = useMemo(
    () => Object.values(runs).filter((r) => r.status === 'waiting_for_approval' || r.status === 'failed' || (isTerminal(r.status) && r.unread)).length,
    [runs],
  );
  return (
    <Tabs
      screenListeners={{ tabPress: () => haptic.tap() }}
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: t.accent,
        tabBarInactiveTintColor: t.muted,
        tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border, height: 68 + insets.bottom, paddingTop: 4, paddingBottom: 4 + insets.bottom },
        tabBarLabelStyle: { fontSize: 11, lineHeight: 14, fontWeight: '600' },
        tabBarItemStyle: { paddingVertical: 2 },
        sceneStyle: { backgroundColor: t.bg },
      }}>
      <Tabs.Screen name="index" options={{ ...tab('Tasks', 'chatbubbles', 'chatbubbles-outline'), tabBarBadge: attention > 0 ? attention : undefined }} />
      <Tabs.Screen name="routines" options={tab('Routines', 'timer', 'timer-outline')} />
      <Tabs.Screen name="skills" options={tab('Skills', 'flash', 'flash-outline')} />
      <Tabs.Screen name="usage" options={tab('Usage', 'stats-chart', 'stats-chart-outline')} />
      <Tabs.Screen name="settings" options={tab('Settings', 'settings', 'settings-outline')} />
    </Tabs>
  );
}
