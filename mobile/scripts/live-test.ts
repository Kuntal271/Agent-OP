/**
 * Live test of the app's real API client (src/lib/api.ts + sse.ts) against the deployed Hermes.
 * Bundled with esbuild and run on a throwaway tailnet node: `python hermes_modal.py apptest <bundle.mjs>`.
 */
import { HermesClient, HermesError } from '../src/lib/api';
import type { RunEvent } from '../src/lib/types';

const base = process.argv[2];
const c = new HermesClient({ baseUrl: base, apiKey: process.env.API_SERVER_KEY! });
const t0 = Date.now();
const log = (...a: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);
const short = (ev: RunEvent) => String(ev.delta ?? ev.tool ?? ev.output ?? '').replace(/\s+/g, ' ').slice(0, 50);

async function main() {
  log('health', JSON.stringify(await c.health()));
  const s = await c.createSession('App client live test');
  log('session', s.id);
  const r = await c.startRun(s.id, 'Write the numbers 1 to 5 on separate lines, then use your terminal tool to run `date -u`, then reply with the word DONE.', `apptest-${Date.now()}`);
  log('run', JSON.stringify(r));

  // Phase 1: attach, take 3 events, detach on purpose (like the phone going to background).
  let lastSeq: number | undefined;
  let n = 0;
  const ctrl = new AbortController();
  try {
    await c.streamRun(r.run_id, (ev, seq) => {
      lastSeq = seq;
      log('  ev', seq, ev.event, short(ev));
      if (++n >= 3) ctrl.abort();
    }, { signal: ctrl.signal });
  } catch (e) {
    if (!ctrl.signal.aborted) throw e;
  }
  log('detached at seq', lastSeq);
  await new Promise((res) => setTimeout(res, 5000));
  log('status while detached:', (await c.getRun(r.run_id)).status);

  // Phase 2: re-attach after lastSeq; any repeated seq means duplicated output on the phone.
  let terminal: RunEvent | undefined;
  await c.streamRun(r.run_id, (ev, seq) => {
    if (lastSeq != null && seq != null && seq <= lastSeq) throw new Error(`duplicate seq ${seq} after ${lastSeq}`);
    lastSeq = seq;
    log('  ev', seq, ev.event, short(ev));
    if (ev.event.startsWith('run.')) terminal = ev;
  }, { lastSeq });
  log('terminal', terminal?.event, JSON.stringify(terminal?.output));

  const msgs = await c.getMessages(s.id);
  log('messages', msgs.length, msgs.map((m) => m.role).join(','));
  log('listed in sessions:', (await c.listSessions(10)).data.some((x) => x.id === s.id));
  log('pin:', (await c.patchSession(s.id, { pinned: true })).pinned);
  log('jobs:', (await c.listJobs()).length);
  try {
    await new HermesClient({ baseUrl: base, apiKey: 'wrong-key' }).listSessions(1);
    log('bad key: ACCEPTED (unexpected)');
  } catch (e) {
    log('bad key ->', (e as HermesError).status, (e as HermesError).message);
  }
  log('deleted:', (await c.deleteSession(s.id)).deleted);

  const ok = terminal?.event === 'run.completed' && String(terminal.output).includes('DONE');
  console.log(ok ? 'APP CLIENT LIVE TEST: PASS' : 'APP CLIENT LIVE TEST: FAIL');
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error('APP CLIENT LIVE TEST: ERROR', e);
  process.exit(1);
});
