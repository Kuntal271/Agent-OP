"""Second feature probe: image input via runs (message-list shape), model switch, run on a switched model."""

import base64
import sys

sys.argv = sys.argv[:2]
from features_probe import png, run_to_end  # noqa: E402
from protocol_probe import req, short  # noqa: E402


def main():
    st, created = req("POST", "/api/sessions", {"title": "Feature probe 2"})
    sid = created["session"]["id"]
    url = "data:image/png;base64," + base64.b64encode(png((0, 0, 255))).decode()
    parts = [{"type": "text", "text": "What single colour fills this image? Answer with one lowercase word."},
             {"type": "image_url", "image_url": {"url": url}}]

    st, run, final = run_to_end(sid, {"input": [{"role": "user", "content": parts}]})
    print(f"IMAGE runs input=[{{role,content:[parts]}}]: http={st} terminal={final and final.get('event')} "
          f"output={short((final or {}).get('output') or run, 240)}")

    st, ml = req("POST", f"/api/sessions/{sid}/model", {"model": "global.anthropic.claude-haiku-4-5-20251001-v1:0", "provider": "bedrock"})
    print(f"MODEL LOCK: http={st} {short(ml, 400)}")
    st, run, final = run_to_end(sid, {"input": "Reply with exactly: HAIKU_OK"})
    print(f"RUN after lock: http={st} terminal={final and final.get('event')} output={short((final or {}).get('output') or run, 120)} "
          f"runtime={short((final or {}).get('runtime'), 200)}")
    st, s = req("GET", f"/api/sessions/{sid}")
    print(f"SESSION model after: {(s.get('session') or {}).get('model')}")
    req("DELETE", f"/api/sessions/{sid}")
    print("cleaned up")


if __name__ == "__main__":
    main()
