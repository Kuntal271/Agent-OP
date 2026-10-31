"""Capture the live Hermes API wire protocol (runs, events, approvals, sessions, jobs).

Runs inside a throwaway tailnet probe sandbox (see `hermes_modal.py probe`). Prints event names,
payload keys and truncated samples so the mobile client is written against real traffic.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = sys.argv[1].rstrip("/")
KEY = os.environ["API_SERVER_KEY"]
OP = urllib.request.build_opener(urllib.request.ProxyHandler(
    {"https": "http://127.0.0.1:1055", "http": "http://127.0.0.1:1055"}))


def short(v, n=160):
    s = json.dumps(v, ensure_ascii=False) if not isinstance(v, str) else v
    return s if len(s) <= n else s[:n] + "…"


def req(method, path, body=None, timeout=90):
    r = urllib.request.Request(
        BASE + path, method=method, data=None if body is None else json.dumps(body).encode(),
        headers={"Authorization": f"Bearer {KEY}", "Content-Type": "application/json"})
    try:
        with OP.open(r, timeout=timeout) as resp:
            raw = resp.read()
            return resp.status, (json.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def sse(run_id, last_id=None, timeout=300):
    h = {"Authorization": f"Bearer {KEY}", "Accept": "text/event-stream"}
    if last_id is not None:
        h["Last-Event-ID"] = str(last_id)
    r = urllib.request.Request(f"{BASE}/v1/runs/{run_id}/events", headers=h)
    with OP.open(r, timeout=timeout) as resp:
        frame = {}
        for raw in resp:
            line = raw.decode("utf-8").rstrip("\r\n")
            if line.startswith(":"):
                continue
            if not line:
                if "data" in frame:
                    ev = json.loads(frame["data"])
                    yield frame.get("id"), frame.get("event"), ev
                frame = {}
                continue
            k, _, v = line.partition(":")
            v = v[1:] if v.startswith(" ") else v
            frame[k] = frame.get(k, "") + v if k == "data" else v


TERMINAL = ("run.completed", "run.failed", "run.cancelled", "run.interrupted")
seen_shapes = {}


def note(sse_id, sse_event, ev):
    name = ev.get("event") or sse_event
    keys = sorted(ev)
    if name not in seen_shapes:
        seen_shapes[name] = keys
        sample = {k: short(ev[k], 120) for k in keys if k not in ("timestamp",)}
        print(f"  [id={sse_id} sse_event={sse_event}] {name}: {json.dumps(sample, ensure_ascii=False)[:900]}")
    return name


def main():
    st, caps = req("GET", "/v1/capabilities")
    print(f"capabilities {st}: features={sorted((caps.get('features') or {}).keys())[:40]}")

    st, created = req("POST", "/api/sessions", {"title": "Mobile protocol probe"})
    sid = created.get("session", {}).get("id")
    print(f"create session {st}: {short(created, 400)}")

    # --- run 1: tool call + detach/re-attach ------------------------------------------------
    st, run = req("POST", "/v1/runs", {
        "input": "Use your terminal tool to run `echo probe-ok`, then reply with exactly: RUN_OK",
        "session_id": sid})
    rid = run.get("run_id")
    print(f"POST /v1/runs {st}: {short(run, 300)}")
    last = None
    n = 0
    for sse_id, sse_event, ev in sse(rid):
        note(sse_id, sse_event, ev)
        last = sse_id
        n += 1
        if n >= 3:
            break  # detach on purpose
    print(f"  -- detached after {n} events at id={last}; sleeping 6s; run keeps going server-side")
    time.sleep(6)
    st, polled = req("GET", f"/v1/runs/{rid}")
    print(f"  GET /v1/runs/{{id}} while detached {st}: status={polled.get('status')} keys={sorted(polled)}")
    final = None
    for sse_id, sse_event, ev in sse(rid, last_id=last):
        name = note(sse_id, sse_event, ev)
        if name in TERMINAL:
            final = ev
            break
    print(f"  re-attached: terminal={final and final.get('event')} output={short((final or {}).get('output'), 200)}")

    # --- run 2: approval -----------------------------------------------------------------
    st, run2 = req("POST", "/v1/runs", {
        "input": ("Use your terminal tool to run exactly: rm -rf /tmp/hermes-approval-probe-dir "
                  "(a throwaway path). If it is blocked or denied, reply with exactly: DENIED_OK"),
        "session_id": sid})
    rid2 = run2.get("run_id")
    print(f"POST /v1/runs (approval) {st}: {short(run2, 200)}")
    answered = False
    final2 = None
    for sse_id, sse_event, ev in sse(rid2):
        name = note(sse_id, sse_event, ev)
        if name == "approval.request" and not answered:
            st, polled = req("GET", f"/v1/runs/{rid2}")
            print(f"  pending_controls: {short(polled.get('pending_controls'), 600)}")
            body = {"choice": "deny"}
            if ev.get("request_id"):
                body["request_id"] = ev["request_id"]
            if ev.get("execution_generation") is not None:
                body["execution_generation"] = ev["execution_generation"]
            pcs = polled.get("pending_controls") or []
            if isinstance(pcs, list) and pcs and "request_id" not in body:
                body["request_id"] = pcs[0].get("prompt_id") or pcs[0].get("request_id")
                body["execution_generation"] = pcs[0].get("execution_generation")
            st, resp = req("POST", f"/v1/runs/{rid2}/approval", body)
            print(f"  POST approval {json.dumps(body)} -> {st}: {short(resp, 300)}")
            answered = True
        if name in TERMINAL:
            final2 = ev
            break
    print(f"  approval run terminal={final2 and final2.get('event')} output={short((final2 or {}).get('output'), 200)} "
          f"(approval.request seen: {answered})")

    # --- stored transcript, sessions list, jobs ------------------------------------------
    st, msgs = req("GET", f"/api/sessions/{sid}/messages")
    print(f"messages {st}: count={len(msgs.get('data', []))} roles={[m.get('role') for m in msgs.get('data', [])]}")
    for m in msgs.get("data", [])[:6]:
        print(f"  msg keys={sorted(m)} sample={short({k: m[k] for k in m if k in ('role','content','tool_name','display_kind')}, 220)}")
    st, lst = req("GET", "/api/sessions?limit=5")
    print(f"sessions {st}: first={short((lst.get('data') or [{}])[0], 500)}")
    st, jobs = req("GET", "/api/jobs")
    print(f"jobs {st}: {short(jobs, 300)}")

    st, deleted = req("DELETE", f"/api/sessions/{sid}")
    print(f"cleanup delete session {st}: {short(deleted, 200)}")
    print("EVENT SHAPES:")
    for name, keys in seen_shapes.items():
        print(f"  {name}: {keys}")


if __name__ == "__main__":
    main()
