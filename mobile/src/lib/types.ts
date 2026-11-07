/** Wire types for the Hermes API Server, as observed on the live gateway (v0.22.5). */

export type Session = {
  id: string;
  title?: string | null;
  preview?: string | null;
  source?: string;
  model?: string | null;
  started_at?: number | null;
  last_active?: number | null;
  ended_at?: number | null;
  message_count?: number;
  tool_call_count?: number;
  api_call_count?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_write_tokens?: number;
  estimated_cost_usd?: number | null;
  actual_cost_usd?: number | null;
  pinned?: boolean;
  archived?: boolean;
  hidden?: boolean;
  is_internal_child?: boolean;
};

export type ToolCall = { id?: string; function?: { name?: string; arguments?: string } };

export type Message = {
  id?: number | string;
  session_id?: string;
  role: 'user' | 'assistant' | 'tool' | 'system' | 'session_meta' | string;
  content?: unknown;
  tool_name?: string | null;
  tool_call_id?: string | null;
  tool_calls?: ToolCall[] | null;
  timestamp?: number | null;
  display_kind?: string | null;
  reasoning?: string | null;
  finish_reason?: string | null;
};

export type PendingControl = {
  prompt_id?: string;
  request_id?: string;
  execution_generation?: number;
  kind?: string;
  [k: string]: unknown;
};

export type RunStatus = {
  object?: 'hermes.run';
  run_id: string;
  status: string;
  session_id?: string;
  output?: string;
  error?: string;
  execution_generation?: number;
  pending_controls?: PendingControl[] | Record<string, PendingControl> | null;
  usage?: Record<string, number>;
};

/** One `/v1/runs/{id}/events` frame payload. `seq` is also the SSE `id:`. */
export type RunEvent = {
  event: string;
  run_id: string;
  seq?: number;
  timestamp?: number;
  delta?: string;
  text?: string;
  already_streamed?: boolean;
  tool?: string;
  tool_call_id?: string;
  preview?: string;
  duration?: number;
  error?: boolean | string;
  output?: string;
  command?: string;
  description?: string;
  question?: string;
  choices?: string[];
  request_id?: string;
  prompt_id?: string;
  execution_generation?: number;
  timeout_s?: number;
  [k: string]: unknown;
};

export type Job = {
  id: string;
  name?: string;
  prompt?: string;
  schedule?: { kind?: string; minutes?: number; expr?: string; display?: string } | string | null;
  schedule_display?: string;
  enabled?: boolean;
  state?: string;
  deliver?: string | null;
  model?: string | null;
  provider?: string | null;
  skills?: string[];
  repeat?: { times?: number | null; completed?: number } | null;
  next_run_at?: string | number | null;
  last_run_at?: string | number | null;
  last_status?: string | null;
  last_error?: string | null;
  [k: string]: unknown;
};

export type JobInput = {
  name?: string;
  prompt?: string;
  schedule?: string;
  deliver?: string;
  enabled?: boolean;
  skills?: string[];
};

export type Skill = { name: string; description?: string; category?: string; [k: string]: unknown };

export type ModelProvider = { slug: string; name: string; is_current?: boolean; authenticated?: boolean; models: string[]; total_models?: number };
export type ModelOptions = { model?: string; provider?: string; providers: ModelProvider[] };
/** Per-run model override (verified: honored by POST /v1/runs, not by the session-level lock). */
export type ModelChoice = { model: string; provider: string };

export type HealthDetail = {
  status: string;
  version?: string;
  gateway_state?: string;
  readiness?: { status: string; checks?: Record<string, { status: string; [k: string]: unknown }> };
  platforms?: Record<string, { state?: string; [k: string]: unknown }>;
};

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export type ChatInput = string | ContentPart[];

export const TERMINAL_RUN_STATES = ['completed', 'failed', 'cancelled', 'interrupted'] as const;
export const isTerminal = (s?: string) => !!s && (TERMINAL_RUN_STATES as readonly string[]).includes(s);
export const isTerminalEvent = (e: string) => e.startsWith('run.') && isTerminal(e.slice(4));
