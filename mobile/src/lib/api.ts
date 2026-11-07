/** Hermes API Server client. Pure TS on the global WinterCG fetch (expo/fetch on device). */

import { SseParser } from './sse';
import {
  isTerminalEvent,
  type ChatInput,
  type HealthDetail,
  type Job,
  type JobInput,
  type Message,
  type ModelChoice,
  type ModelOptions,
  type PendingControl,
  type RunEvent,
  type RunStatus,
  type Session,
  type Skill,
} from './types';

export type Config = { baseUrl: string; apiKey: string };

export class HermesError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'HermesError';
  }
}

const errorText = (body: any, status: number): [string, string | undefined] => {
  const e = body?.error;
  if (typeof e === 'string') return [e, body?.code];
  if (e && typeof e === 'object') return [e.message || `HTTP ${status}`, e.code || e.type];
  return [body?.message || `HTTP ${status}`, body?.code];
};

export class HermesClient {
  constructor(private cfg: Config) {}

  private url(path: string) {
    return this.cfg.baseUrl.replace(/\/+$/, '') + path;
  }

  private headers(extra?: Record<string, string>) {
    return { Authorization: `Bearer ${this.cfg.apiKey}`, ...extra };
  }

  async request<T>(method: string, path: string, body?: unknown, opts: { headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 30_000);
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        method,
        headers: this.headers({ ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers }),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
    } catch {
      throw ctrl.signal.aborted
        ? new HermesError('Hermes took too long to answer.', 0, 'timeout')
        : new HermesError('Cannot reach Hermes. Is Tailscale connected?', 0, 'network');
    } finally {
      clearTimeout(timer);
    }
    const text = await res.text();
    let json: any = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { message: text.slice(0, 200) };
    }
    if (!res.ok) {
      const [msg, code] = errorText(json, res.status);
      throw new HermesError(res.status === 401 ? 'API key rejected (401).' : msg, res.status, code);
    }
    return json as T;
  }

  healthDetailed = () => this.request<HealthDetail>('GET', '/health/detailed', undefined, { timeoutMs: 15_000 });
  modelOptions = () => this.request<ModelOptions>('GET', '/api/model/options', undefined, { timeoutMs: 20_000 });
  listSkills = async () => (await this.request<{ data: Skill[] }>('GET', '/v1/skills')).data ?? [];
  health = () => this.request<{ status: string; version?: string }>('GET', '/health', undefined, { timeoutMs: 10_000 });

  // --- sessions -----------------------------------------------------------------------
  listSessions = async (limit = 50, offset = 0) =>
    this.request<{ data: Session[]; has_more: boolean }>('GET', `/api/sessions?limit=${limit}&offset=${offset}`);
  createSession = async (title?: string) =>
    (await this.request<{ session: Session }>('POST', '/api/sessions', title ? { title } : {})).session;
  patchSession = async (id: string, fields: Partial<Pick<Session, 'title' | 'pinned' | 'archived'>>) =>
    (await this.request<{ session: Session }>('PATCH', `/api/sessions/${encodeURIComponent(id)}`, fields)).session;
  forkSession = async (id: string) =>
    (await this.request<{ session: Session }>('POST', `/api/sessions/${encodeURIComponent(id)}/fork`, {})).session;
  deleteSession = (id: string) => this.request<{ deleted: boolean }>('DELETE', `/api/sessions/${encodeURIComponent(id)}`);
  getSession = async (id: string) =>
    (await this.request<{ session: Session }>('GET', `/api/sessions/${encodeURIComponent(id)}`)).session;
  getMessages = async (id: string, limit = 200) =>
    (await this.request<{ data: Message[] }>('GET', `/api/sessions/${encodeURIComponent(id)}/messages?limit=${limit}&order=latest`)).data;

  // --- runs (durable: the turn keeps going server-side when the phone disconnects) -----
  /** Text, or text + images. Verified shape for images: input=[{role:'user', content:[parts]}]. */
  startRun = (sessionId: string, input: ChatInput, idempotencyKey: string, model?: ModelChoice | null) =>
    this.request<{ run_id: string; status: string }>(
      'POST',
      '/v1/runs',
      {
        input: typeof input === 'string' ? input : [{ role: 'user', content: input }],
        session_id: sessionId,
        ...(model ? { model: model.model, provider: model.provider } : {}),
      },
      { headers: { 'Idempotency-Key': idempotencyKey }, timeoutMs: 60_000 },
    );
  getRun = (runId: string) => this.request<RunStatus>('GET', `/v1/runs/${runId}`, undefined, { timeoutMs: 15_000 });
  stopRun = (runId: string) => this.request<{ status: string }>('POST', `/v1/runs/${runId}/stop`, {});
  steerRun = (runId: string, text: string) => this.request<unknown>('POST', `/v1/runs/${runId}/steer`, { text });

  /** Canonical controls need the live prompt identity; take it from pending_controls, then the event. */
  private async controlIdentity(runId: string, ev?: RunEvent, kind?: string) {
    const run = await this.getRun(runId);
    const raw = run.pending_controls;
    const list: PendingControl[] = Array.isArray(raw) ? raw : raw ? Object.values(raw) : [];
    const pc = list.find((c) => !kind || !c.kind || String(c.kind).includes(kind)) ?? list[0];
    return {
      request_id: pc?.prompt_id ?? pc?.request_id ?? ev?.request_id ?? ev?.prompt_id,
      execution_generation: pc?.execution_generation ?? ev?.execution_generation ?? run.execution_generation,
    };
  }

  respondApproval = async (runId: string, choice: string, ev?: RunEvent) =>
    this.request<unknown>('POST', `/v1/runs/${runId}/approval`, { choice, ...(await this.controlIdentity(runId, ev, 'approval')) });
  respondClarify = async (runId: string, answer: string, ev?: RunEvent) =>
    this.request<unknown>('POST', `/v1/runs/${runId}/clarify`, { answer, ...(await this.controlIdentity(runId, ev, 'clarify')) });

  /**
   * Attach to a run's event stream. Resolves when the run reaches a terminal event or the server
   * closes the stream; reject on HTTP errors. Abort `signal` to detach (the run keeps going).
   * `lastSeq` replays only events after it, so re-attaching never duplicates output.
   */
  async streamRun(runId: string, onEvent: (ev: RunEvent, seq: number | undefined) => void, opts: { lastSeq?: number; signal?: AbortSignal } = {}) {
    const res = await fetch(this.url(`/v1/runs/${runId}/events`), {
      headers: this.headers({ Accept: 'text/event-stream', ...(opts.lastSeq != null ? { 'Last-Event-ID': String(opts.lastSeq) } : {}) }),
      signal: opts.signal,
    });
    if (!res.ok || !res.body) {
      const [msg, code] = errorText(await res.json().catch(() => ({})), res.status);
      throw new HermesError(msg, res.status, code);
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const parser = new SseParser();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        for (const frame of parser.push(decoder.decode(value, { stream: true }))) {
          let ev: RunEvent;
          try {
            ev = JSON.parse(frame.data);
          } catch {
            continue;
          }
          const seq = frame.id != null && frame.id !== '' ? Number(frame.id) : ev.seq;
          onEvent(ev, Number.isFinite(seq) ? seq : undefined);
          if (isTerminalEvent(ev.event)) return;
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
  }

  // --- scheduled jobs -----------------------------------------------------------------
  listJobs = async () => (await this.request<{ jobs: Job[] }>('GET', '/api/jobs')).jobs ?? [];
  createJob = async (b: JobInput) => (await this.request<{ job: Job }>('POST', '/api/jobs', b)).job;
  updateJob = async (id: string, b: JobInput) => (await this.request<{ job: Job }>('PATCH', `/api/jobs/${id}`, b)).job;
  deleteJob = (id: string) => this.request<{ ok: boolean }>('DELETE', `/api/jobs/${id}`);
  jobAction = (id: string, action: 'pause' | 'resume' | 'run') => this.request<{ job: Job }>('POST', `/api/jobs/${id}/${action}`, {});
}
