/** App-wide state: connection config, API client, and the runs this phone is juggling. */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { HermesClient, HermesError, type Config } from '@/lib/api';
import { clearConfig, loadConfig, loadRuns, saveConfig, saveRuns, type RunMap, type TrackedRun } from '@/lib/storage';
import { isTerminal } from '@/lib/types';

type Ctx = {
  ready: boolean;
  config: Config | null;
  client: HermesClient | null;
  connect: (c: Config) => Promise<void>;
  disconnect: () => Promise<void>;
  runs: RunMap;
  trackRun: (r: TrackedRun) => void;
  updateRun: (sessionId: string, patch: Partial<TrackedRun>) => void;
  forgetRun: (sessionId: string) => void;
  /** The chat screen streams its own run; the poller skips it and never marks it unread. */
  setOpenSession: (sessionId: string | null) => void;
};

const HermesContext = createContext<Ctx | null>(null);
const POLL_MS = 4000;

export function HermesProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<Config | null>(null);
  const [runs, setRuns] = useState<RunMap>({});
  const runsRef = useRef<RunMap>({});
  const openRef = useRef<string | null>(null);

  useEffect(() => {
    (async () => {
      const [c, r] = await Promise.all([loadConfig(), loadRuns()]);
      setConfig(c);
      runsRef.current = r;
      setRuns(r);
      setReady(true);
    })();
  }, []);

  const client = useMemo(() => (config ? new HermesClient(config) : null), [config]);

  const commit = useCallback((next: RunMap) => {
    runsRef.current = next;
    setRuns(next);
    saveRuns(next).catch(() => {});
  }, []);

  const trackRun = useCallback((r: TrackedRun) => commit({ ...runsRef.current, [r.sessionId]: r }), [commit]);
  const updateRun = useCallback((sessionId: string, patch: Partial<TrackedRun>) => {
    const cur = runsRef.current[sessionId];
    if (cur) commit({ ...runsRef.current, [sessionId]: { ...cur, ...patch, updatedAt: Date.now() } });
  }, [commit]);
  const forgetRun = useCallback((sessionId: string) => {
    const { [sessionId]: _drop, ...rest } = runsRef.current;
    commit(rest);
  }, [commit]);

  const connect = useCallback(async (c: Config) => {
    await saveConfig(c);
    setConfig(c);
  }, []);
  const disconnect = useCallback(async () => {
    await clearConfig();
    setConfig(null);
  }, []);
  const setOpenSession = useCallback((id: string | null) => {
    openRef.current = id;
  }, []);

  // Poll runs that are still working (except the one the open chat is streaming).
  useEffect(() => {
    if (!client) return;
    let active = AppState.currentState === 'active';
    const sub = AppState.addEventListener('change', (s) => (active = s === 'active'));
    const tick = async () => {
      if (!active) return;
      for (const r of Object.values(runsRef.current)) {
        if (isTerminal(r.status) || r.sessionId === openRef.current) continue;
        try {
          const st = await client.getRun(r.runId);
          if (st.status !== r.status) {
            updateRun(r.sessionId, { status: st.status, error: st.error, unread: isTerminal(st.status) || st.status === 'waiting_for_approval' });
          }
        } catch (e) {
          // Run status is retained only briefly after it ends: a 404 means it finished a while ago.
          if (e instanceof HermesError && e.status === 404) updateRun(r.sessionId, { status: 'completed', unread: true });
        }
      }
    };
    const id = setInterval(tick, POLL_MS);
    tick();
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [client, updateRun]);

  const value = useMemo<Ctx>(
    () => ({ ready, config, client, connect, disconnect, runs, trackRun, updateRun, forgetRun, setOpenSession }),
    [ready, config, client, connect, disconnect, runs, trackRun, updateRun, forgetRun, setOpenSession],
  );
  return <HermesContext.Provider value={value}>{children}</HermesContext.Provider>;
}

export function useHermes(): Ctx {
  const ctx = useContext(HermesContext);
  if (!ctx) throw new Error('useHermes must be used inside <HermesProvider>');
  return ctx;
}
