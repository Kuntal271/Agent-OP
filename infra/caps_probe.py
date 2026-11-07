"""Dump /v1/capabilities, model options, skills, toolsets and usage-ish endpoints from the live server."""

import json
import sys

sys.argv = sys.argv[:2]
from protocol_probe import req, short  # noqa: E402


def main():
    st, caps = req("GET", "/v1/capabilities")
    print(f"capabilities {st}: top-level keys={sorted(caps)}")
    print("FEATURES:", json.dumps(caps.get("features"), sort_keys=True))
    print("ENDPOINTS:", json.dumps(caps.get("endpoints"), sort_keys=True)[:6000])
    for k in sorted(caps):
        if k not in ("features", "endpoints"):
            print(f"{k}: {short(caps[k], 400)}")
    for path in ("/api/model/options", "/v1/skills", "/v1/toolsets", "/v1/models", "/health/detailed"):
        st, body = req("GET", path)
        print(f"\nGET {path} -> {st}: {short(body, 900)}")
    st, jobs = req("GET", "/api/jobs")
    print(f"\nGET /api/jobs -> {st}: {short(jobs, 300)}")


if __name__ == "__main__":
    main()
