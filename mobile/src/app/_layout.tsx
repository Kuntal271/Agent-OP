import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useTheme } from '@/components/theme';
import { HermesProvider } from '@/state/HermesContext';

export default function RootLayout() {
  const t = useTheme();
  return (
    <SafeAreaProvider>
      <HermesProvider>
        <StatusBar style="auto" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: t.card },
            headerTintColor: t.text,
            headerShadowVisible: false,
            contentStyle: { backgroundColor: t.bg },
          }}>
          <Stack.Screen name="index" options={{ title: 'Hermes' }} />
          <Stack.Screen name="connect" options={{ title: 'Connection' }} />
          <Stack.Screen name="jobs" options={{ title: 'Scheduled jobs' }} />
          <Stack.Screen name="session/[id]" options={{ title: '' }} />
        </Stack>
      </HermesProvider>
    </SafeAreaProvider>
  );
}
