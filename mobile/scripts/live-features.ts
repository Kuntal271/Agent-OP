/**
 * Live feature test: the app's real client + helpers against the deployed Hermes.
 * Bundle with esbuild and run on a tailnet node:  python hermes_modal.py apptest dist/live-features.mjs
 */
import { HermesClient, HermesError } from '../src/lib/api';
import { prettyModel } from '../src/lib/format';
import { composeSchedule, humanSchedule, parseSchedule } from '../src/lib/jobs';
import { summarizeUsage } from '../src/lib/usage';
import type { ChatInput, RunEvent } from '../src/lib/types';

const base = process.argv[2];
const c = new HermesClient({ baseUrl: base, apiKey: process.env.API_SERVER_KEY! });
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const results: [string, boolean, string][] = [];
const check = (name: string, ok: boolean, detail = '') => {
  results.push([name, ok, detail]);
  log(ok ? 'PASS' : 'FAIL', name, detail);
};

// 8x8 solid blue PNG.
const BLUE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEElEQVR4nGNgYPiPAw0pCQCpcD/BFMrqcwAAAABJRU5ErkJggg==';

async function runToEnd(sessionId: string, input: ChatInput, model?: { model: string; provider: string }) {
  const r = await c.startRun(sessionId, input, `feat-${Date.now()}-${Math.random()}`, model);
  let terminal: RunEvent | undefined;
  await c.streamRun(r.run_id, (ev) => {
    if (ev.event.startsWith('run.')) terminal = ev;
  });
  return terminal;
}

async function main() {
  // Idempotent: a previous run that was killed mid-flight may have left titled sessions behind.
  const PREFIX = 'Feature live test';
  for (const stale of (await c.listSessions(200)).data.filter((x) => x.title?.startsWith(PREFIX))) await c.deleteSession(stale.id).catch(() => {});
  const stamp = Date.now();
  const title = `${PREFIX} ${stamp}`;

  // --- server info ---------------------------------------------------------------
  const h = await c.healthDetailed();
  check('health/detailed', h.status === 'ok' && !!h.version, `status=${h.status} v=${h.version} gateway=${h.gateway_state}`);

  const mo = await c.modelOptions();
  const usable = mo.providers.filter((p) => p.authenticated || p.is_current);
  const names = usable.flatMap((p) => p.models).map((m) => prettyModel(m));
  check('model options + friendly names', usable.length > 0 && names.length > 5 && names.every((n) => n.length > 1), `${names.length} models, e.g. ${names.slice(0, 3).join(' / ')}`);

  const skills = await c.listSkills();
  check('skills list (server patched)', skills.length > 5 && skills.every((s) => !!s.name), `${skills.length} skills`);

  // --- sessions: create, rename, duplicate-title error, fork, delete ---------------
  const s = await c.createSession(title);
  const renamed = await c.patchSession(s.id, { title: `${title} (renamed)` });
  check('rename', renamed.title === `${title} (renamed)`);
  const other = await c.createSession(`${title} other`);
  let dupe = '';
  try {
    await c.patchSession(other.id, { title: `${title} (renamed)` });
  } catch (e) {
    dupe = `${(e as HermesError).status} ${(e as HermesError).message}`;
  }
  check('duplicate title rejected with a readable message', dupe.startsWith('400') && /already in use/i.test(dupe), dupe.slice(0, 100));
  await c.deleteSession(other.id);

  // --- image input through the app's ChatInput shape ------------------------------
  const imageTurn = await runToEnd(s.id, [
    { type: 'text', text: 'What single colour fills this image? Answer with one lowercase word.' },
    { type: 'image_url', image_url: { url: `data:image/png;base64,${BLUE_PNG}` } },
  ]);
  check('image attachment understood', imageTurn?.event === 'run.completed' && /blue/i.test(String(imageTurn.output)), `terminal=${imageTurn?.event} output=${JSON.stringify(imageTurn?.output)}`);

  // --- per-run model override ------------------------------------------------------
  const haiku = mo.providers.flatMap((p) => p.models.map((m) => ({ model: m, provider: p.slug }))).find((x) => /haiku-4-5/.test(x.model));
  if (haiku) {
    const o = await runToEnd(s.id, 'Reply with exactly: HAIKU_OK', haiku);
    check('model override run completes', o?.event === 'run.completed' && String(o.output).includes('HAIKU_OK'), `model=${haiku.model}`);
  } else {
    check('model override run completes', false, 'no haiku model offered by server');
  }

  const msgs = await c.getMessages(s.id);
  check('transcript persisted (user+assistant turns)', msgs.filter((m) => m.role === 'user').length >= 2 && msgs.filter((m) => m.role === 'assistant').length >= 2, `${msgs.length} rows`);

  const fork = await c.forkSession(s.id);
  const forkMsgs = await c.getMessages(fork.id);
  check('fork copies the conversation', fork.id !== s.id && forkMsgs.length >= msgs.length - 1, `fork=${fork.id} rows=${forkMsgs.length}`);

  // --- routines: the app's schedule encoder/decoder against the real server ----------
  const draft = { freq: 'weekdays' as const, every: '1', unit: 'h' as const, hh: '09', mm: '30', weekday: 1, custom: '' };
  const sched = composeSchedule(draft);
  const job = await c.createJob({ name: 'live feature routine', prompt: 'Reply hi', schedule: sched, deliver: 'local' });
  const back = parseSchedule(job);
  check('routine create + round-trip parse', back.freq === 'weekdays' && back.hh === '09' && back.mm === '30', `server returned ${JSON.stringify(job.schedule)}`);
  check('routine human text', humanSchedule(job) === 'Weekdays at 09:30', humanSchedule(job));
  check('routine fires in owner timezone', /\+05:30$/.test(String(job.next_run_at)), String(job.next_run_at));
  const edited = await c.updateJob(job.id, { schedule: composeSchedule({ ...draft, freq: 'daily', hh: '07', mm: '15' }) });
  check('routine edit', humanSchedule(edited) === 'Every day at 07:15', humanSchedule(edited));
  const paused = await c.jobAction(job.id, 'pause');
  const resumed = await c.jobAction(job.id, 'resume');
  check('routine pause/resume', (paused.job.enabled === false || paused.job.state === 'paused') && resumed.job.enabled !== false, `${paused.job.state} -> ${resumed.job.state}`);
  let rejected = '';
  try {
    await c.createJob({ name: 'bad', prompt: 'x', schedule: 'whenever you feel like it' });
  } catch (e) {
    rejected = `${(e as HermesError).status} ${(e as HermesError).message}`;
  }
  check('invalid schedule rejected with a readable error', rejected.startsWith('400') && /cron|schedule/i.test(rejected), rejected.slice(0, 90));
  await c.deleteJob(job.id);
  check('routine delete', !(await c.listJobs()).some((j) => j.id === job.id));

  // --- usage maths on real data ---------------------------------------------------------
  const { data } = await c.listSessions(200);
  const week = summarizeUsage(data, 7);
  const all = summarizeUsage(data, 0);
  check('usage aggregation on live sessions', all.sessions > 0 && all.input + all.output >= week.input + week.output && week.days.length === 7, `${all.sessions} sessions, ${all.input + all.output} tokens, cache hit ${Math.round(all.cacheHit * 100)}%`);

  await c.deleteSession(fork.id);
  await c.deleteSession(s.id);
  const failed = results.filter(([, ok]) => !ok);
  console.log(failed.length ? `LIVE FEATURE TEST: FAIL (${failed.length}/${results.length})` : `LIVE FEATURE TEST: PASS (${results.length}/${results.length})`);
  process.exit(failed.length ? 1 : 0);
}

main().catch((e) => {
  console.error('LIVE FEATURE TEST: ERROR', e);
  process.exit(1);
});
