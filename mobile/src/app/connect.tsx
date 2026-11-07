import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { mono, radius, useTheme } from '@/components/theme';
import { Banner, Button, Card, Icon, IconButton } from '@/components/ui';
import { HermesClient, HermesError } from '@/lib/api';
import { parsePasted } from '@/lib/connect';
import { haptic } from '@/lib/haptics';
import { DEFAULT_BASE_URL } from '@/lib/storage';
import { useHermes } from '@/state/HermesContext';

export default function ConnectScreen() {
  const t = useTheme();
  const params = useLocalSearchParams<{ url?: string; key?: string }>();
  const { config, connect, disconnect } = useHermes();
  const [baseUrl, setBaseUrl] = useState(params.url ?? config?.baseUrl ?? DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState(params.key ?? config?.apiKey ?? '');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const paste = async () => {
    const got = parsePasted(await Clipboard.getStringAsync());
    if (!got.url && !got.key) return setStatus({ ok: false, text: 'Nothing usable on the clipboard. Copy the API key (or the connect link) first.' });
    if (got.url) setBaseUrl(got.url);
    if (got.key) setApiKey(got.key);
    haptic.tap();
    setStatus({ ok: true, text: 'Pasted. Tap “Connect” to continue.' });
  };

  const testAndSave = async () => {
    const cfg = { baseUrl: baseUrl.trim().replace(/\/+$/, ''), apiKey: apiKey.trim() };
    if (!/^https?:\/\//.test(cfg.baseUrl) || !cfg.apiKey) return setStatus({ ok: false, text: 'Enter the server URL (https://…) and the API key.' });
    setBusy(true);
    setStatus(null);
    const c = new HermesClient(cfg);
    try {
      const h = await c.health(); // reachability (tailnet + TLS), no auth needed
      await c.listSessions(1); // proves the key
      await connect(cfg);
      haptic.success();
      setStatus({ ok: true, text: `Connected to Hermes ${h.version ?? ''}` });
      router.replace('/');
    } catch (e) {
      haptic.error();
      const err = e as HermesError;
      setStatus({
        ok: false,
        text: err.code === 'network' || err.code === 'timeout'
          ? 'Can’t reach the server. Open the Tailscale app and make sure it is connected to your tailnet.'
          : err.status === 401 ? 'Server reached, but the API key was rejected.' : err.message,
      });
    } finally {
      setBusy(false);
    }
  };

  const forget = () =>
    Alert.alert('Forget this server?', 'The key is removed from this phone. Tasks stay on the server.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Forget', style: 'destructive', onPress: async () => { await disconnect(); setApiKey(''); } },
    ]);

  const field = [styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.card }];
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {!config && (
          <View style={styles.hero}>
            <View style={[styles.logo, { backgroundColor: t.accent }]}><Icon name="paper-plane" size={34} color={t.accentText} /></View>
            <Text style={{ color: t.text, fontSize: 26, fontWeight: '800' }}>Hermes</Text>
            <Text style={{ color: t.muted, textAlign: 'center', lineHeight: 20 }}>Run tasks on your always-on agent and pick them up from anywhere.</Text>
          </View>
        )}

        {!config && (
          <Card style={styles.steps}>
            <Step n={1} text="Install Tailscale on this phone and sign in to the same account as your server." link="Get Tailscale" onLink={() => Linking.openURL('https://play.google.com/store/apps/details?id=com.tailscale.ipn')} />
            <Step n={2} text="Copy the server URL and API key (or the connect link) from your Mac." />
            <Step n={3} text="Tap Paste, then Connect." />
          </Card>
        )}

        <Text style={[styles.label, { color: t.muted }]}>SERVER URL</Text>
        <TextInput style={field} value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder={DEFAULT_BASE_URL} placeholderTextColor={t.muted} accessibilityLabel="Server URL" />
        <Text style={[styles.label, { color: t.muted }]}>API KEY</Text>
        <View>
          <TextInput style={[...field, apiKey ? mono : null, { paddingRight: 48 }]} value={apiKey} onChangeText={setApiKey} autoCapitalize="none" autoCorrect={false} secureTextEntry={!show} placeholder="Paste your API key" placeholderTextColor={t.muted} accessibilityLabel="API key" />
          <View style={styles.eye}><IconButton name={show ? 'eye-off-outline' : 'eye-outline'} label={show ? 'Hide key' : 'Show key'} color={t.muted} onPress={() => setShow((s) => !s)} /></View>
        </View>
        <View style={styles.actions}>
          <Button title="Paste from clipboard" icon="clipboard-outline" variant="secondary" compact onPress={paste} />
        </View>
        <Text style={{ color: t.muted, fontSize: 12 }}>The key is stored in this phone’s secure keystore. The server only answers while Tailscale is connected.</Text>

        <Button title="Connect" icon="link" onPress={testAndSave} loading={busy} disabled={!apiKey.trim() || !baseUrl.trim()} style={{ marginTop: 12 }} />
        {status && <Banner tone={status.ok ? 'ok' : 'danger'} text={status.text} />}

        {config && <Button title="Forget this server" icon="log-out-outline" variant="danger" onPress={forget} style={{ marginTop: 24 }} />}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Step({ n, text, link, onLink }: { n: number; text: string; link?: string; onLink?: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <View style={[styles.num, { backgroundColor: t.accentSoft }]}><Text style={{ color: t.accent, fontWeight: '800', fontSize: 12 }}>{n}</Text></View>
      <Text style={{ color: t.text, flex: 1, lineHeight: 20 }}>{text}{link ? <Text onPress={onLink} accessibilityRole="link" style={{ color: t.accent, fontWeight: '700' }}> {link}</Text> : null}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 8, paddingBottom: 48 },
  hero: { alignItems: 'center', gap: 8, paddingVertical: 12 },
  logo: { width: 68, height: 68, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  steps: { padding: 14, gap: 12, marginVertical: 8 },
  num: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginTop: 10 },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  actions: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  eye: { position: 'absolute', right: 4, top: 0, bottom: 0, justifyContent: 'center' },
});
