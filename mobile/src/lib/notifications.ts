/**
 * Local notifications + a background watcher for runs this phone started.
 *
 * Android runs the watcher through WorkManager roughly every 15 minutes (the OS minimum), so this is a
 * best-effort "your task finished / needs approval" nudge. Instant delivery needs real push (FCM), which
 * requires a Firebase project — see HANDOFF.md.
 */

import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';

import { HermesClient } from './api';
import { loadConfig, loadRuns, saveRuns } from './storage';
import { isTerminal } from './types';

export const WATCH_TASK = 'hermes-run-watch';
const CHANNEL = 'runs';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
});

export async function ensureChannel() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(CHANNEL, {
    name: 'Task updates',
    description: 'Tasks that finish, fail, or need your approval',
    importance: AndroidImportance.HIGH,
  });
}

export async function requestNotifyPermission(): Promise<boolean> {
  const cur = await Notifications.getPermissionsAsync();
  if (cur.granted) return true;
  const next = await Notifications.requestPermissionsAsync();
  return next.granted;
}

export async function notifyNow(title: string, body: string, data?: Record<string, unknown>) {
  await ensureChannel();
  await Notifications.scheduleNotificationAsync({
    content: { title, body, data: data ?? {}, ...(Platform.OS === 'android' ? { channelId: CHANNEL } : {}) },
    trigger: null,
  });
}

/** One pass: compare tracked runs against the server and notify on meaningful changes. */
export async function checkRunsOnce(): Promise<number> {
  const [cfg, runs] = await Promise.all([loadConfig(), loadRuns()]);
  if (!cfg) return 0;
  const client = new HermesClient(cfg);
  let notified = 0;
  let dirty = false;
  for (const r of Object.values(runs)) {
    if (isTerminal(r.status)) continue;
    try {
      const st = await client.getRun(r.runId);
      const pcs = st.pending_controls;
      const waiting = !isTerminal(st.status) && (Array.isArray(pcs) ? pcs.length > 0 : !!pcs && Object.keys(pcs).length > 0);
      const status = waiting ? 'waiting_for_approval' : st.status;
      if (status === r.status) continue;
      runs[r.sessionId] = { ...r, status, error: st.error, unread: true, updatedAt: Date.now() };
      dirty = true;
      const label = (r.input ?? 'Your task').slice(0, 80);
      if (status === 'waiting_for_approval') await notifyNow('Approval needed', label, { sessionId: r.sessionId });
      else if (status === 'completed') await notifyNow('Task finished', label, { sessionId: r.sessionId });
      else if (isTerminal(status)) await notifyNow(`Task ${status}`, label, { sessionId: r.sessionId });
      else continue;
      notified += 1;
    } catch {
      /* server unreachable or run expired: try again next cycle */
    }
  }
  if (dirty) await saveRuns(runs);
  return notified;
}

// Must run at module scope so the task is known when Android starts the app headless.
TaskManager.defineTask(WATCH_TASK, async () => {
  try {
    await checkRunsOnce();
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

export async function setBackgroundWatch(on: boolean) {
  const registered = await TaskManager.isTaskRegisteredAsync(WATCH_TASK);
  if (on && !registered) await BackgroundTask.registerTaskAsync(WATCH_TASK, { minimumInterval: 15 });
  if (!on && registered) await BackgroundTask.unregisterTaskAsync(WATCH_TASK);
}
