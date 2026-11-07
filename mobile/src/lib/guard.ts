/** Run a server action; if it fails, tell the user why (haptic + alert) instead of failing silently. */

import { Alert } from 'react-native';

import { haptic } from './haptics';

export async function attempt<T>(title: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (e: any) {
    haptic.error();
    Alert.alert(title, e?.message ?? String(e));
    return undefined;
  }
}
