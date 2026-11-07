import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ModelPicker } from '@/components/ModelPicker';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useTheme } from '@/components/theme';
import { Card, Row, SectionHeader, Segmented } from '@/components/ui';
import { prettyModel } from '@/lib/format';
import { authenticate, lockAvailable } from '@/lib/lock';
import { notifyNow, requestNotifyPermission } from '@/lib/notifications';
import { useHermes } from '@/state/HermesContext';
import { useSettings, type ThemeMode } from '@/state/SettingsContext';

const host = (u?: string) => (u ? u.replace(/^https?:\/\//, '') : '—');

export default function SettingsScreen() {
  const t = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { config, online } = useHermes();
  const { settings, update } = useSettings();
  const [picker, setPicker] = useState(false);

  const toggleLock = async (on: boolean) => {
    if (!on) return update({ appLock: false });
    if (!(await lockAvailable())) return Alert.alert('Set up a screen lock first', 'Add a PIN, pattern, or fingerprint in Android Settings → Security, then try again.');
    if (await authenticate('Confirm to turn on app lock')) update({ appLock: true });
  };

  const toggleNotify = async (on: boolean) => {
    if (!on) return update({ notifications: false });
    if (!(await requestNotifyPermission())) {
      return Alert.alert('Notifications are blocked', 'Allow notifications for Hermes in Android Settings.', [
        { text: 'Not now', style: 'cancel' }, { text: 'Open settings', onPress: () => Linking.openSettings() },
      ]);
    }
    update({ notifications: true });
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <ScreenHeader title="Settings" />
      <ScrollView contentContainerStyle={{ paddingBottom: 40 + insets.bottom }}>
        <SectionHeader title="Connection" />
        <Card style={{ marginHorizontal: 16 }}>
          <Row icon="server-outline" title="Server" value={host(config?.baseUrl)} subtitle={online ? 'Reachable' : 'Unreachable'} onPress={() => router.push('/connect')} />
          <Row icon="pulse-outline" title="Server status" subtitle="Version, gateway, health checks" onPress={() => router.push('/server')} last />
        </Card>

        <SectionHeader title="Appearance" />
        <Card style={{ marginHorizontal: 16, padding: 12 }}>
          <Segmented<ThemeMode> value={settings.themeMode} onChange={(themeMode) => update({ themeMode })}
            options={[{ value: 'system', label: 'System' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }]} />
        </Card>

        <SectionHeader title="Chat" />
        <Card style={{ marginHorizontal: 16 }}>
          <Row icon="hardware-chip-outline" title="Default model" value={settings.defaultModel ? prettyModel(settings.defaultModel.model) : 'Server default'} onPress={() => setPicker(true)} />
          <Row icon="mic-outline" title="Send voice messages automatically" subtitle="Dictation sends when you stop talking" toggle={settings.voiceAutoSend} onToggle={(voiceAutoSend) => update({ voiceAutoSend })} />
          <Row icon="volume-high-outline" title="Read replies aloud" subtitle="Speaks Hermes’s answer when a task finishes" toggle={settings.readAloud} onToggle={(readAloud) => update({ readAloud })} />
          <Row icon="phone-portrait-outline" title="Haptic feedback" toggle={settings.haptics} onToggle={(haptics) => update({ haptics })} last />
        </Card>

        <SectionHeader title="Security" />
        <Card style={{ marginHorizontal: 16 }}>
          <Row icon="lock-closed-outline" title="App lock" subtitle="Require fingerprint, face, or PIN to open Hermes. This phone can approve commands, so lock it." toggle={settings.appLock} onToggle={toggleLock} last />
        </Card>

        <SectionHeader title="Notifications" />
        <Card style={{ marginHorizontal: 16 }}>
          <Row icon="notifications-outline" title="Task updates" subtitle="Checks about every 15 minutes while the app is closed" toggle={settings.notifications} onToggle={toggleNotify} />
          <Row icon="paper-plane-outline" title="Send a test notification" onPress={async () => { if (await requestNotifyPermission()) await notifyNow('Hermes', 'Notifications are working.'); else Alert.alert('Notifications are blocked'); }} last />
        </Card>
        <Text style={{ color: t.muted, fontSize: 12, marginHorizontal: 20, marginTop: 8, lineHeight: 17 }}>
          Instant alerts need push notifications, which require a Firebase project. Until then Hermes checks in the background.
        </Text>

        <SectionHeader title="About" />
        <Card style={{ marginHorizontal: 16 }}>
          <Row icon="information-circle-outline" title="App version" value={Constants.expoConfig?.version ?? '—'} />
          <Row icon="logo-github" title="Source code" value="Kuntal271/Agent-OP" onPress={() => Linking.openURL('https://github.com/Kuntal271/Agent-OP')} last />
        </Card>
      </ScrollView>
      <ModelPicker visible={picker} onClose={() => setPicker(false)} value={settings.defaultModel} onSelect={(defaultModel) => update({ defaultModel })} />
    </View>
  );
}
