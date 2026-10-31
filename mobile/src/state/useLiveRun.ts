/** Attach the open chat to its session's active run; detach (never stop) on blur/background. */

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { Activity } from '@/components/LiveRun';
import { HermesError } from '@/lib/api';
import { isTerminal, type RunEvent } from '@/lib/types';
import { useHermes } from './HermesContext';

export type Live = { text: string; activity: Activity[]; approval: RunEvent | null; clarify: RunEvent | null };
const EMPTY: Live = { text: '', activity: [], approval: null, clarify: null };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const truthy = (v: unknown) => v === true || v === 'true';

export function useLiveRun(sessionId: string, onFinished: () => void) {
  const { client, runs, updateRun, forgetRun, setOpenSession } = useHermes();
  const run = runs[sessionId];
  const active = !!run && !isTerminal(run.status);
  // Live view is keyed by run id: a new run starts empty by construction (no reset effect needed).
  const runId = run?.runId;
  const [store, setStore] = useState<{ runId?: string; live: Live }>({ live: EMPTY });
  const live = store.runId === runId ? store.live : EMPTY;
  const setLive = useCallback(
    (fn: (l: Live) => Live) => setStore((s) => ({ runId, live: fn(s.runId === runId ? s.live : EMPTY) })),
    [runId],
  );
  const [focused, setFocused] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const lastSeq = useRef<number | undefined>(undefined);
  const doneRef = useRef(false);
  const finishedRef = useRef(onFinished);
  useEffect(() => {
    finishedRef.current = onFinished;
  }, [onFinished]);
  // Refs restart per run (declared before the streaming effect so they reset first).
  useEffect(() => {
    lastSeq.current = undefined;
    doneRef.current = false;
  }, [runId]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      setOpenSession(sessionId);
      return () => {
        setFocused(false);
        setOpenSession(null);
      };
    }, [sessionId, setOpenSession]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  // Seeing a finished run's result clears its "unread" dot; a clean finish leaves no trace.
  useEffect(() => {
    if (focused && run && isTerminal(run.status)) {
      if (run.status === 'completed' || run.status === 'cancelled') forgetRun(sessionId);
      else if (run.unread) updateRun(sessionId, { unread: false });
    }
  }, [focused, run, sessionId, forgetRun, updateRun]);

  const finalize = useCallback((status: string, error?: string) => {
    if (doneRef.current) return; // terminal event and stream-close check can both land here
    doneRef.current = true;
    updateRun(sessionId, { status, error, unread: false });
    setLive(() => EMPTY);
    lastSeq.current = undefined;
    finishedRef.current();
  }, [sessionId, updateRun, setLive]);

  const onEvent = useCallback((ev: RunEvent, seq?: number) => {
    if (seq != null) lastSeq.current = seq;
    const name = ev.event;
    if (name === 'message.delta' && ev.delta) setLive((l) => ({ ...l, text: l.text + ev.delta }));
    else if (name === 'message.interim' && ev.text && !truthy(ev.already_streamed))
      setLive((l) => ({ ...l, text: l.text ? `${l.text}\n\n${ev.text}` : String(ev.text) }));
    else if (name === 'tool.started' || name === 'subagent.start')
      setLive((l) => ({
        ...l,
        activity: [...l.activity, { key: String(ev.tool_call_id ?? ev.child_session_id ?? `${seq}`), tool: String(ev.tool ?? 'subagent'), preview: String(ev.preview ?? ev.goal ?? '').slice(0, 140), state: 'running' }],
      }));
    else if (name === 'tool.completed' || name === 'subagent.complete') {
      const key = String(ev.tool_call_id ?? ev.child_session_id ?? '');
      setLive((l) => {
        const i = l.activity.findIndex((a) => a.key === key && a.state === 'running');
        const idx = i >= 0 ? i : l.activity.findIndex((a) => a.state === 'running');
        if (idx < 0) return l;
        const activity = [...l.activity];
        const failed = truthy(ev.error) || ev.status === 'failed';
        activity[idx] = { ...activity[idx], state: failed ? 'error' : 'done', duration: ev.duration as number | undefined };
        return { ...l, activity };
      });
    } else if (name === 'approval.request') {
      setLive((l) => ({ ...l, approval: ev }));
      updateRun(sessionId, { status: 'waiting_for_approval' });
    } else if (name === 'approval.responded') {
      setLive((l) => ({ ...l, approval: null }));
      updateRun(sessionId, { status: 'running' });
    } else if (name.startsWith('clarify') && name.endsWith('request')) setLive((l) => ({ ...l, clarify: ev }));
    else if (name.startsWith('clarify') && name.endsWith('responded')) setLive((l) => ({ ...l, clarify: null }));
    else if (name.startsWith('run.')) {
      const status = name.slice(4);
      if (isTerminal(status)) finalize(status, status === 'completed' ? undefined : String(ev.error ?? ev.output ?? status));
      else if (status === 'started' || status === 'running') updateRun(sessionId, { status: 'running' });
    }
  }, [finalize, sessionId, updateRun, setLive]);

  // Stream while visible; the server keeps the run going whenever we are not attached.
  useEffect(() => {
    if (!client || !runId || !active || !focused || !appActive) return;
    const ctrl = new AbortController();
    (async () => {
      let backoff = 1000;
      while (!ctrl.signal.aborted) {
        try {
          await client.streamRun(runId, onEvent, { lastSeq: lastSeq.current, signal: ctrl.signal });
          if (ctrl.signal.aborted || doneRef.current) return;
          const st = await client.getRun(runId).catch(() => null); // stream closed: did the run end?
          if (!st || isTerminal(st.status)) return finalize(st?.status ?? 'completed', st?.error);
          backoff = 1000;
        } catch (e) {
          if (ctrl.signal.aborted) return;
          if (e instanceof HermesError && e.status === 404) return finalize('completed');
          await sleep(backoff);
          backoff = Math.min(backoff * 2, 15_000);
        }
      }
    })();
    return () => ctrl.abort();
  }, [client, runId, active, focused, appActive, onEvent, finalize]);

  return { run, active, live, setLive };
}
