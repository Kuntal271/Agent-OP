/** Parse what a user pastes on the connect screen: a raw key, a bare URL, or a hermes-remote://connect link. */

export type Pasted = { url?: string; key?: string };

export function parsePasted(text: string): Pasted {
  const s = text.trim();
  if (!s) return {};
  try {
    const u = new URL(s);
    const url = u.searchParams.get('url') ?? undefined;
    const key = u.searchParams.get('key') ?? undefined;
    if (url || key) return { url: url?.replace(/\/+$/, ''), key };
    if (u.protocol === 'https:' || u.protocol === 'http:') return { url: `${u.protocol}//${u.host}` };
  } catch {
    /* not a URL: fall through and treat a single token as a key */
  }
  return /\s/.test(s) ? {} : { key: s };
}

/** True when an API error means "the server is fine but this key is wrong" (e.g. after a key rotation). */
export const isAuthError = (message?: string | null) => !!message && /\b401\b|key rejected|invalid api key|unauthor/i.test(message);
