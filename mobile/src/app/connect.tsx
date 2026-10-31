import { router } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { mono, useTheme } from '@/components/theme';
import { HermesClient, HermesError } from '@/lib/api';
import { DEFAULT_BASE_URL } from '@/lib/storage';
import { useHermes } from '@/state/HermesContext';

export default function ConnectScreen() {
  const t = useTheme();
  const { config, connect, disconnect } = useHermes();
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl ?? DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState(config?.apiKey ?? '');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);

  const testAndSave = async () => {
    const cfg = { baseUrl: baseUrl.trim().replace(/\/+$/, ''), apiKey: apiKey.trim() };
    if (!/^https?:\/\//.test(cfg.baseUrl) || !cfg.apiKey) {
      setStatus({ ok: false, text: 'Enter the server URL (https://…) and the API key.' });
      return;
    }
    setBusy(true);
    setStatus(null);
    const c = new HermesClient(cfg);
    try {
      const h = await c.health(); // reachability (tailnet + TLS), no auth needed
      await c.listSessions(1); // proves the key
      await connect(cfg);
      setStatus({ ok: true, text: `Connected to Hermes ${h.version ?? ''}` });
      router.replace('/');
    } catch (e) {
      const err = e as HermesError;
      setStatus({
        ok: false,
        text:
          err.code === 'network' || err.code === 'timeout'
            ? 'Cannot reach the server. Open the Tailscale app and make sure it is connected to your personal tailnet.'
            : err.status === 401
              ? 'Server reached, but the API key was rejected.'
              : err.message,
      });
    } finally {
      setBusy(false);
    }
  };

  const input = [styles.input, { color: t.text, borderColor: t.border, backgroundColor: t.card }];
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: t.muted }]}>Server URL</Text>
        <TextInput style={input} value={baseUrl} onChangeText={setBaseUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder={DEFAULT_BASE_URL} placeholderTextColor={t.muted} />
        <Text style={[styles.label, { color: t.muted }]}>API key</Text>
        <TextInput style={[input, mono]} value={apiKey} onChangeText={setApiKey} autoCapitalize="none" autoCorrect={false} secureTextEntry placeholder="API_SERVER_KEY" placeholderTextColor={t.muted} />
        <Text style={[styles.hint, { color: t.muted }]}>
          Saved in the phone keystore. The server is only reachable while Tailscale is connected.
        </Text>
        <Pressable onPress={testAndSave} disabled={busy} style={({ pressed }) => [styles.button, { backgroundColor: t.accent, opacity: pressed || busy ? 0.7 : 1 }]}>
          {busy ? <ActivityIndicator color={t.accentText} /> : <Text style={[styles.buttonText, { color: t.accentText }]}>Test & save</Text>}
        </Pressable>
        {status && <Text style={[styles.status, { color: status.ok ? t.ok : t.danger }]}>{status.text}</Text>}
        {config && (
          <View style={{ marginTop: 32 }}>
            <Pressable onPress={async () => { await disconnect(); setApiKey(''); }} style={({ pressed }) => [styles.button, { backgroundColor: t.card, borderColor: t.border, borderWidth: 1, opacity: pressed ? 0.7 : 1 }]}>
              <Text style={[styles.buttonText, { color: t.danger }]}>Forget this server</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 8 },
  label: { fontSize: 13, fontWeight: '600', marginTop: 12 },
  input: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 15 },
  hint: { fontSize: 12, marginTop: 4 },
  button: { marginTop: 20, borderRadius: 10, paddingVertical: 13, alignItems: 'center' },
  buttonText: { fontSize: 16, fontWeight: '600' },
  status: { marginTop: 14, fontSize: 14 },
});
