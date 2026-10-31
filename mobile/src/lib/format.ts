/** Small display helpers shared by the screens. */

import type { Message, Session } from './types';

export function relativeTime(epochSeconds?: number | null): string {
  if (!epochSeconds) return '';
  const s = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return new Date(epochSeconds * 1000).toLocaleDateString();
}

export const sessionTitle = (s: Session) => s.title?.trim() || s.preview?.trim() || 'New task';

/** Message content can be a string or OpenAI-style parts; render the text parts. */
export function messageText(content: unknown): string {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p: any) => (typeof p === 'string' ? p : p?.type === 'text' || p?.text ? p.text ?? '' : p?.type === 'image_url' ? '[image]' : ''))
      .filter(Boolean)
      .join('\n');
  }
  return typeof content === 'object' ? JSON.stringify(content) : String(content);
}

/** Tool results are often JSON envelopes ({output, exit_code, error}); show the useful part. */
export function toolResultPreview(content: unknown, max = 280): string {
  let text = messageText(content);
  try {
    const j = JSON.parse(text);
    if (j && typeof j === 'object') {
      text = j.error ? `error: ${j.error}` : j.output ?? j.result ?? j.content ?? text;
      if (typeof text !== 'string') text = JSON.stringify(text);
    }
  } catch {
    /* plain text */
  }
  text = text.trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function toolCallSummary(m: Message): string[] {
  return (m.tool_calls ?? []).map((tc) => {
    const name = tc.function?.name ?? 'tool';
    let arg = tc.function?.arguments ?? '';
    try {
      const a = JSON.parse(arg);
      arg = a.command ?? a.query ?? a.url ?? a.path ?? a.goal ?? JSON.stringify(a);
    } catch {
      /* keep raw */
    }
    arg = String(arg).replace(/\s+/g, ' ').trim();
    return `${name}${arg ? ` · ${arg.length > 120 ? `${arg.slice(0, 120)}…` : arg}` : ''}`;
  });
}

/** Messages worth showing in the chat: drop bookkeeping rows and empty assistant shells. */
export function visibleMessages(messages: Message[]): Message[] {
  return messages.filter((m) => {
    if (m.role === 'session_meta' || m.role === 'system') return false;
    if (m.role === 'assistant' && !messageText(m.content).trim() && !(m.tool_calls?.length)) return false;
    return true;
  });
}
