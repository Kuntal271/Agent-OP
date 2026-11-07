/** Routine (cron job) schedule helpers. The server accepts "every 2h", "30m", cron expressions, or an ISO timestamp. */

import type { Job } from './types';

export type Freq = 'interval' | 'daily' | 'weekdays' | 'weekly' | 'custom';
export type ScheduleDraft = { freq: Freq; every: string; unit: 'm' | 'h'; hh: string; mm: string; weekday: number; custom: string };

export const DEFAULT_DRAFT: ScheduleDraft = { freq: 'daily', every: '1', unit: 'h', hh: '08', mm: '00', weekday: 1, custom: '' };
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const pad = (v: string) => v.padStart(2, '0');

export function composeSchedule(d: ScheduleDraft): string {
  const m = String(Number(d.mm) || 0);
  const h = String(Number(d.hh) || 0);
  switch (d.freq) {
    case 'interval': return `every ${Number(d.every) || 1}${d.unit}`;
    case 'daily': return `${m} ${h} * * *`;
    case 'weekdays': return `${m} ${h} * * 1-5`;
    case 'weekly': return `${m} ${h} * * ${d.weekday}`;
    default: return d.custom.trim();
  }
}

export function validateDraft(d: ScheduleDraft): string | null {
  if (d.freq === 'custom') return d.custom.trim() ? null : 'Enter a schedule, e.g. “every 30m” or “0 9 * * 1-5”.';
  if (d.freq === 'interval') return Number(d.every) >= 1 ? null : 'Interval must be at least 1.';
  const h = Number(d.hh), m = Number(d.mm);
  return Number.isInteger(h) && h >= 0 && h < 24 && Number.isInteger(m) && m >= 0 && m < 60 ? null : 'Time must be between 00:00 and 23:59.';
}

export function describeSchedule(d: ScheduleDraft): string {
  const time = `${pad(d.hh)}:${pad(d.mm)}`;
  switch (d.freq) {
    case 'interval': return `Every ${Number(d.every) || 1} ${d.unit === 'h' ? 'hour' : 'minute'}${Number(d.every) === 1 ? '' : 's'}`;
    case 'daily': return `Every day at ${time}`;
    case 'weekdays': return `Weekdays at ${time}`;
    case 'weekly': return `Every ${WEEKDAYS[d.weekday]} at ${time}`;
    default: return d.custom.trim() || 'Custom schedule';
  }
}

export function jobScheduleText(j: Job): string {
  if (j.schedule_display) return j.schedule_display;
  if (typeof j.schedule === 'string') return j.schedule;
  return j.schedule?.display ?? j.schedule?.expr ?? (j.schedule?.minutes ? `every ${j.schedule.minutes}m` : '');
}

/** Rebuild an editable draft from a stored job. Anything unrecognised becomes a custom schedule. */
export function parseSchedule(j?: Job | null): ScheduleDraft {
  if (!j) return { ...DEFAULT_DRAFT };
  const s = j.schedule;
  if (s && typeof s === 'object') {
    if (s.kind === 'interval' && s.minutes) {
      return s.minutes % 60 === 0
        ? { ...DEFAULT_DRAFT, freq: 'interval', every: String(s.minutes / 60), unit: 'h' }
        : { ...DEFAULT_DRAFT, freq: 'interval', every: String(s.minutes), unit: 'm' };
    }
    const expr = s.expr?.trim();
    if (s.kind === 'cron' && expr) {
      const hit = (re: RegExp) => expr.match(re);
      let m = hit(/^(\d{1,2}) (\d{1,2}) \* \* \*$/);
      if (m) return { ...DEFAULT_DRAFT, freq: 'daily', mm: pad(m[1]), hh: pad(m[2]) };
      m = hit(/^(\d{1,2}) (\d{1,2}) \* \* 1-5$/);
      if (m) return { ...DEFAULT_DRAFT, freq: 'weekdays', mm: pad(m[1]), hh: pad(m[2]) };
      m = hit(/^(\d{1,2}) (\d{1,2}) \* \* ([0-6])$/);
      if (m) return { ...DEFAULT_DRAFT, freq: 'weekly', mm: pad(m[1]), hh: pad(m[2]), weekday: Number(m[3]) };
      return { ...DEFAULT_DRAFT, freq: 'custom', custom: expr };
    }
  }
  return { ...DEFAULT_DRAFT, freq: 'custom', custom: jobScheduleText(j) };
}

/** next_run_at / last_run_at arrive as ISO strings or epoch seconds/milliseconds. */
export function jobDate(v?: string | number | null): Date | null {
  if (v == null || v === '') return null;
  const d = typeof v === 'number' ? new Date(v < 1e12 ? v * 1000 : v) : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function relativeWhen(d: Date | null, now = Date.now()): string {
  if (!d) return '—';
  const diff = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(diff);
  const unit = abs < 60 ? `${abs}s` : abs < 3600 ? `${Math.round(abs / 60)}m` : abs < 86400 ? `${Math.round(abs / 3600)}h` : `${Math.round(abs / 86400)}d`;
  if (abs < 45) return 'now';
  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}
