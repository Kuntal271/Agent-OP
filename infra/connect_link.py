#!/usr/bin/env python3
"""Print (and copy to the clipboard) the phone connect link for the always-on Hermes.

    python3 infra/connect_link.py [--show]

The link opens the app on the phone and pre-fills the server URL and API key:
    hermes-remote://connect?url=https%3A%2F%2F…&key=…
It contains the secret, so send it only through a private channel (Quick Share to yourself, a password manager,
Signal "Note to self") and delete it afterwards. The key never leaves the tailnet-only server's reach: the server
answers nothing unless Tailscale is connected on the phone.
"""

import os
import pathlib
import subprocess
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent
KEY_FILE = pathlib.Path(os.environ.get("HERMES_KEY_FILE", ROOT / ".secrets" / "api_server_key"))
URL = os.environ.get("HERMES_URL", "https://kuntal-hermes.tail59b530.ts.net")


def main() -> int:
    if not KEY_FILE.exists():
        print(f"no key at {KEY_FILE} — run `hermes_modal.py up` first", file=sys.stderr)
        return 1
    key = KEY_FILE.read_text().strip()
    link = "hermes-remote://connect?" + urllib.parse.urlencode({"url": URL, "key": key})
    show = "--show" in sys.argv
    shown = link if show else link.replace(key, key[:4] + "…" + key[-4:])
    print(shown)
    try:
        subprocess.run(["pbcopy"], input=link.encode(), check=True)
        print("(full link copied to the clipboard)")
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("(pbcopy unavailable — re-run with --show to print the full link)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
