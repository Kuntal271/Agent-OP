"""Always-on Hermes on Modal (Zamp workspace, `main` env, namespaced kuntal-hermes-*).

Usage (from this directory):
    uv run --with modal python hermes_modal.py smoke   # build image, boot a short sandbox, check binaries
"""

import argparse
import sys

import modal

APP_NAME = "kuntal-hermes-remote"
ENVIRONMENT = "main"

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("curl", "git", "ca-certificates", "procps", "iproute2", "xz-utils", "openssh-client")
    # Tailscale: runs userspace-networking inside the sandbox (no TUN device needed).
    .run_commands("curl -fsSL https://tailscale.com/install.sh | sh")
    # Hermes: headless install, no setup wizard, no bundled Chromium.
    .run_commands(
        "curl -fsSL https://hermes-agent.nousresearch.com/install.sh -o /tmp/hermes-install.sh",
        "bash /tmp/hermes-install.sh --skip-setup --skip-browser",
    )
    .env({"PATH": "/root/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"})
)


def _app() -> modal.App:
    return modal.App.lookup(APP_NAME, create_if_missing=True, environment_name=ENVIRONMENT)


def _run(sb: modal.Sandbox, cmd: str) -> tuple[int, str]:
    proc = sb.exec("bash", "-lc", cmd)
    out = proc.stdout.read() + proc.stderr.read()
    return proc.wait(), out.strip()


def smoke() -> int:
    app = _app()
    with modal.enable_output():
        sb = modal.Sandbox.create(app=app, image=image, timeout=600, cpu=0.125, memory=1024)
    print(f"sandbox: {sb.object_id}")
    failures = 0
    try:
        for label, cmd in [
            ("hermes", "hermes --version"),
            ("tailscale", "tailscale version | head -1"),
            ("tailscaled", "command -v tailscaled"),
            ("python", "python3 --version"),
            ("mem", "free -m | head -2"),
        ]:
            rc, out = _run(sb, cmd)
            failures += rc != 0
            print(f"[{label}] rc={rc}\n{out}\n")
    finally:
        sb.terminate()
        print("sandbox terminated")
    return 1 if failures else 0


TS_SECRET = "kuntal-hermes-tailscale"

# tailscaled in userspace mode (no TUN in the sandbox). --state=mem: => ephemeral node that
# Tailscale auto-removes, so test nodes never linger in the tailnet.
_TSD = (
    "mkdir -p /var/run/tailscale /var/lib/tailscale /srv && "
    "(tailscaled --tun=userspace-networking --state=mem: {extra} > /tmp/tsd.log 2>&1 &) && "
)


def _ts_sandbox(app: modal.App, extra: str, serve_http: bool, secret_names: tuple = (TS_SECRET,)) -> modal.Sandbox:
    script = _TSD.format(extra=extra)
    if serve_http:
        script += (
            "echo hermes-tailnet-ok > /srv/index.html && "
            "(cd /srv && python3 -m http.server 8642 --bind 127.0.0.1 > /tmp/http.log 2>&1 &) && "
        )
    script += "sleep infinity"
    return modal.Sandbox.create(
        "bash", "-c", script, app=app, image=image, timeout=600, cpu=0.125, memory=512,
        secrets=[modal.Secret.from_name(n, environment_name=ENVIRONMENT) for n in secret_names],
    )


def _ts_up(sb: modal.Sandbox, hostname: str) -> tuple[int, str]:
    return _run(sb, f'sleep 2; tailscale up --authkey="$TS_AUTHKEY" --hostname={hostname} --timeout=90s')


def tailnet() -> int:
    import json

    app = _app()
    server = _ts_sandbox(app, extra="--statedir=/var/lib/tailscale", serve_http=True)
    probe = _ts_sandbox(app, extra="--outbound-http-proxy-listen=127.0.0.1:1055", serve_http=False)
    print(f"server={server.object_id} probe={probe.object_id}")
    ok = False
    try:
        rc, out = _ts_up(server, "kuntal-hermes-test")
        print(f"[server up] rc={rc} {out[-400:]}")
        if rc:
            return 1
        rc, out = _run(server, "tailscale status --json 2>/dev/null")
        st = json.loads(out)
        me = st["Self"]
        dns = me["DNSName"].rstrip(".")
        ip4 = next(ip for ip in me["TailscaleIPs"] if "." in ip)
        print(f"[server] dns={dns} ip={ip4} tags={me.get('Tags')} tailnet={st.get('CurrentTailnet', {}).get('Name')}")
        rc, out = _run(server, "tailscale serve --bg 8642 && tailscale serve status")
        print(f"[serve] rc={rc}\n{out[-600:]}")
        rc, out = _run(server, f"tailscale cert --cert-file /tmp/c.crt --key-file /tmp/c.key {dns}")
        print(f"[cert] rc={rc} {out[-500:]}")

        rc, out = _ts_up(probe, "kuntal-hermes-probe")
        print(f"[probe up] rc={rc} {out[-400:]}")
        if rc:
            return 1
        px = "-x http://127.0.0.1:1055"
        rc, out = _run(probe, f"curl -sS --max-time 20 {px} http://{ip4}:8642/")
        print(f"[plain tailnet http://{ip4}:8642] rc={rc} body={out[-200:]!r}")
        for attempt in range(1, 4):  # first HTTPS hit triggers the cert fetch; allow retries
            rc, out = _run(probe, f"curl -sS --max-time 60 {px} https://{dns}/")
            print(f"[https://{dns} attempt {attempt}] rc={rc} body={out[-300:]!r}")
            if rc == 0 and "hermes-tailnet-ok" in out:
                ok = True
                break
        if not ok:
            _, log = _run(server, "grep -iE 'cert|acme|tls|https' /tmp/tsd.log | tail -8")
            print(f"[tailscaled cert log]\n{log}")
    finally:
        for sb in (server, probe):
            _run(sb, "tailscale logout >/dev/null 2>&1 || true")
            sb.terminate()
        print("sandboxes logged out of tailnet and terminated")
    print("TAILNET HTTPS: PASS" if ok else "TAILNET HTTPS: FAIL")
    return 0 if ok else 1


HOST = "kuntal-hermes"  # MagicDNS name on the personal tailnet
STATE_DICT = "kuntal-hermes-state"
RUN_SECRETS = (TS_SECRET, "kuntal-hermes-bedrock", "kuntal-hermes-api")
LIFETIME_S = 24 * 3600  # Modal's sandbox maximum; rotation replaces the sandbox before this

# Entrypoint of the always-on sandbox. Everything persistent lives on the sandbox filesystem
# (/root/.hermes, /var/lib/tailscale) and is carried across rotations by filesystem snapshots.
BOOT = r"""
exec > /var/log/boot.log 2>&1
echo "boot start $(date -u +%FT%TZ)"
mkdir -p /var/run/tailscale /var/lib/tailscale /root/.hermes/logs

# 1) Tailscale with persistent state: same node identity after every snapshot restore.
(tailscaled --tun=userspace-networking --statedir=/var/lib/tailscale > /var/log/tailscaled.log 2>&1 &)
for i in $(seq 1 30); do [ -S /var/run/tailscale/tailscaled.sock ] && break; sleep 1; done
ts_state() { tailscale status --json 2>/dev/null | python3 -c 'import sys,json;print(json.load(sys.stdin).get("BackendState",""))' 2>/dev/null; }
for i in $(seq 1 20); do [ "$(ts_state)" = "Running" ] && break; sleep 1; done
if [ "$(ts_state)" != "Running" ]; then
  echo "tailscale: first join with auth key"
  tailscale up --authkey="$TS_AUTHKEY" --hostname=__HOST__ --timeout=90s
fi
echo "tailscale: $(ts_state)"

# 2) Hermes secrets regenerated from Modal secrets on every boot (swap a secret, rotate, done).
python3 - <<'PY'
import os, pathlib, re
p = pathlib.Path("/root/.hermes/.env"); p.parent.mkdir(parents=True, exist_ok=True)
keep = [l for l in (p.read_text().splitlines() if p.exists() else []) if not re.match(r"^(AWS_|API_SERVER_)", l)]
names = ("AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "AWS_BEARER_TOKEN_BEDROCK",
         "AWS_REGION", "AWS_DEFAULT_REGION", "API_SERVER_KEY", "API_SERVER_CORS_ORIGINS")
add = [f"{k}={os.environ[k]}" for k in names if os.environ.get(k)] + ["API_SERVER_ENABLED=true"]
p.write_text("\n".join(keep + add) + "\n"); p.chmod(0o600)
print("env: wrote", [a.split("=", 1)[0] for a in add])
PY
hermes config set model.provider bedrock
hermes config set model.default "${HERMES_BEDROCK_MODEL:-global.anthropic.claude-sonnet-5-5}"
hermes config set bedrock.region "${AWS_REGION:-us-east-1}"
hermes config set gateway.unmanaged_idle_exit_seconds 0

# 3) Gateway in the foreground under a restart loop (touch /tmp/no-restart to stop it for rotation).
#    A snapshot restore carries the previous container's runtime files; no gateway runs yet, so clear them.
rm -f /tmp/no-restart /root/.hermes/gateway.pid /root/.hermes/gateway.lock /root/.hermes/gateway.sock \
      /root/.hermes/state/*.sock
(while [ ! -f /tmp/no-restart ]; do
   hermes gateway run --accept-hooks >> /root/.hermes/logs/gateway-run.log 2>&1
   echo "gateway exited rc=$? $(date -u +%FT%TZ)" >> /root/.hermes/logs/gateway-run.log; sleep 5
 done &)

# 4) Publish the API Server (loopback only) on the tailnet over HTTPS.
for i in $(seq 1 120); do curl -fsS http://127.0.0.1:8642/health > /dev/null 2>&1 && break; sleep 2; done
curl -fsS http://127.0.0.1:8642/health && echo
tailscale serve --bg 8642
echo "BOOT_OK $(date -u +%FT%TZ)"
sleep infinity
""".replace("__HOST__", HOST)


def _state() -> modal.Dict:
    return modal.Dict.from_name(STATE_DICT, create_if_missing=True, environment_name=ENVIRONMENT)


def _running(sandbox_id: str | None) -> modal.Sandbox | None:
    if not sandbox_id:
        return None
    try:
        sb = modal.Sandbox.from_id(sandbox_id)
        return sb if sb.poll() is None else None
    except Exception:
        return None


def _boot(image_obj: modal.Image) -> modal.Sandbox:
    sb = modal.Sandbox.create(
        "bash", "-c", BOOT, app=_app(), image=image_obj, timeout=LIFETIME_S,
        cpu=(0.125, 2.0), memory=(1024, 3072),
        secrets=[modal.Secret.from_name(n, environment_name=ENVIRONMENT) for n in RUN_SECRETS],
    )
    import time
    for _ in range(150):  # up to ~10 min for the first gateway start
        _, log = _run(sb, "cat /var/log/boot.log 2>/dev/null")
        if "BOOT_OK" in log:
            print(log[-1500:])
            return sb
        if sb.poll() is not None:
            raise RuntimeError(f"sandbox exited during boot:\n{log[-2000:]}")
        time.sleep(4)
    raise RuntimeError(f"boot timed out:\n{log[-2000:]}")


def up() -> int:
    import datetime
    st = _state()
    cur = _running(st.get("sandbox_id"))
    if cur:
        print(f"already running: {cur.object_id} since {st.get('started_at')}")
        return 0
    image_id = st.get("image_id")
    img = modal.Image.from_id(image_id) if image_id else image
    print(f"booting from {'snapshot ' + image_id if image_id else 'base image'}")
    sb = _boot(img)
    st["sandbox_id"] = sb.object_id
    st["started_at"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(f"UP: {sb.object_id}")
    return 0


def check() -> int:
    """End-to-end from a throwaway tailnet node: HTTPS -> API Server -> agent -> Bedrock."""
    import json
    probe = _ts_sandbox(_app(), extra="--outbound-http-proxy-listen=127.0.0.1:1055", serve_http=False,
                        secret_names=(TS_SECRET, "kuntal-hermes-api"))
    ok = False
    try:
        rc, out = _ts_up(probe, "kuntal-hermes-probe")
        if rc:
            print(f"probe join failed: {out[-300:]}")
            return 1
        _, dns = _run(probe, f"tailscale status --json 2>/dev/null | python3 -c \"import sys,json;"
                             f"p=[v for v in json.load(sys.stdin)['Peer'].values() if v['HostName']=='{HOST}' and v['Online']];"
                             f"print(p[0]['DNSName'].rstrip('.') if p else '')\"")
        if not dns:
            print(f"{HOST} not online in tailnet")
            return 1
        base = f"https://{dns}"
        key = '"Authorization: Bearer $API_SERVER_KEY"'
        cx = "curl -sS --max-time 180 -x http://127.0.0.1:1055"
        rc, out = _run(probe, f"{cx} {base}/health")
        print(f"[health] rc={rc} {out[:200]}")
        # Browser-based clients (Chatbox on Android = WebView, origin http://localhost) preflight first.
        rc, out = _run(probe, f"{cx} -o /dev/null -D - -X OPTIONS -H 'Origin: http://localhost' "
                              f"-H 'Access-Control-Request-Method: POST' "
                              f"-H 'Access-Control-Request-Headers: authorization,content-type' "
                              f"{base}/v1/chat/completions | grep -iE '^HTTP|access-control-allow-origin'")
        print(f"[cors preflight http://localhost] {' | '.join(out.split())}")
        rc, out = _run(probe, f"{cx} -o /dev/null -w '%{{http_code}}' {base}/api/sessions")
        print(f"[sessions without key] HTTP {out}")
        rc, out = _run(probe, f"{cx} -H {key} {base}/api/sessions")
        print(f"[sessions with key] rc={rc} {out[:300]}")
        body = json.dumps({"model": "hermes-agent",
                           "messages": [{"role": "user", "content": "Reply with exactly: HERMES_REMOTE_OK"}]})
        rc, out = _run(probe, f"{cx} -H {key} -H 'Content-Type: application/json' -d '{body}' {base}/v1/chat/completions")
        print(f"[chat] rc={rc} {out[:600]}")
        ok = rc == 0 and "HERMES_REMOTE_OK" in out
    finally:
        _run(probe, "tailscale logout >/dev/null 2>&1 || true")
        probe.terminate()
    print(f"URL: {base}" if ok else "")
    print("END-TO-END: PASS" if ok else "END-TO-END: FAIL")
    return 0 if ok else 1


def logs() -> int:
    sb = _running(_state().get("sandbox_id"))
    if not sb:
        print("not running")
        return 1
    _, out = _run(sb, "tail -40 /var/log/boot.log; echo ---; tail -40 /root/.hermes/logs/gateway-run.log")
    print(out)
    return 0


ROTATE_AFTER_S = 20 * 3600   # replace the sandbox well before Modal's 24 h cap
BACKUP_EVERY_S = 6 * 3600    # crash-consistent snapshot cadence between rotations
KEEP_SNAPSHOTS = 5

# Graceful stop: block the restart loop, SIGTERM the gateway (pid from Hermes' gateway.pid), wait.
QUIESCE = r"""
touch /tmp/no-restart
pid=$(python3 -c 'import json;t=open("/root/.hermes/gateway.pid").read().strip()
try: print(json.loads(t)["pid"])
except Exception: print(int(t))' 2>/dev/null)
[ -n "$pid" ] && kill -TERM "$pid" 2>/dev/null
for i in $(seq 1 60); do kill -0 "$pid" 2>/dev/null || { echo "gateway $pid stopped after ${i}s"; exit 0; }; sleep 1; done
kill -KILL "$pid" 2>/dev/null; echo "gateway $pid killed after 60s"
"""


def _now():
    import datetime
    return datetime.datetime.now(datetime.timezone.utc)


def _age_s(iso: str | None) -> float:
    import datetime
    return (_now() - datetime.datetime.fromisoformat(iso)).total_seconds() if iso else float("inf")


def _record_snapshot(st: modal.Dict, image_id: str, kind: str) -> None:
    hist = list(st.get("snapshots", []))
    hist.append({"image_id": image_id, "at": _now().isoformat(), "kind": kind})
    st["snapshots"] = hist[-KEEP_SNAPSHOTS:]
    st["image_id"] = image_id
    st["snapshot_at"] = _now().isoformat()


def snapshot() -> int:
    """Live backup snapshot (no downtime; crash-consistent, like a power cut)."""
    st = _state()
    sb = _running(st.get("sandbox_id"))
    if not sb:
        print("not running")
        return 1
    img = sb.snapshot_filesystem()
    _record_snapshot(st, img.object_id, "backup")
    print(f"SNAPSHOT: {img.object_id} of {sb.object_id}")
    return 0


def rotate() -> int:
    """Clean stop -> snapshot -> terminate old -> boot new from the snapshot (~1-2 min downtime)."""
    st = _state()
    old = _running(st.get("sandbox_id"))
    if old:
        rc, out = _run(old, QUIESCE)
        print(f"[quiesce] {out.strip()}")
        img = old.snapshot_filesystem()
        _record_snapshot(st, img.object_id, "rotation")
        print(f"[snapshot] {img.object_id}")
        old.terminate()  # before the new boot: both would share one tailscale node identity
        print(f"[terminated] {old.object_id}")
    image_id = st.get("image_id")
    sb = _boot(modal.Image.from_id(image_id) if image_id else image)
    st["sandbox_id"] = sb.object_id
    st["started_at"] = _now().isoformat()
    print(f"ROTATED: {sb.object_id} from {image_id or 'base image'}")
    return 0


def ensure() -> int:
    """Hourly: heal if down, rotate when old, back up periodically."""
    st = _state()
    cur = _running(st.get("sandbox_id"))
    if not cur:
        print("ensure: not running -> boot from latest snapshot")
        return rotate()
    age = _age_s(st.get("started_at"))
    if age > ROTATE_AFTER_S:
        print(f"ensure: age {age/3600:.1f}h -> rotate")
        return rotate()
    if _age_s(st.get("snapshot_at")) > BACKUP_EVERY_S:
        print("ensure: backup snapshot")
        return snapshot()
    print(f"ensure: healthy {cur.object_id}, age {age/3600:.1f}h")
    return 0


def status() -> int:
    st = _state()
    cur = _running(st.get("sandbox_id"))
    print(f"sandbox   : {st.get('sandbox_id')} ({'running' if cur else 'NOT running'})")
    print(f"started   : {st.get('started_at')}  (age {_age_s(st.get('started_at'))/3600:.1f}h, rotates at 20h)")
    print(f"snapshot  : {st.get('image_id')} at {st.get('snapshot_at')}")
    for s in st.get("snapshots", []):
        print(f"  - {s['at']}  {s['kind']:<8} {s['image_id']}")
    print(f"url       : https://{HOST}.tail59b530.ts.net")
    return 0


def probe() -> int:
    """Run protocol_probe.py from a throwaway tailnet node against the live API (wire-format capture)."""
    import base64
    import pathlib
    script = pathlib.Path(__file__).with_name("protocol_probe.py").read_bytes()
    sb = _ts_sandbox(_app(), extra="--outbound-http-proxy-listen=127.0.0.1:1055", serve_http=False,
                     secret_names=(TS_SECRET, "kuntal-hermes-api"))
    try:
        rc, out = _ts_up(sb, "kuntal-hermes-probe")
        if rc:
            print(f"probe join failed: {out[-300:]}")
            return 1
        b64 = base64.b64encode(script).decode()
        _run(sb, f"echo {b64} | base64 -d > /tmp/protocol_probe.py")
        proc = sb.exec("bash", "-lc", f"python3 /tmp/protocol_probe.py https://{HOST}.tail59b530.ts.net")
        for line in proc.stdout:  # stream so long agent turns show progress
            print(line, end="")
        err = proc.stderr.read()
        rc = proc.wait()
        if err.strip():
            print(f"[stderr]\n{err[-2000:]}")
        return rc
    finally:
        _run(sb, "tailscale logout >/dev/null 2>&1 || true")
        sb.terminate()


def apptest() -> int:
    """Run the mobile app's bundled API client test (scripts/live-test.ts) on a tailnet node with Node 24."""
    import base64
    import pathlib
    bundle = pathlib.Path(sys.argv[2]).read_bytes()
    sb = _ts_sandbox(_app(), extra="--outbound-http-proxy-listen=127.0.0.1:1055", serve_http=False,
                     secret_names=(TS_SECRET, "kuntal-hermes-api"))
    try:
        rc, out = _ts_up(sb, "kuntal-hermes-probe")
        if rc:
            print(f"probe join failed: {out[-300:]}")
            return 1
        rc, out = _run(sb, "set -e; cd /opt; f=$(curl -fsSL https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt "
                           "| awk '/linux-x64.tar.xz/{print $2}'); curl -fsSL https://nodejs.org/dist/latest-v24.x/$f "
                           "| tar -xJ; ln -sf /opt/${f%.tar.xz}/bin/node /usr/local/bin/node; node --version")
        print(f"[node] rc={rc} {out[-200:]}")
        if rc:
            return 1
        _run(sb, f"echo {base64.b64encode(bundle).decode()} | base64 -d > /tmp/live-test.mjs")
        proc = sb.exec("bash", "-lc", "NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://127.0.0.1:1055 HTTP_PROXY=http://127.0.0.1:1055 "
                                      f"node /tmp/live-test.mjs https://{HOST}.tail59b530.ts.net")
        for line in proc.stdout:
            print(line, end="")
        err = proc.stderr.read()
        if err.strip():
            print(f"[stderr]\n{err[-2000:]}")
        return proc.wait()
    finally:
        _run(sb, "tailscale logout >/dev/null 2>&1 || true")
        sb.terminate()


def main() -> int:
    parser = argparse.ArgumentParser()
    cmds = {"smoke": smoke, "tailnet": tailnet, "up": up, "check": check, "logs": logs,
            "snapshot": snapshot, "rotate": rotate, "ensure": ensure, "status": status, "probe": probe,
            "apptest": apptest}
    parser.add_argument("command", choices=list(cmds))
    parser.add_argument("args", nargs="*")
    args = parser.parse_args()
    return cmds[args.command]()


# Deployed scheduler (`modal deploy hermes_modal.py`): runs on Modal, so the Mac can be off.
app = modal.App(APP_NAME)


@app.function(schedule=modal.Period(hours=1), timeout=1800, retries=0)
def scheduled_ensure():
    ensure()


if __name__ == "__main__":
    sys.exit(main())
