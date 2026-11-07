/** User preferences, persisted locally (never contains the API key — that lives in the keystore). */

import Storage from 'expo-sqlite/kv-store';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { setHapticsEnabled } from '@/lib/haptics';
import type { ModelChoice } from '@/lib/types';

export type ThemeMode = 'system' | 'light' | 'dark';

export type Settings = {
  themeMode: ThemeMode;
  haptics: boolean;
  appLock: boolean;
  notifications: boolean;
  voiceAutoSend: boolean;
  readAloud: boolean;
  /** Used for new runs when a task has no explicit choice. null = whatever the server default is. */
  defaultModel: ModelChoice | null;
  /** Per-task model choice, keyed by session id. */
  sessionModels: Record<string, ModelChoice>;
};

export const DEFAULT_SETTINGS: Settings = {
  themeMode: 'system',
  haptics: true,
  appLock: false,
  notifications: false,
  voiceAutoSend: false,
  readAloud: false,
  defaultModel: null,
  sessionModels: {},
};

const KEY = 'hermes.settings.v1';

type Ctx = {
  ready: boolean;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  setSessionModel: (sessionId: string, choice: ModelChoice | null) => void;
};

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);

  useEffect(() => {
    let gone = false;
    Storage.getItem(KEY)
      .then((raw) => {
        if (gone) return;
        if (raw) {
          try {
            setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
          } catch {
            /* corrupt blob: fall back to defaults */
          }
        }
      })
      .finally(() => !gone && setReady(true));
    return () => {
      gone = true;
    };
  }, []);

  useEffect(() => {
    setHapticsEnabled(settings.haptics);
  }, [settings.haptics]);

  const commit = useCallback((next: Settings) => {
    setSettings(next);
    Storage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  }, []);

  const update = useCallback((patch: Partial<Settings>) => commit({ ...settings, ...patch }), [commit, settings]);

  const setSessionModel = useCallback(
    (sessionId: string, choice: ModelChoice | null) => {
      const { [sessionId]: _drop, ...rest } = settings.sessionModels;
      commit({ ...settings, sessionModels: choice ? { ...rest, [sessionId]: choice } : rest });
    },
    [commit, settings],
  );

  const value = useMemo(() => ({ ready, settings, update, setSessionModel }), [ready, settings, update, setSessionModel]);
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>');
  return ctx;
}
