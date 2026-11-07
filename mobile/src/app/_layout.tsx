import * as Notifications from 'expo-notifications';
import { Stack, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { useIsDark, useTheme } from '@/components/theme';
import { Button, Icon } from '@/components/ui';
import { useAppLock } from '@/lib/lock';
import { ensureChannel, setBackgroundWatch } from '@/lib/notifications'; // also registers the background task at module scope
import { HermesProvider, useHermes } from '@/state/HermesContext';
import { SettingsProvider, useSettings } from '@/state/SettingsContext';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <HermesProvider>
          <Shell />
        </HermesProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}

function Shell() {
  const t = useTheme();
  const isDark = useIsDark();
  const { ready: settingsReady } = useSettings();
  const { ready, config } = useHermes();
  if (!ready || !settingsReady) {
    return <View style={[styles.center, { backgroundColor: t.bg }]}><ActivityIndicator color={t.accent} /></View>;
  }
  return (
    <>
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <LockGate>
        <Effects signedIn={!!config} />
        <Stack screenOptions={{ headerStyle: { backgroundColor: t.card }, headerTintColor: t.text, headerShadowVisible: false, contentStyle: { backgroundColor: t.bg } }}>
          <Stack.Protected guard={!!config}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen name="session/[id]" options={{ title: '' }} />
            <Stack.Screen name="routine/[id]" options={{ title: 'Routine' }} />
            <Stack.Screen name="server" options={{ title: 'Server status' }} />
          </Stack.Protected>
          <Stack.Screen name="connect" options={{ title: 'Connect to Hermes' }} />
        </Stack>
      </LockGate>
    </>
  );
}

/** Side effects that need the router and providers: notification taps and background-watch registration. */
function Effects({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const { settings } = useSettings();
  const handled = useRef<string | null>(null);

  // Tapping a notification opens its task. Works for cold starts (last response) and while running.
  useEffect(() => {
    if (!signedIn || Platform.OS === 'web') return;
    const open = (resp: Notifications.NotificationResponse | null) => {
      const key = resp?.notification.request.identifier;
      const sid = resp?.notification.request.content.data?.sessionId;
      if (!key || handled.current === key || typeof sid !== 'string') return;
      handled.current = key;
      router.push({ pathname: '/session/[id]', params: { id: sid } });
    };
    Notifications.getLastNotificationResponseAsync().then(open).catch(() => {});
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, [signedIn, router]);

  useEffect(() => {
    ensureChannel().catch(() => {});
    setBackgroundWatch(signedIn && settings.notifications).catch(() => {});
  }, [signedIn, settings.notifications]);

  return null;
}

function LockGate({ children }: { children: React.ReactNode }) {
  const t = useTheme();
  const { settings } = useSettings();
  const lock = useAppLock(settings.appLock);
  return (
    <View style={{ flex: 1 }}>
      {children}
      {lock.locked && (
        <View style={[styles.lock, { backgroundColor: t.bg }]} accessibilityViewIsModal>
          <View style={[styles.lockIcon, { backgroundColor: t.accentSoft }]}><Icon name="lock-closed" size={34} color={t.accent} /></View>
          <Text style={{ color: t.text, fontSize: 20, fontWeight: '800' }}>Hermes is locked</Text>
          <Text style={{ color: t.muted, textAlign: 'center', marginBottom: 8 }}>Unlock to see your tasks and approvals.</Text>
          <Button title="Unlock" icon="finger-print" onPress={lock.unlock} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lock: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  lockIcon: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center' },
});

/** Last line of defence: a crash anywhere shows this instead of a blank screen. Sits outside the providers, so no context. */
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const dark = useColorScheme() === 'dark';
  const fg = dark ? '#F1F5F9' : '#0F172A';
  return (
    <View style={[styles.center, { backgroundColor: dark ? '#0A0C12' : '#F4F5FA', padding: 28, gap: 12 }]}>
      <Text style={{ color: fg, fontSize: 20, fontWeight: '800' }}>Something went wrong</Text>
      <Text style={{ color: dark ? '#94A3B8' : '#64748B', textAlign: 'center' }} numberOfLines={6}>{error.message}</Text>
      <Pressable onPress={retry} accessibilityRole="button" style={{ backgroundColor: '#4F46E5', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>Try again</Text>
      </Pressable>
    </View>
  );
}
