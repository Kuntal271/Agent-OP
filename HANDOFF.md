# HANDOFF — continuing Agent-OP from the always-on Hermes

You are the Hermes instance running **inside** the Modal sandbox this repo deploys. This brief carries
the context of the Desktop session that built it (2026-10-31). Read it fully before acting.

## The owner
- Kuntal (GitHub **Kuntal271**, personal). Work identity is kuntal-zamp / kuntal@zamp.ai — never use it
  for this repo. Commits here: `Kuntal Bar <96326383+Kuntal271@users.noreply.github.com>`.
- Works by handing off a brief, expects autonomous end-to-end execution and a final per-item report
  (done + verified / done-unverified / not done, files changed). Steers with short messages; apply them.
- Never launch or spend the Claude Code CLI / Claude subscription.
- Anything that could power off a device or interrupt family members needs his explicit decision first.

## What exists (all verified on 2026-10-31)
- **infra/** — you. Modal workspace `zamp` (owner's choice), env `main`, every object named `kuntal-hermes-*`.
  Never touch `staging`, `production-us`, `autonomous-bank-*` or other teams' apps/secrets.
  - Sandbox runs `hermes gateway run`; API Server on 127.0.0.1:8642, published only on the owner's
    personal tailnet: `https://kuntal-hermes.tail59b530.ts.net` (`tailscale serve`, tag:hermes).
  - Hourly deployed function `scheduled_ensure`: heal if down, rotate at 20 h (Modal caps sandboxes at 24 h),
    backup snapshot every 6 h. State (`/root/.hermes`, `/var/lib/tailscale`) persists via filesystem snapshots.
  - Secrets: `kuntal-hermes-tailscale`, `kuntal-hermes-bedrock`, `kuntal-hermes-api` (values never in git).
- **mobile/** — Expo SDK 58 app (`com.kuntal271.hermes`, **v1.1.0**): Tasks · Routines · Skills · Usage · Settings
  tabs; chat over durable `/v1/runs` (detach never stops a task; re-attach replays from `Last-Event-ID`) with
  markdown, approvals, steer/stop, per-task model picker, photo attachments, voice dictation; routines CRUD;
  app lock; local notifications. tsc + eslint clean, 7 unit-test groups, 17/17 live feature checks against this
  server (see `docs/FEATURES.md` for what is verified and what is device-unverified).
  `infra/build_android.py` builds a sideloadable release APK in a Modal sandbox.

## Hard rules for you
1. **Never run `hermes_modal.py rotate|up|ensure|snapshot` or `modal deploy` from inside this sandbox** —
   rotation terminates the sandbox you are running in (your turn dies mid-way). Infra changes are made
   from the owner's Mac session. You may read logs/status.
2. Run turns via the API are "unattended": `execute_code` is blocked; use the terminal tool.
3. Before any commit: scan staged content for secrets (`tskey-`, `ASIA`/`AKIA`, `ABSK`, private keys).
   `.secrets/` is gitignored and must stay that way.
4. Bedrock credentials: currently **temporary STS** (expire with the owner's SSO session). When turns start
   failing with auth errors, that is why — tell the owner; do not try to mint keys yourself.

## Open items (owner decisions / actions)
- [ ] Long-term Bedrock API key: `infra/create_bedrock_key.py` with IAM-capable AWS creds, then `rotate` (from the Mac).
      The owner's SSO role `AWSReservedSSO_Bedrock-admin` has no IAM rights.
- [ ] After that key exists: a reminder 7 days before its 90-day expiry.
- [ ] Revoke the Tailscale auth key (node identity already persists in snapshots).
- [ ] Rotate the Modal token (it was pasted in chat).

## Next engineering work (good tasks for you)
- **Run the app on the owner's phone and report what breaks.** The device-only features (camera, microphone
  dictation, biometric lock, local notifications, read-aloud) are built and bundled but have never run on hardware;
  `docs/FEATURES.md` lists them as 🟡. Fix what he reports; keep `tsc`, `expo lint`, `npm run test:unit` green.
- Instant push notifications: needs a Firebase project from the owner (`google-services.json`) and a notifier
  (poll `/v1/runs` or hook the gateway). Today: ~15-minute background check + local notification.
- Dashboard-backed screens (Kanban, files, terminal, config/logs/MCP) — **only after the owner says yes** to
  exposing the dashboard on the tailnet (see `docs/FEATURES.md`).
- Tool-result rendering keeps whitespace on native but collapses it on web; check on device.
- Hermes v0.22.5 `/v1/skills` bug is patched at boot (`infra/hermes_modal.py`); remove the patch when upstream fixes it.

## Where the details are
- `README.md` (architecture + commands), `infra/hermes_modal.py` (all infra logic, comments explain the why),
  `mobile/src/lib/api.ts` (wire contract), `mobile/AGENTS.md` (Expo rules: `npx expo install`, lint + tsc before done).
