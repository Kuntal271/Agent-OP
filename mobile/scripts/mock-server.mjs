#!/usr/bin/env node
// Mock Hermes API server for UI development and visual QA. No dependencies.
//   node scripts/mock-server.mjs [port]      key: mock-key
// Wire format mirrors the real gateway (verified live): REST + SSE on /v1/runs/{id}/events.
import http from 'node:http';

const PORT = Number(process.argv[2] ?? 8787);
const KEY = 'mock-key';
const now = () => Math.floor(Date.now() / 1000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const DAY = 86400;

const S = (id, title, o = {}) => ({
  id, title, preview: o.preview ?? title, source: 'api_server', model: 'global.anthropic.claude-sonnet-5-5',
  started_at: now() - (o.ago ?? 600) - 300, last_active: now() - (o.ago ?? 600), message_count: 4, tool_call_count: o.tools ?? 2,
  api_call_count: o.calls ?? 3, input_tokens: o.inTok ?? 4200, output_tokens: o.outTok ?? 1100, cache_read_tokens: o.cache ?? 18000, cache_write_tokens: 0,
  estimated_cost_usd: null, actual_cost_usd: null, pinned: false, archived: false, hidden: false, is_internal_child: false, ...o.x,
});
const sessions = [
  S('s1', 'Server health check', { ago: 300, x: { pinned: true }, inTok: 9800, outTok: 2400 }),
  S('s2', 'Morning briefing', { ago: 2 * 3600, x: { source: 'cron' }, preview: 'Top AI news: 5 bullet points' }),
  S('s3', 'Refactor billing module', { ago: 5 * 3600, inTok: 41000, outTok: 9800, tools: 14 }),
  S('s4', 'Trip planning: Lisbon in March', { ago: DAY + 3600, inTok: 12000, outTok: 6000 }),
  S('s5', 'Compare Postgres vs DuckDB for analytics', { ago: 3 * DAY, inTok: 22000, outTok: 5200, x: { model: 'global.anthropic.claude-haiku-4-5-20251001-v1:0' } }),
  S('s6', 'Old experiment', { ago: 20 * DAY, x: { archived: true } }),
  S('s7', 'Terminal: fix flaky test', { ago: 8 * 3600, x: { source: 'cli' } }),
  S('s8', 'Photo renamer script', { ago: 6 * DAY, inTok: 7000, outTok: 3100 }),
  S('s9', 'Weekly report draft', { ago: 9 * DAY, inTok: 15000, outTok: 4400 }),
];
const md = `Here is the summary of the server:

## Health
- **CPU**: 3% across 0.125 cores
- **Memory**: 412 MiB of 1 GiB
- **Disk**: 62% used

| Check | Status |
|---|---|
| API server | ok |
| Gateway | running |
| Tailscale | connected |

\`\`\`bash
df -h /root
# Filesystem  Size  Used Avail Use%
# overlay     20G   12G   7.6G  62%
\`\`\`

Nothing needs attention. See [the docs](https://hermes-agent.nousresearch.com/docs) for tuning.`;
const messages = {
  s1: [
    { id: 1, role: 'user', content: 'Check the health of this server and summarise it.', timestamp: now() - 400 },
    { id: 2, role: 'assistant', content: '', tool_calls: [{ id: 't1', function: { name: 'terminal', arguments: '{"command":"df -h /root && free -m"}' } }], timestamp: now() - 390 },
    { id: 3, role: 'tool', tool_name: 'terminal', tool_call_id: 't1', content: '{"output":"Filesystem Size Used Avail Use%\\noverlay 20G 12G 7.6G 62%","exit_code":0}', timestamp: now() - 380 },
    { id: 4, role: 'assistant', content: md, timestamp: now() - 300 },
  ],
};
const jobs = [
  { id: 'j1', name: 'Morning briefing', prompt: 'Summarise overnight AI news in 5 bullets.', schedule: { kind: 'cron', expr: '0 8 * * *', display: '0 8 * * *' }, schedule_display: '0 8 * * *', enabled: true, state: 'scheduled', deliver: 'local', next_run_at: new Date(Date.now() + 5 * 3600e3).toISOString(), last_run_at: new Date(Date.now() - 19 * 3600e3).toISOString(), last_status: 'ok' },
  { id: 'j2', name: 'Disk watch', prompt: 'Alert me if disk use is above 80%.', schedule: { kind: 'interval', minutes: 360, display: 'every 360m' }, schedule_display: 'every 360m', enabled: false, state: 'paused', deliver: 'local', next_run_at: null, last_run_at: new Date(Date.now() - 2 * 86400e3).toISOString(), last_status: 'error', last_error: 'timeout contacting host' },
];
const skills = [
  ['github-pr-workflow', 'Open, review and merge pull requests with gh.', 'github'], ['github-issues', 'Triage and label issues.', 'github'],
  ['pdf', 'Create, read, merge and fill PDF files.', 'productivity'], ['xlsx', 'Edit Excel workbooks and CSVs.', 'productivity'],
  ['arxiv', 'Search arXiv papers by keyword, author or ID.', 'research'], ['grounded-citations', 'Ground answers in cited sources.', 'research'],
  ['systematic-debugging', '4-phase root-cause debugging.', 'software-development'], ['test-driven-development', 'RED-GREEN-REFACTOR.', 'software-development'],
  ['maps', 'Geocode places and plan routes.', 'productivity'], ['weekly-review-planning', 'Weekly reset and next-week plan.', 'productivity'],
].map(([name, description, category]) => ({ name, description, category }));
const providers = [
  { slug: 'bedrock', name: 'AWS Bedrock', is_current: true, authenticated: true, models: ['global.anthropic.claude-sonnet-5-5', 'global.anthropic.claude-opus-4-5-20251101-v1:0', 'global.anthropic.claude-haiku-4-5-20251001-v1:0', 'amazon.nova-2-lite-v1:0', 'amazon.nova-pro-v1:0', 'meta.llama4-maverick-17b-instruct-v1:0', 'deepseek.r1-v1:0'] },
  { slug: 'openrouter', name: 'OpenRouter', authenticated: false, models: ['x/y'] },
];

const runs = new Map();
let runN = 0;

function emit(run, event, payload = {}) {
  const e = { event, run_id: run.id, seq: run.events.length + 1, timestamp: now(), ...payload };
  run.events.push(e);
  for (const sub of run.subs) sub(e);
}

async function script(run, sess, text, wantsApproval) {
  emit(run, 'run.started');
  run.status = 'running';
  await sleep(600);
  emit(run, 'tool.started', { tool: 'terminal', tool_call_id: 'c1', preview: 'df -h /root' });
  await sleep(900);
  emit(run, 'tool.completed', { tool: 'terminal', tool_call_id: 'c1', duration: 1 });
  if (wantsApproval) {
    emit(run, 'approval.request', { command: 'rm -rf ./build && npm run build', description: 'Delete the build directory, then rebuild', choices: ['once', 'session', 'always', 'deny'], request_id: 'p1', execution_generation: 1, timeout_s: 1800 });
    run.pending = [{ prompt_id: 'p1', kind: 'approval', execution_generation: 1 }];
    run.status = 'running';
    await new Promise((r) => (run.approve = r));
    run.pending = null;
    emit(run, 'approval.settled', { request_id: 'p1' });
  }
  for (const chunk of md.match(/.{1,38}/gs)) {
    if (run.stopped) break;
    emit(run, 'message.delta', { delta: chunk });
    await sleep(70);
  }
  run.status = run.stopped ? 'cancelled' : 'completed';
  const list = (messages[sess.id] ??= []);
  list.push({ id: list.length + 1, role: 'user', content: text, timestamp: now() - 5 }, { id: list.length + 2, role: 'assistant', content: md, timestamp: now() });
  sess.last_active = now();
  sess.message_count = list.length;
  sess.preview = text.slice(0, 80);
  if (!sess.title) sess.title = text.slice(0, 40);
  emit(run, `run.${run.status}`, { output: md });
  run.done = true;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' };
const json = (res, code, body) => { res.writeHead(code, { ...CORS, 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => { try { r(d ? JSON.parse(d) : {}); } catch { r({}); } }); });

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (p === '/health') return json(res, 200, { status: 'ok', version: '0.22.5-mock' });
  if (req.headers.authorization !== `Bearer ${KEY}`) return json(res, 401, { error: { message: 'Invalid API key', code: 'invalid_api_key' } });
  const body = ['POST', 'PATCH'].includes(req.method) ? await readBody(req) : {};
  let m;

  if (p === '/health/detailed') return json(res, 200, { status: 'ok', version: '0.22.5-mock', gateway_state: 'running', readiness: { status: 'ready', checks: { api_server: { status: 'ok' }, model_credentials: { status: 'ok' }, disk: { status: 'ok' }, scheduler: { status: 'ok' } } }, platforms: { api_server: { state: 'connected' } } });
  if (p === '/api/model/options') return json(res, 200, { model: 'global.anthropic.claude-sonnet-5-5', provider: 'bedrock', providers });
  if (p === '/v1/skills') return json(res, 200, { data: skills });

  if (p === '/api/sessions' && req.method === 'GET') return json(res, 200, { data: sessions, has_more: false });
  if (p === '/api/sessions' && req.method === 'POST') { const s = S(`n${Date.now()}`, body.title ?? null, { ago: 0, inTok: 0, outTok: 0, tools: 0, calls: 0, cache: 0, preview: null }); s.preview = null; sessions.unshift(s); return json(res, 200, { session: s }); }
  if ((m = p.match(/^\/api\/sessions\/([^/]+)\/messages$/))) return json(res, 200, { data: messages[m[1]] ?? [] });
  if ((m = p.match(/^\/api\/sessions\/([^/]+)\/fork$/))) { const src = sessions.find((s) => s.id === m[1]); const c = { ...src, id: `f${Date.now()}`, title: `${src.title} (branch)`, source: 'api_server', last_active: now() }; sessions.unshift(c); messages[c.id] = [...(messages[src.id] ?? [])]; return json(res, 200, { session: c }); }
  if ((m = p.match(/^\/api\/sessions\/([^/]+)$/))) {
    const i = sessions.findIndex((s) => s.id === m[1]);
    if (i < 0) return json(res, 404, { error: { message: 'not found' } });
    if (req.method === 'DELETE') { sessions.splice(i, 1); return json(res, 200, { deleted: true }); }
    if (req.method === 'PATCH') Object.assign(sessions[i], body);
    return json(res, 200, { session: sessions[i] });
  }

  if (p === '/v1/runs' && req.method === 'POST') {
    const sess = sessions.find((s) => s.id === body.session_id);
    const last = Array.isArray(body.input) ? body.input.at(-1).content : body.input;
    const text = typeof last === 'string' ? last : last.filter((x) => x.type === 'text').map((x) => x.text).join(' ');
    const run = { id: `run_${++runN}`, status: 'started', events: [], subs: new Set(), pending: null, done: false };
    runs.set(run.id, run);
    console.log(`run ${run.id} model=${body.model ?? 'default'} parts=${Array.isArray(last) ? last.length : 1}`);
    script(run, sess, text, /approv|delete|rm /i.test(text));
    return json(res, 200, { run_id: run.id, status: 'started' });
  }
  if ((m = p.match(/^\/v1\/runs\/([^/]+)\/events$/))) {
    const run = runs.get(m[1]);
    if (!run) return json(res, 404, { error: { message: 'unknown run' } });
    res.writeHead(200, { ...CORS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
    const lastId = Number(req.headers['last-event-id'] ?? 0);
    const send = (e) => res.write(`id: ${e.seq}\nevent: ${e.event}\ndata: ${JSON.stringify(e)}\n\n`);
    run.events.filter((e) => e.seq > lastId).forEach(send);
    if (run.done) return res.end();
    const sub = (e) => { send(e); if (/^run\.(completed|failed|cancelled|interrupted)$/.test(e.event)) res.end(); };
    run.subs.add(sub);
    req.on('close', () => run.subs.delete(sub));
    return;
  }
  if ((m = p.match(/^\/v1\/runs\/([^/]+)\/(stop|steer|approval|clarify)$/))) {
    const run = runs.get(m[1]);
    if (!run) return json(res, 404, { error: { message: 'unknown run' } });
    if (m[2] === 'stop') { run.stopped = true; run.approve?.(); }
    if (m[2] === 'approval') run.approve?.();
    return json(res, 200, { status: 'ok' });
  }
  if ((m = p.match(/^\/v1\/runs\/([^/]+)$/))) {
    const run = runs.get(m[1]);
    if (!run) return json(res, 404, { error: { message: 'unknown run' } });
    return json(res, 200, { run_id: run.id, status: run.status, pending_controls: run.pending, execution_generation: 1 });
  }

  if (p === '/api/jobs' && req.method === 'GET') return json(res, 200, { jobs });
  if (p === '/api/jobs' && req.method === 'POST') {
    const exprMatch = String(body.schedule).match(/^(\d+) (\d+) \* \* (.+)$/);
    const j = { id: `j${Date.now()}`, enabled: true, state: 'scheduled', deliver: 'local', ...body, schedule: exprMatch ? { kind: 'cron', expr: body.schedule, display: body.schedule } : { kind: 'interval', minutes: 60, display: body.schedule }, schedule_display: body.schedule, next_run_at: new Date(Date.now() + 3600e3).toISOString() };
    jobs.push(j); return json(res, 200, { job: j });
  }
  if ((m = p.match(/^\/api\/jobs\/([^/]+)(?:\/(pause|resume|run))?$/))) {
    const j = jobs.find((x) => x.id === m[1]);
    if (!j) return json(res, 404, { error: { message: 'no such job' } });
    if (req.method === 'DELETE') { jobs.splice(jobs.indexOf(j), 1); return json(res, 200, { ok: true }); }
    if (m[2] === 'pause') Object.assign(j, { enabled: false, state: 'paused' });
    if (m[2] === 'resume') Object.assign(j, { enabled: true, state: 'scheduled' });
    if (req.method === 'PATCH') Object.assign(j, body, body.schedule ? { schedule_display: body.schedule } : {});
    return json(res, 200, { job: j });
  }
  json(res, 404, { error: { message: `no route ${req.method} ${p}` } });
}).listen(PORT, () => console.log(`mock hermes on :${PORT} key=${KEY}`));
