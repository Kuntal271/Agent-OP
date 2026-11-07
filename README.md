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

Five tabs — **Tasks · Routines · Skills · Usage · Settings** — plus chat. Full status table with evidence:
[`docs/FEATURES.md`](docs/FEATURES.md).

- **Tasks**: every Hermes session, grouped (needs you / pinned / today …), searchable, filterable; rename, pin,
  archive, delete, **branch**. Live badges (working / needs approval / failed / new result).
- **Chat**: markdown (tables, code with copy), streamed replies and tool steps, approvals, **Steer** / **Stop**,
  **per-task model picker**, **photo attachments**, **voice dictation**, read-aloud, retry, copy.
- **Durable runs**: turns use `POST /v1/runs`; leaving the chat or backgrounding the app detaches without
  stopping the task, and re-attaching replays from the last seen event (`Last-Event-ID`) — no lost or duplicated output.
- **Routines**: create / edit / pause / run-now / delete scheduled tasks with a friendly schedule picker (times are
  in your timezone — the server boots with `timezone: Asia/Kolkata`).
- **Skills**, **Usage** (tokens, cache hits, per-day and per-model), **Server status**.
- **Security**: API key in the OS keystore; optional biometric/PIN **app lock**.
- **Notifications**: local, from a ~15-minute background check (instant push needs Firebase — not set up).
- Device-only features (camera, mic, biometrics, notifications) are built but **not yet run on a phone**.

```bash
cd mobile
npm install
npx tsc --noEmit && npx expo lint && npm run test:unit
npm run mock                       # offline mock Hermes (key: mock-key) for UI work
npx expo start --web               # preview in a browser
```

On the phone: Tailscale connected to the personal tailnet → open the app → paste the server URL
`https://kuntal-hermes.<tailnet>.ts.net` and the API key (or open a `hermes-remote://connect?url=…&key=…` link) → **Connect**.

`mobile/scripts/live-test.ts` (streaming/detach) and `live-features.ts` (everything added in 1.1) exercise the app's
real API client + helpers against the live server (bundle with esbuild, run via
`infra/hermes_modal.py apptest <bundle.mjs>`).

## Security notes

- The API Server listens on loopback only; it is reachable solely through the tailnet via `tailscale serve`,
  and every call needs `API_SERVER_KEY`. No public port exists.
- Secrets live in Modal secrets and the phone keystore — never in git (`.secrets/` is ignored).
- Hermes' smart approvals stay on: risky commands surface as approval cards in the app.

## Known limits / next

- Instant push notifications (today: a ~15-minute background check + local notification). Needs a Firebase
  project (`google-services.json`) and a small server-side notifier.
- Dashboard-backed features (Kanban, files, terminal, config/logs/MCP) are not built; they need the Hermes
  dashboard exposed on the tailnet — an owner decision, see `docs/FEATURES.md`.
- The official Hermes Mobile app is a waitlist beta; this app is independent of it.
- Hermes v0.22.5 bug worked around at boot: `/v1/skills` 500s (`include_editorial` kwarg). See `docs/FEATURES.md`.
