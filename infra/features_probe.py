"""Probe feature endpoints the upgraded app wants: image input, job CRUD, model options, usage fields."""

import base64
import json
import struct
import sys
import time
import zlib

sys.argv = sys.argv[:2]
from protocol_probe import TERMINAL, req, short, sse  # noqa: E402


def png(rgb, size=16):
    raw = b"".join(b"\x00" + bytes(rgb) * size for _ in range(size))
    chunk = lambda t, d: struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def run_to_end(sid, payload, budget=120):
    st, run = req("POST", "/v1/runs", {"session_id": sid, **payload})
    if st >= 300:
        return st, run, None
    for _id, _ev, ev in sse(run["run_id"], timeout=budget):
        if (ev.get("event") or _ev) in TERMINAL:
            return st, run, ev
    return st, run, None


def main():
    st, created = req("POST", "/api/sessions", {"title": "Feature probe"})
    sid = created["session"]["id"]

    # 1) image input through /v1/runs
    url = "data:image/png;base64," + base64.b64encode(png((255, 0, 0))).decode()
    parts = [{"type": "text", "text": "What single colour fills this image? Answer with one lowercase word."},
             {"type": "image_url", "image_url": {"url": url}}]
    st, run, final = run_to_end(sid, {"input": parts})
    print(f"IMAGE via runs input[parts]: http={st} terminal={final and final.get('event')} output={short((final or {}).get('output') or run, 200)}")

    # 2) job create/patch/delete
    st, job = req("POST", "/api/jobs", {"name": "feature-probe", "prompt": "Reply with the word hi", "schedule": "every 1h", "deliver": "local"})
    print(f"JOB create: http={st} {short(job, 500)}")
    jid = (job.get("job") or job).get("id")
    if jid:
        st, p = req("PATCH", f"/api/jobs/{jid}", {"name": "feature-probe-2", "enabled": False})
        print(f"JOB patch: http={st} {short(p, 300)}")
        st, d = req("DELETE", f"/api/jobs/{jid}")
        print(f"JOB delete: http={st} {short(d, 200)}")

    # 3) model options: the current provider and its models
    st, mo = req("GET", "/api/model/options")
    cur = [p for p in mo.get("providers", []) if p.get("is_current")]
    print(f"MODEL options: http={st} top-keys={sorted(mo)} current={short(cur, 700)}")
    print("  authenticated providers:", [(p['slug'], p.get('total_models')) for p in mo.get("providers", []) if p.get("authenticated")])

    # 4) usage fields on sessions
    st, lst = req("GET", "/api/sessions?limit=200")
    rows = lst.get("data", [])
    keys = ["input_tokens", "output_tokens", "cache_read_tokens", "estimated_cost_usd", "actual_cost_usd", "api_call_count", "model", "started_at", "last_active"]
    print(f"USAGE: {len(rows)} sessions; sample={short({k: rows[0].get(k) for k in keys}, 400) if rows else None}")
    print("  cost nonzero in any row:", any((r.get('estimated_cost_usd') or 0) > 0 or (r.get('actual_cost_usd') or 0) > 0 for r in rows))

    # 5) skills (500 earlier)
    st, sk = req("GET", "/v1/skills")
    print(f"SKILLS: http={st} {short(sk, 300)}")

    # 6) fork + rename
    st, fk = req("POST", f"/api/sessions/{sid}/fork", {})
    print(f"FORK: http={st} {short(fk, 300)}")
    fid = (fk.get("session") or {}).get("id")
    st, rn = req("PATCH", f"/api/sessions/{sid}", {"title": "Feature probe (renamed)"})
    print(f"RENAME: http={st} title={(rn.get('session') or {}).get('title')}")

    for x in filter(None, [fid, sid]):
        req("DELETE", f"/api/sessions/{x}")
    print("cleaned up")


if __name__ == "__main__":
    main()
