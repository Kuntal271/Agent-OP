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

/** "global.anthropic.claude-sonnet-5-5" -> "Claude Sonnet 5.5"; "...haiku-4-5-20251001-v1:0" -> "Claude Haiku 4.5". */
export function prettyModel(id?: string | null): string {
  if (!id) return 'Default';
  let s = id.split('/').pop() ?? id;
  s = s.replace(/^(global|us|eu|apac)\./, '');
  // Anthropic/Amazon names are self-explanatory (Claude…, Nova…); other vendors keep their name ("DeepSeek R1").
  const vendor = s.match(/^(meta|mistral|cohere|deepseek|openai|google|qwen)\./)?.[1];
  s = s.replace(/^(anthropic|amazon|meta|mistral|cohere|deepseek|openai|google|qwen)\./, '');
  const VENDOR_LABEL: Record<string, string> = { deepseek: 'DeepSeek', openai: 'OpenAI', qwen: 'Qwen', meta: '', mistral: 'Mistral', cohere: 'Cohere', google: 'Google' };
  s = s.replace(/-v\d+:\d+$/, '').replace(/-\d{8}$/, '');
  s = s.replace(/([a-z]{2,})(\d)/gi, '$1-$2'); // llama4 -> llama-4, but r1 / v1 stay whole; runs after the version suffix is stripped
  const words: string[] = [];
  for (const tok of s.split(/[-_.]/)) {
    if (!tok) continue;
    const prev = words[words.length - 1];
    if (/^\d+$/.test(tok) && prev && /^\d+(\.\d+)*$/.test(prev)) words[words.length - 1] = `${prev}.${tok}`;
    else words.push(/^\d+$/.test(tok) ? tok : /^\d+b$/i.test(tok) ? tok.toUpperCase() : tok.charAt(0).toUpperCase() + tok.slice(1));
  }
  if (vendor && VENDOR_LABEL[vendor]) words.unshift(VENDOR_LABEL[vendor]);
  if (words[0]?.toLowerCase() === 'r1') words[0] = 'R1';
  return words.join(' ');
}

export const compactNumber = (n?: number | null): string => {
  const v = n ?? 0;
  if (v >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}k`;
  return String(Math.round(v));
};

export const money = (n?: number | null): string => (n && n > 0 ? `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}` : '—');

export type SessionGroup = { title: string; data: Session[] };

/** Pinned first, then by recency buckets. `attention` ids (running / needs you) are lifted into their own group. */
export function groupSessions(sessions: Session[], attention: Set<string>, now = Date.now()): SessionGroup[] {
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const day = 86_400_000;
  const t0 = startOfToday.getTime();
  const buckets: Record<string, Session[]> = { Attention: [], Pinned: [], Today: [], Yesterday: [], 'This week': [], Earlier: [] };
  const last = (s: Session) => (s.last_active ?? s.started_at ?? 0) * 1000;
  for (const s of [...sessions].sort((a, b) => last(b) - last(a))) {
    const t = last(s);
    if (attention.has(s.id)) buckets.Attention.push(s);
    else if (s.pinned) buckets.Pinned.push(s);
    else if (t >= t0) buckets.Today.push(s);
    else if (t >= t0 - day) buckets.Yesterday.push(s);
    else if (t >= t0 - 6 * day) buckets['This week'].push(s);
    else buckets.Earlier.push(s);
  }
  const titles: Record<string, string> = { Attention: 'Needs you · Running' };
  return Object.entries(buckets)
    .filter(([, data]) => data.length)
    .map(([k, data]) => ({ title: titles[k] ?? k, data }));
}

export const sourceLabel = (source?: string): string | null => {
  if (!source || source === 'api_server') return null;
  const map: Record<string, string> = { cron: 'Routine', cli: 'Terminal', tui: 'Terminal', desktop: 'Desktop', telegram: 'Telegram', discord: 'Discord', slack: 'Slack' };
  return map[source] ?? source;
};

/** Text of a message plus any inline images (data URLs) from OpenAI-style content parts. */
export function messageImages(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return content
    .map((p: any) => (p?.type === 'image_url' ? p.image_url?.url ?? p.image_url : null))
    .filter((u): u is string => typeof u === 'string' && u.startsWith('data:image'));
}
