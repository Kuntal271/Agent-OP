/** Device persistence: secrets in the OS keystore, run bookkeeping in SQLite-backed KV. */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import Storage from 'expo-sqlite/kv-store';

import type { Config } from './api';

const CONFIG_KEY = 'hermes.config.v1';
const RUNS_KEY = 'hermes.runs.v1';

export const DEFAULT_BASE_URL = 'https://kuntal-hermes.tail59b530.ts.net';

export async function loadConfig(): Promise<Config | null> {
  const raw = await SecureStore.getItemAsync(CONFIG_KEY);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    return c?.baseUrl && c?.apiKey ? { baseUrl: String(c.baseUrl), apiKey: String(c.apiKey) } : null;
  } catch {
    return null;
  }
}

export const saveConfig = (c: Config) =>
  SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(c), { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });

export const clearConfig = () => SecureStore.deleteItemAsync(CONFIG_KEY);

/** A run this phone started (or is watching), keyed by session id. */
export type TrackedRun = {
  runId: string;
  sessionId: string;
  status: string; // started | running | waiting_for_approval | completed | failed | ...
  lastSeq?: number; // last SSE id seen, for loss-free re-attach
  input?: string;
  startedAt: number;
  updatedAt: number;
  unread?: boolean; // finished while the chat was not open
  error?: string;
};

export type RunMap = Record<string, TrackedRun>;

export async function loadRuns(): Promise<RunMap> {
  try {
    return JSON.parse((await Storage.getItem(RUNS_KEY)) || '{}') as RunMap;
  } catch {
    return {};
  }
}

export const saveRuns = (runs: RunMap) => Storage.setItem(RUNS_KEY, JSON.stringify(runs));

/** Idempotency key for POST /v1/runs: a retried send never starts a second run. */
export const newIdempotencyKey = () => `mobile-${Crypto.randomUUID()}`;
