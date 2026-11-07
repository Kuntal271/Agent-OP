/** Device persistence: secrets in the OS keystore, run bookkeeping in SQLite-backed KV. */

import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import SqliteKV from 'expo-sqlite/kv-store';
import { Platform } from 'react-native';

import type { Config } from './api';

const CONFIG_KEY = 'hermes.config.v1';
const RUNS_KEY = 'hermes.runs.v1';

// SecureStore has no web implementation. On web (developer preview only) fall back to sessionStorage,
// which dies with the tab. Device builds always use the OS keystore.
const onWeb = Platform.OS === 'web' && typeof sessionStorage !== 'undefined';
const secretGet = async (k: string) => (onWeb ? sessionStorage.getItem(k) : SecureStore.getItemAsync(k));
const secretSet = async (k: string, v: string) => {
  if (onWeb) sessionStorage.setItem(k, v);
  else await SecureStore.setItemAsync(k, v, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK });
};
const secretDelete = async (k: string) => (onWeb ? sessionStorage.removeItem(k) : SecureStore.deleteItemAsync(k));

/** Non-secret key/value store: SQLite on devices; localStorage on web (the SQLite web build needs a wasm worker). */
const useLocal = Platform.OS === 'web' && typeof localStorage !== 'undefined';
export const kv = {
  getItem: async (k: string): Promise<string | null> => (useLocal ? localStorage.getItem(k) : SqliteKV.getItem(k)),
  setItem: async (k: string, v: string): Promise<void> => {
    if (useLocal) localStorage.setItem(k, v);
    else await SqliteKV.setItem(k, v);
  },
};

export const DEFAULT_BASE_URL = 'https://kuntal-hermes.tail59b530.ts.net';

export async function loadConfig(): Promise<Config | null> {
  const raw = await secretGet(CONFIG_KEY);
  if (!raw) return null;
  try {
    const c = JSON.parse(raw);
    return c?.baseUrl && c?.apiKey ? { baseUrl: String(c.baseUrl), apiKey: String(c.apiKey) } : null;
  } catch {
    return null;
  }
}

export const saveConfig = (c: Config) => secretSet(CONFIG_KEY, JSON.stringify(c));

export const clearConfig = () => secretDelete(CONFIG_KEY);

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
    return JSON.parse((await kv.getItem(RUNS_KEY)) || '{}') as RunMap;
  } catch {
    return {};
  }
}

export const saveRuns = (runs: RunMap) => kv.setItem(RUNS_KEY, JSON.stringify(runs));

/** Idempotency key for POST /v1/runs: a retried send never starts a second run. */
export const newIdempotencyKey = () => `mobile-${Crypto.randomUUID()}`;
