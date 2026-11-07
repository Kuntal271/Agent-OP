/** Load-and-poll helper for screens. `fn` must be stable (wrap in useCallback). */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

export type AsyncState<T> = { data?: T; error?: string; loading: boolean; refreshing: boolean };

export function useAsync<T>(fn: (() => Promise<T>) | null, opts: { pollMs?: number; focus?: boolean } = {}) {
  const { pollMs, focus = true } = opts;
  const [state, setState] = useState<AsyncState<T>>({ loading: true, refreshing: false });

  const run = useCallback(async () => {
    if (!fn) return;
    try {
      const data = await fn();
      setState({ data, loading: false, refreshing: false });
    } catch (e: any) {
      setState((s) => ({ ...s, error: e?.message ?? String(e), loading: false, refreshing: false }));
    }
  }, [fn]);

  const refresh = useCallback(async () => {
    setState((s) => ({ ...s, refreshing: true }));
    await run();
  }, [run]);

  // Re-fetch whenever the screen regains focus, and optionally poll while focused.
  useFocusEffect(
    useCallback(() => {
      if (!focus) return;
      run();
      if (!pollMs) return;
      const id = setInterval(run, pollMs);
      return () => clearInterval(id);
    }, [focus, pollMs, run]),
  );
  useEffect(() => {
    if (!focus) run();
  }, [focus, run]);

  return { ...state, refresh, reload: run, setData: (data: T) => setState((s) => ({ ...s, data })) };
}
