import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useCallback } from 'react';
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Banner, Button, Card, Icon, Row, SectionHeader } from '@/components/ui';
import { useTheme } from '@/components/theme';
import { haptic } from '@/lib/haptics';
import { useHermes } from '@/state/HermesContext';
import { useAsync } from '@/state/useAsync';

export default function ServerStatus() {
  const t = useTheme();
  const router = useRouter();
  const { client, config, online } = useHermes();
  const fetchHealth = useCallback(() => client!.healthDetailed(), [client]);
  const { data, error, loading, refreshing, refresh } = useAsync(client ? fetchHealth : null, { pollMs: 10_000 });
  const checks = Object.entries(data?.readiness?.checks ?? {});
  const platforms = Object.entries(data?.platforms ?? {});
  const healthy = online && !error && data?.status === 'ok';

  const copy = async () => {
    await Clipboard.setStringAsync(JSON.stringify({ server: config?.baseUrl, online, health: data ?? null, error: error ?? null }, null, 2));
    haptic.success();
  };

  return (
    <ScrollView contentContainerStyle={styles.body} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.accent} />}>
      {loading ? <ActivityIndicator style={{ margin: 40 }} /> : (
        <>
          <View style={styles.hero}>
            <View style={[styles.dot, { backgroundColor: healthy ? t.okSoft : t.dangerSoft }]}>
              <Icon name={healthy ? 'checkmark-circle' : 'alert-circle'} size={40} color={healthy ? t.ok : t.danger} />
            </View>
            <Text style={{ color: t.text, fontSize: 20, fontWeight: '800' }}>{healthy ? 'Hermes is running' : 'Hermes needs attention'}</Text>
            <Text style={{ color: t.muted, fontSize: 13 }}>{config?.baseUrl}</Text>
          </View>
          {!online && <Banner tone="danger" text="This phone can’t reach the server. Open Tailscale and check it’s connected." />}
          {!!error && online && <Banner tone="warn" text={error} />}

          <SectionHeader title="Server" />
          <Card>
            <Row title="Status" value={data?.status ?? '—'} />
            <Row title="Hermes version" value={data?.version ?? '—'} />
            <Row title="Gateway" value={data?.gateway_state ?? '—'} last={!checks.length && !platforms.length} />
          </Card>

          {checks.length > 0 && (
            <>
              <SectionHeader title="Readiness checks" />
              <Card>
                {checks.map(([name, c], i) => (
                  <Row key={name} icon={c.status === 'ok' ? 'checkmark-circle-outline' : 'alert-circle-outline'} title={name.replace(/_/g, ' ')} value={String(c.status)} last={i === checks.length - 1} />
                ))}
              </Card>
            </>
          )}
          {platforms.length > 0 && (
            <>
              <SectionHeader title="Connected platforms" />
              <Card>
                {platforms.map(([name, p], i) => <Row key={name} icon="link-outline" title={name} value={String(p.state ?? 'unknown')} last={i === platforms.length - 1} />)}
              </Card>
            </>
          )}

          <View style={{ gap: 10, marginTop: 20 }}>
            <Button title="Copy diagnostics" icon="copy-outline" variant="secondary" onPress={copy} />
            <Button title="Edit connection" icon="key-outline" variant="secondary" onPress={() => router.push('/connect')} />
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { padding: 16, paddingBottom: 48 },
  hero: { alignItems: 'center', gap: 6, paddingVertical: 20 },
  dot: { width: 76, height: 76, borderRadius: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 6 },
});
