// Pure-logic checks for helpers that don't need a device: model names, schedules, usage maths, grouping.
//   npm run test:unit        (bundles with esbuild on demand, then runs under Node)

import { isAuthError, parsePasted } from '../src/lib/connect';
import { compactNumber, groupSessions, prettyModel } from '../src/lib/format';
import { composeSchedule, humanSchedule, parseSchedule, validateDraft } from '../src/lib/jobs';
import { summarizeUsage } from '../src/lib/usage';

const assert = {
  equal: (a: unknown, b: unknown) => {
    if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  },
  deepEqual: (a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  },
  ok: (v: unknown, msg = 'expected a truthy value') => {
    if (!v) throw new Error(msg);
  },
};

let passed = 0;
const t = (name: string, fn: () => void) => {
  try {
    fn();
    passed += 1;
    console.log('PASS', name);
  } catch (e) {
    console.log('FAIL', name, '-', (e as Error).message);
    process.exitCode = 1;
  }
};

t('prettyModel: real Bedrock ids', () => {
  assert.equal(prettyModel('global.anthropic.claude-sonnet-5-5'), 'Claude Sonnet 5.5');
  assert.equal(prettyModel('global.anthropic.claude-haiku-4-5-20251001-v1:0'), 'Claude Haiku 4.5');
  assert.equal(prettyModel('global.anthropic.claude-opus-4-5-20251101-v1:0'), 'Claude Opus 4.5');
  assert.equal(prettyModel('amazon.nova-2-lite-v1:0'), 'Nova 2 Lite');
  assert.equal(prettyModel('amazon.nova-pro-v1:0'), 'Nova Pro');
  assert.equal(prettyModel('deepseek.r1-v1:0'), 'DeepSeek R1');
  assert.equal(prettyModel('meta.llama4-maverick-17b-instruct-v1:0'), 'Llama 4 Maverick 17B Instruct');
  assert.equal(prettyModel(null), 'Default');
});

t('compactNumber', () => {
  assert.equal(compactNumber(0), '0');
  assert.equal(compactNumber(950), '950');
  assert.equal(compactNumber(1500), '1.5k');
  assert.equal(compactNumber(129_000), '129k');
  assert.equal(compactNumber(2_400_000), '2.4M');
});

t('schedule: compose -> parse round-trips', () => {
  const draft = { freq: 'weekdays' as const, every: '1', unit: 'h' as const, hh: '09', mm: '30', weekday: 1, custom: '' };
  assert.equal(composeSchedule(draft), '30 9 * * 1-5');
  const parsed = parseSchedule({ id: 'x', schedule: { kind: 'cron', expr: '30 9 * * 1-5' } });
  assert.equal(parsed.freq, 'weekdays');
  assert.equal(parsed.hh, '09');
  assert.equal(parsed.mm, '30');
  assert.equal(composeSchedule({ ...draft, freq: 'daily', hh: '8', mm: '0' }), '0 8 * * *');
  assert.equal(composeSchedule({ ...draft, freq: 'weekly', weekday: 5 }), '30 9 * * 5');
  assert.equal(composeSchedule({ ...draft, freq: 'interval', every: '6', unit: 'h' }), 'every 6h');
});

t('schedule: humane text for lists', () => {
  assert.equal(humanSchedule({ id: 'a', schedule: { kind: 'cron', expr: '0 8 * * *' } }), 'Every day at 08:00');
  assert.equal(humanSchedule({ id: 'b', schedule: { kind: 'interval', minutes: 360 } }), 'Every 6 hours');
  assert.equal(humanSchedule({ id: 'c', schedule: { kind: 'interval', minutes: 45 } }), 'Every 45 minutes');
  assert.equal(humanSchedule({ id: 'd', schedule: { kind: 'cron', expr: '*/5 * * * *', display: '*/5 * * * *' }, schedule_display: '*/5 * * * *' }), '*/5 * * * *');
});

t('schedule: validation', () => {
  const base = { freq: 'daily' as const, every: '1', unit: 'h' as const, hh: '08', mm: '00', weekday: 1, custom: '' };
  assert.equal(validateDraft(base), null);
  assert.ok(validateDraft({ ...base, hh: '25' }));
  assert.ok(validateDraft({ ...base, mm: '61' }));
  assert.ok(validateDraft({ ...base, freq: 'custom', custom: '  ' }));
  assert.ok(validateDraft({ ...base, freq: 'interval', every: '0' }));
});

t('connect: parse a pasted link, URL, or key', () => {
  const link = 'hermes-remote://connect?url=https%3A%2F%2Fkuntal-hermes.tail59b530.ts.net&key=abc123_-XYZ';
  assert.deepEqual(parsePasted(link), { url: 'https://kuntal-hermes.tail59b530.ts.net', key: 'abc123_-XYZ' });
  assert.deepEqual(parsePasted('  https://kuntal-hermes.tail59b530.ts.net/v1/models?x=1  '), { url: 'https://kuntal-hermes.tail59b530.ts.net' });
  assert.deepEqual(parsePasted('Zk3vQ9-longApiKeyValue_123'), { key: 'Zk3vQ9-longApiKeyValue_123' });
  assert.deepEqual(parsePasted('hermes-remote://connect?key=onlykey'), { url: undefined, key: 'onlykey' });
  assert.deepEqual(parsePasted('please paste my key here'), {});
  assert.deepEqual(parsePasted(''), {});
});

t('connect: recognise a rejected key', () => {
  assert.ok(isAuthError('API key rejected (401).'));
  assert.ok(isAuthError('Invalid API key'));
  assert.ok(!isAuthError('Cannot reach Hermes. Is Tailscale connected?'));
  assert.ok(!isAuthError(undefined));
});

const NOW = new Date('2026-11-07T12:00:00').getTime();
const sec = (msAgo: number) => (NOW - msAgo) / 1000;
const H = 3_600_000, D = 24 * H;

t('usage: totals, ranges, per-model split, cache hit', () => {
  const sessions = [
    { id: '1', model: 'm-a', last_active: sec(1 * H), input_tokens: 100, output_tokens: 50, cache_read_tokens: 300, api_call_count: 2, tool_call_count: 1 },
    { id: '2', model: 'm-b', last_active: sec(2 * D), input_tokens: 10, output_tokens: 10, cache_read_tokens: 0 },
    { id: '3', model: 'm-a', last_active: sec(20 * D), input_tokens: 1000, output_tokens: 500 },
    { id: '4', model: 'm-a', last_active: sec(1 * H), input_tokens: 999, is_internal_child: true },
  ];
  const week = summarizeUsage(sessions, 7, NOW);
  assert.equal(week.sessions, 2);
  assert.equal(week.input, 110);
  assert.equal(week.days.length, 7);
  assert.equal(week.days.at(-1)!.tokens, 150);
  assert.equal(Math.round(week.cacheHit * 100), 73); // 300 / (110 + 300)
  assert.equal(summarizeUsage(sessions, 30, NOW).days.length, 30);
  const all = summarizeUsage(sessions, 0, NOW);
  assert.equal(all.sessions, 3);
  assert.equal(all.models[0].model, 'm-a');
  assert.equal(all.top[0].id, '3');
});

t('grouping: pinned, attention, recency buckets', () => {
  const s = (id: string, ago: number, extra = {}) => ({ id, last_active: sec(ago), ...extra });
  const groups = groupSessions(
    [s('p', 3 * D, { pinned: true }), s('today', 1 * H), s('yest', 1.2 * D), s('old', 30 * D), s('busy', 5 * D)],
    new Set(['busy']),
    NOW,
  );
  const names = groups.map((g) => g.title);
  assert.deepEqual(names, ['Needs you · Running', 'Pinned', 'Today', 'Yesterday', 'Earlier']);
  assert.equal(groups[0].data[0].id, 'busy');
});

console.log(`\n${passed} test groups passed`);
