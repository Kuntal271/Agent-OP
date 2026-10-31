# Agent-OP

Always-on [Hermes Agent](https://github.com/NousResearch/hermes-agent) in a cloud sandbox, plus a
mobile app to juggle its tasks from your phone.

```
 phone (Expo app / any OpenAI-compatible client)
   │  HTTPS, private tailnet only (Tailscale, tag:hermes)
   ▼
 Modal sandbox  ── tailscaled (userspace) ── tailscale serve :443 → 127.0.0.1:8642
   └─ hermes gateway run  (API Server: /api/sessions, /v1/runs, /api/jobs; Bearer API_SERVER_KEY)
        └─ Bedrock (Claude Sonnet) for the model; tools run inside the sandbox

 Modal scheduled function (hourly): heal if down · rotate before the 24 h sandbox cap · 6 h backups
 State (~/.hermes, tailscale identity) survives via filesystem snapshots.
```

## infra/ — the always-on Hermes (Modal + Tailscale)

`infra/hermes_modal.py` builds the image (Debian + Tailscale + headless Hermes) and manages the sandbox.

```bash
cd infra
R="uv run --python 3.12 --with modal==1.6.3 python hermes_modal.py"
$R up          # boot (from the latest snapshot if one exists)
$R check       # end-to-end from a throwaway tailnet node: health, CORS, auth, a real chat turn
$R status      # sandbox id, age, snapshots, URL
$R logs        # boot + gateway logs
$R rotate      # clean stop -> snapshot -> new sandbox (~30 s); also how secret changes take effect
$R snapshot    # live backup
modal deploy hermes_modal.py   # hourly `scheduled_ensure` (heal / rotate at 20 h / backup every 6 h)
```

Modal secrets (values never live in this repo):

| Secret | Keys |
|---|---|
| `kuntal-hermes-tailscale` | `TS_AUTHKEY` — reusable, pre-approved, `tag:hermes` (only needed for the first join) |
| `kuntal-hermes-bedrock` | `AWS_BEARER_TOKEN_BEDROCK` (long-term key) **or** temporary STS `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`AWS_SESSION_TOKEN`; `AWS_REGION`, `HERMES_BEDROCK_MODEL` |
| `kuntal-hermes-api` | `API_SERVER_KEY`, `API_SERVER_CORS_ORIGINS` (`http://localhost,capacitor://localhost` for WebView clients such as Chatbox) |

`infra/create_bedrock_key.py` mints a 90-day Bedrock API key for an invoke-only IAM user and stores it
straight into `kuntal-hermes-bedrock` (needs IAM-capable AWS credentials). Then run `rotate`.

Other tools: `protocol_probe.py` (captures the live API wire format), `hermes_modal.py probe|apptest|tailnet|smoke`.

## mobile/ — the Hermes app (Expo SDK 58, iOS + Android)

- **Tasks**: every Hermes session, with live badges (working / needs approval / failed / new result).
- **Chat**: streamed replies and tool steps, approvals, clarifications, **Steer** and **Stop** while a task runs.
- **Durable runs**: turns use `POST /v1/runs`; leaving the chat or backgrounding the app detaches without
  stopping the task, and re-attaching replays from the last seen event (`Last-Event-ID`) — no lost or duplicated output.
- **Jobs**: scheduled jobs with Run now / Pause / Resume.
- API key stored in the OS keystore (expo-secure-store); run bookkeeping in `expo-sqlite/kv-store`.

```bash
cd mobile
npm install
npx expo start            # scan the QR code with Expo Go (phone on the same Wi-Fi as this computer)
npx tsc --noEmit && npx expo lint
```

On the phone: Tailscale connected to the personal tailnet → open the app → Settings: server URL
`https://kuntal-hermes.<tailnet>.ts.net` + the API key → **Test & save**.

`mobile/scripts/live-test.ts` exercises the app's real API client against the live server
(bundle with esbuild, run via `infra/hermes_modal.py apptest <bundle.mjs>`).

## Security notes

- The API Server listens on loopback only; it is reachable solely through the tailnet via `tailscale serve`,
  and every call needs `API_SERVER_KEY`. No public port exists.
- Secrets live in Modal secrets and the phone keystore — never in git (`.secrets/` is ignored).
- Hermes' smart approvals stay on: risky commands surface as approval cards in the app.

## Known limits / next

- Push notifications when a task finishes while the app is closed (needs a small server-side notifier + an EAS dev build).
- The approval card follows the documented `pending_controls` contract; smart approval auto-approved the
  only command used in testing, so the manual-approval path has not yet been exercised live.
