import { memo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { messageImages, messageText, toolCallSummary, toolResultPreview } from '@/lib/format';
import { haptic } from '@/lib/haptics';
import type { Message } from '@/lib/types';
import { Markdown } from './Markdown';
import { Icon } from './ui';
import { mono, radius, useTheme } from './theme';

function ToolResult({ m }: { m: Message }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const preview = toolResultPreview(m.content, open ? 4000 : 140);
  return (
    <Pressable onPress={() => { haptic.tap(); setOpen((o) => !o); }} accessibilityRole="button" accessibilityLabel={`${m.tool_name ?? 'tool'} result`}
      style={[styles.tool, { borderColor: t.border }]}>
      <View style={styles.toolHead}>
        <Icon name="return-down-forward" size={13} color={t.muted} />
        <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>{m.tool_name ?? 'tool'} result</Text>
        <Icon name={open ? 'chevron-up' : 'chevron-down'} size={13} color={t.muted} />
      </View>
      {!!preview && <Text selectable style={[mono, { color: t.muted, fontSize: 12 }]} numberOfLines={open ? undefined : 2}>{preview}</Text>}
    </Pressable>
  );
}

type Props = { m: Message; onLongPress?: (m: Message, text: string) => void };

export const MessageItem = memo(function MessageItem({ m, onLongPress }: Props) {
  const t = useTheme();
  if (m.role === 'tool') return <ToolResult m={m} />;
  const text = messageText(m.content).replace(/\n?\[image\]/g, '').trim();
  const images = messageImages(m.content);
  const press = () => { haptic.press(); onLongPress?.(m, text); };

  if (m.role === 'user') {
    return (
      <Pressable onLongPress={press} delayLongPress={350} style={[styles.bubble, styles.user, { backgroundColor: t.userBubble }]}>
        {images.map((u, i) => <Image key={i} source={{ uri: u }} style={styles.inlineImg} accessibilityLabel="Attached image" />)}
        {!!text && <Text selectable style={{ color: t.userText, fontSize: 15, lineHeight: 21 }}>{text}</Text>}
      </Pressable>
    );
  }

  const calls = toolCallSummary(m);
  return (
    <View style={{ gap: 6, alignSelf: 'stretch' }}>
      {!!text && (
        <Pressable onLongPress={press} delayLongPress={350} style={[styles.bubble, styles.bot, { backgroundColor: t.botBubble, borderColor: t.border }]}>
          <Markdown>{text}</Markdown>
        </Pressable>
      )}
      {calls.map((c, i) => (
        <View key={i} style={styles.call}>
          <Icon name="construct-outline" size={13} color={t.muted} />
          <Text numberOfLines={2} style={[mono, { color: t.muted, fontSize: 12, flex: 1 }]}>{c}</Text>
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  bubble: { borderRadius: radius.lg, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '94%' },
  user: { alignSelf: 'flex-end', borderBottomRightRadius: 4, gap: 8 },
  bot: { alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  inlineImg: { width: 200, height: 200, borderRadius: radius.md },
  tool: { borderLeftWidth: 2, paddingLeft: 10, paddingVertical: 2, gap: 2, marginLeft: 6 },
  toolHead: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  call: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 6 },
});
