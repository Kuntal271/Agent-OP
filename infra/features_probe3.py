"""Does a per-run `model` override on /v1/runs change the serving model? Verified via the agent log."""

import sys

sys.argv = sys.argv[:2]
from features_probe import run_to_end  # noqa: E402
from protocol_probe import req, short  # noqa: E402

HAIKU = "global.anthropic.claude-haiku-4-5-20251001-v1:0"


def main():
    st, created = req("POST", "/api/sessions", {"title": "Model override probe"})
    sid = created["session"]["id"]
    print("SID", sid)
    for label, extra in (("model only", {"model": HAIKU}), ("model+provider", {"model": HAIKU, "provider": "bedrock"})):
        st, run, final = run_to_end(sid, {"input": f"Reply with exactly: {label.upper().replace(' ', '_')}", **extra})
        print(f"{label}: http={st} terminal={final and final.get('event')} output={short((final or {}).get('output') or run, 100)} "
              f"runtime={short((final or {}).get('runtime'), 220)}")
    req("DELETE", f"/api/sessions/{sid}")


if __name__ == "__main__":
    main()
