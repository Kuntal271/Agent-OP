import { memo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { messageText, toolCallSummary, toolResultPreview } from '@/lib/format';
import type { Message } from '@/lib/types';
import { mono, useTheme } from './theme';

/** Plain text with ``` fenced blocks rendered monospace. Selectable so answers can be copied. */
export function RichText({ text, color }: { text: string; color: string }) {
  const t = useTheme();
  const parts = text.split('```');
  return (
    <View style={{ gap: 6 }}>
      {parts.map((part, i) => {
        if (!part) return null;
        if (i % 2 === 1) {
          const body = part.replace(/^[\w+-]*\n/, ''); // drop the language tag line
          return (
            <View key={i} style={[styles.code, { backgroundColor: t.code }]}>
              <Text selectable style={[mono, { color: t.text, fontSize: 12.5 }]}>{body.replace(/\n$/, '')}</Text>
            </View>
          );
        }
        return <Text key={i} selectable style={{ color, fontSize: 15, lineHeight: 21 }}>{part.trim()}</Text>;
      })}
    </View>
  );
}

function ToolResult({ m }: { m: Message }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const preview = toolResultPreview(m.content, open ? 4000 : 140);
  return (
    <Pressable onPress={() => setOpen((o) => !o)} style={[styles.tool, { borderColor: t.border }]}>
      <Text style={{ color: t.muted, fontSize: 12, fontWeight: '600' }}>↳ {m.tool_name ?? 'tool'} result {open ? '▴' : '▾'}</Text>
      {!!preview && <Text selectable style={[mono, { color: t.muted, fontSize: 12 }]} numberOfLines={open ? undefined : 2}>{preview}</Text>}
    </Pressable>
  );
}

export const MessageItem = memo(function MessageItem({ m }: { m: Message }) {
  const t = useTheme();
  if (m.role === 'tool') return <ToolResult m={m} />;
  const text = messageText(m.content).trim();
  if (m.role === 'user') {
    return (
      <View style={[styles.bubble, styles.user, { backgroundColor: t.userBubble }]}>
        <Text selectable style={{ color: t.userText, fontSize: 15, lineHeight: 21 }}>{text}</Text>
      </View>
    );
  }
  const calls = toolCallSummary(m);
  return (
    <View style={{ gap: 6, alignSelf: 'stretch' }}>
      {!!text && (
        <View style={[styles.bubble, styles.bot, { backgroundColor: t.botBubble, borderColor: t.border }]}>
          <RichText text={text} color={t.text} />
        </View>
      )}
      {calls.map((c, i) => (
        <Text key={i} numberOfLines={2} style={[mono, styles.call, { color: t.muted }]}>⚙ {c}</Text>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  bubble: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 10, maxWidth: '92%' },
  user: { alignSelf: 'flex-end', borderBottomRightRadius: 4 },
  bot: { alignSelf: 'flex-start', borderBottomLeftRadius: 4, borderWidth: StyleSheet.hairlineWidth },
  code: { borderRadius: 8, padding: 10 },
  tool: { borderLeftWidth: 2, paddingLeft: 10, paddingVertical: 2, gap: 2, marginLeft: 6 },
  call: { fontSize: 12, marginLeft: 6 },
});
