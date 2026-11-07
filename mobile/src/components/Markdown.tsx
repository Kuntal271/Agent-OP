import * as Clipboard from 'expo-clipboard';
import { memo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import MarkdownDisplay from 'react-native-markdown-display';

import { haptic } from '@/lib/haptics';
import { Icon } from './ui';
import { mono, radius, useTheme } from './theme';

export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const t = useTheme();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await Clipboard.setStringAsync(code);
    haptic.success();
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <View style={[styles.codeWrap, { backgroundColor: t.code, borderColor: t.border }]}>
      <View style={[styles.codeHead, { borderBottomColor: t.border }]}>
        <Text style={{ color: t.muted, fontSize: 11, fontWeight: '600' }}>{(lang || 'code').toUpperCase()}</Text>
        <Pressable onPress={copy} hitSlop={8} accessibilityRole="button" accessibilityLabel="Copy code" style={styles.copyBtn}>
          <Icon name={copied ? 'checkmark' : 'copy-outline'} size={14} color={copied ? t.ok : t.muted} />
          <Text style={{ color: copied ? t.ok : t.muted, fontSize: 11, fontWeight: '600' }}>{copied ? 'Copied' : 'Copy'}</Text>
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <Text selectable style={[mono, { color: t.text, fontSize: 12.5, lineHeight: 18, padding: 10 }]}>{code.replace(/\n$/, '')}</Text>
      </ScrollView>
    </View>
  );
}

/** Markdown for assistant text. Memoised: the live block re-renders on every streamed delta. */
export const Markdown = memo(function Markdown({ children, color }: { children: string; color?: string }) {
  const t = useTheme();
  const fg = color ?? t.text;
  const style = StyleSheet.create({
    body: { color: fg, fontSize: 15, lineHeight: 22 },
    paragraph: { marginTop: 0, marginBottom: 8 },
    heading1: { color: fg, fontSize: 21, fontWeight: '800', marginTop: 6, marginBottom: 8 },
    heading2: { color: fg, fontSize: 18, fontWeight: '800', marginTop: 6, marginBottom: 6 },
    heading3: { color: fg, fontSize: 16, fontWeight: '700', marginTop: 4, marginBottom: 4 },
    heading4: { color: fg, fontSize: 15, fontWeight: '700' },
    strong: { fontWeight: '700' },
    em: { fontStyle: 'italic' },
    link: { color: t.accent, textDecorationLine: 'underline' },
    blockquote: { backgroundColor: t.surface, borderLeftColor: t.accent, borderLeftWidth: 3, paddingHorizontal: 10, paddingVertical: 4, marginVertical: 6 },
    code_inline: { ...mono, backgroundColor: t.code, color: fg, fontSize: 13.5, borderRadius: 4, paddingHorizontal: 4 },
    hr: { backgroundColor: t.border, height: 1, marginVertical: 10 },
    bullet_list: { marginBottom: 6 },
    ordered_list: { marginBottom: 6 },
    list_item: { marginBottom: 2 },
    table: { borderColor: t.border, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, marginVertical: 6 },
    th: { padding: 6, fontWeight: '700' },
    td: { padding: 6 },
    tr: { borderBottomColor: t.border, borderBottomWidth: 1 },
  });
  return (
    <MarkdownDisplay
      style={style}
      rules={{
        fence: (node) => <CodeBlock key={node.key} code={node.content} lang={(node as { sourceInfo?: string }).sourceInfo} />,
        code_block: (node) => <CodeBlock key={node.key} code={node.content} />,
      }}>
      {children}
    </MarkdownDisplay>
  );
});

const styles = StyleSheet.create({
  codeWrap: { borderRadius: radius.md, borderWidth: StyleSheet.hairlineWidth, marginVertical: 6, overflow: 'hidden' },
  codeHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  copyBtn: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
