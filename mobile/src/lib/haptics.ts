/** Haptics that respect the user's setting. No-ops on web and when disabled. */

import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

let enabled = true;
export const setHapticsEnabled = (on: boolean) => {
  enabled = on;
};

const run = (fn: () => Promise<void>) => {
  if (!enabled || Platform.OS === 'web') return;
  fn().catch(() => {});
};

export const haptic = {
  tap: () => run(() => Haptics.selectionAsync()),
  press: () => run(() => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  success: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => run(() => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
};
