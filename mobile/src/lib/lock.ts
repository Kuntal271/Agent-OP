/** Biometric / device-credential app lock. Locks on cold start and after 30 s in the background. */

import * as LocalAuthentication from 'expo-local-authentication';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

const RELOCK_AFTER_MS = 30_000;

/** True when the phone has a screen lock or biometrics we can use. */
export async function lockAvailable(): Promise<boolean> {
  if (Platform.OS === 'web') return false;
  const level = await LocalAuthentication.getEnrolledLevelAsync();
  return level !== LocalAuthentication.SecurityLevel.NONE;
}

export async function authenticate(prompt = 'Unlock Hermes'): Promise<boolean> {
  const res = await LocalAuthentication.authenticateAsync({ promptMessage: prompt, cancelLabel: 'Cancel' });
  return res.success;
}

export function useAppLock(enabled: boolean) {
  const [locked, setLocked] = useState(enabled);
  const busy = useRef(false);
  const leftAt = useRef<number | null>(null);

  const unlock = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    try {
      if (!(await lockAvailable()) || (await authenticate())) setLocked(false);
    } finally {
      busy.current = false;
    }
  }, []);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'background' || s === 'inactive') {
        if (leftAt.current == null) leftAt.current = Date.now();
      } else if (s === 'active') {
        if (enabled && leftAt.current != null && Date.now() - leftAt.current > RELOCK_AFTER_MS) setLocked(true);
        leftAt.current = null;
      }
    });
    return () => sub.remove();
  }, [enabled]);

  // Disabling the lock in Settings unlocks immediately.
  const active = enabled && locked;
  useEffect(() => {
    if (active) unlock();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- prompt once each time the lock engages
  }, [active]);

  return { locked: active, unlock };
}
