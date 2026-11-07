/** Usage/spend aggregation from the sessions list (the API has no analytics endpoint; the dashboard does). */

import { prettyModel } from './format';
import type { Session } from './types';

export type DayBucket = { key: string; label: string; day: number; tokens: number; input: number; output: number; sessions: number };
export type ModelUsage = { model: string; label: string; tokens: number; sessions: number; cost: number };
export type UsageSummary = {
  sessions: number; input: number; output: number; cacheRead: number; cacheWrite: number;
  calls: number; tools: number; cost: number; cacheHit: number;
  days: DayBucket[]; models: ModelUsage[]; top: Session[];
};

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const when = (s: Session) => (s.last_active ?? s.started_at ?? 0) * 1000;
const tok = (s: Session) => (s.input_tokens ?? 0) + (s.output_tokens ?? 0);

/** rangeDays 0 = all time. The chart always shows the last `chartDays` days. */
export function summarizeUsage(all: Session[], rangeDays: number, now = Date.now(), chartDays = rangeDays === 7 ? 7 : 30): UsageSummary {
  const cutoff = rangeDays > 0 ? now - rangeDays * 86_400_000 : 0;
  const sessions = all.filter((s) => !s.is_internal_child && when(s) >= cutoff);

  const days: DayBucket[] = [];
  const index = new Map<string, DayBucket>();
  for (let i = chartDays - 1; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000);
    const b = { key: ymd(d), label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), day: d.getDate(), tokens: 0, input: 0, output: 0, sessions: 0 };
    days.push(b);
    index.set(b.key, b);
  }
  const byModel = new Map<string, ModelUsage>();
  let input = 0, output = 0, cacheRead = 0, cacheWrite = 0, calls = 0, tools = 0, cost = 0;

  for (const s of sessions) {
    input += s.input_tokens ?? 0;
    output += s.output_tokens ?? 0;
    cacheRead += s.cache_read_tokens ?? 0;
    cacheWrite += s.cache_write_tokens ?? 0;
    calls += s.api_call_count ?? 0;
    tools += s.tool_call_count ?? 0;
    const c = s.actual_cost_usd ?? s.estimated_cost_usd ?? 0;
    cost += c;
    const b = index.get(ymd(new Date(when(s))));
    if (b) { b.tokens += tok(s); b.input += s.input_tokens ?? 0; b.output += s.output_tokens ?? 0; b.sessions += 1; }
    const m = s.model || 'unknown';
    const cur = byModel.get(m) ?? { model: m, label: prettyModel(m), tokens: 0, sessions: 0, cost: 0 };
    cur.tokens += tok(s); cur.sessions += 1; cur.cost += c;
    byModel.set(m, cur);
  }
  const promptTotal = input + cacheRead + cacheWrite;
  return {
    sessions: sessions.length, input, output, cacheRead, cacheWrite, calls, tools, cost,
    cacheHit: promptTotal > 0 ? cacheRead / promptTotal : 0,
    days,
    models: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
    top: [...sessions].sort((a, b) => tok(b) - tok(a)).filter((s) => tok(s) > 0).slice(0, 5),
  };
}
