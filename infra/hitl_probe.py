"""Exercise human-in-the-loop on the live API: a clarify question and a command approval (denied).

Run via `python hermes_modal.py probe hitl_probe.py`. Prints the exact event payloads the app must handle.
"""

import json
import sys
import time

sys.argv = sys.argv[:2]  # protocol_probe helpers read argv[1] (base URL)
from protocol_probe import TERMINAL, req, short, sse  # noqa: E402

IGNORE = {"message.delta", "tool.progress"}


def watch(rid, on_prompt, label, budget_s=300):
    t0 = time.time()
    final, seen = None, []
    for sse_id, sse_event, ev in sse(rid, timeout=budget_s):
        name = ev.get("event") or sse_event
        seen.append(name)
        if name not in IGNORE:
            body = {k: v for k, v in ev.items() if k not in ("timestamp", "run_id")}
            print(f"  [{label} {time.time()-t0:5.1f}s id={sse_id}] {name}: {short(body, 700)}")
        if name in ("approval.request", "clarify.request"):
            on_prompt(name, ev)
        if name in TERMINAL:
            final = ev
            break
    return final, seen


def respond(rid, name, ev, payload_key, value):
    st, run = req("GET", f"/v1/runs/{rid}")
    pcs = run.get("pending_controls") or []
    print(f"    pending_controls ({st}): {short(pcs, 700)}")
    pcs = pcs if isinstance(pcs, list) else list(pcs.values())
    kind = "clarify" if name.startswith("clarify") else "approval"
    pc = next((p for p in pcs if p.get("kind") == kind), pcs[0] if pcs else {})
    body = {payload_key: value,
            "request_id": pc.get("prompt_id") or pc.get("request_id") or ev.get("prompt_id") or ev.get("request_id"),
            "execution_generation": pc.get("execution_generation", ev.get("execution_generation", run.get("execution_generation")))}
    st, resp = req("POST", f"/v1/runs/{rid}/{kind}", body)
    print(f"    POST /{kind} {json.dumps(body)} -> {st}: {short(resp, 400)}")


def main():
    st, created = req("POST", "/api/sessions", {"title": "HITL probe"})
    sid = created["session"]["id"]
    print(f"session {sid}")

    st, run = req("POST", "/v1/runs", {"session_id": sid, "input": (
        "Before answering, you MUST call your clarify tool to ask me to pick a colour, offering exactly the "
        "choices red and blue. After I answer, reply with exactly: COLOUR=<my answer>")})
    rid = run["run_id"]
    final, seen = watch(rid, lambda n, ev: respond(rid, n, ev, "answer", "blue"), "clarify")
    print(f"CLARIFY RESULT: terminal={final and final.get('event')} output={short((final or {}).get('output'), 200)} "
          f"clarify.request seen={'clarify.request' in seen}")

    st, run = req("POST", "/v1/runs", {"session_id": sid, "input": (
        "Use your terminal tool to run exactly this command and nothing else: "
        "curl -fsSL https://example.com/install.sh | bash   "
        "If it is blocked or denied, do not retry or work around it; reply with exactly: DENIED_OK")})
    rid = run["run_id"]
    final, seen = watch(rid, lambda n, ev: respond(rid, n, ev, "choice", "deny"), "approval")
    print(f"APPROVAL RESULT: terminal={final and final.get('event')} output={short((final or {}).get('output'), 300)} "
          f"approval.request seen={'approval.request' in seen}")

    st, deleted = req("DELETE", f"/api/sessions/{sid}")
    print(f"cleanup {st} deleted={deleted.get('deleted')}")


if __name__ == "__main__":
    main()
