# Hermes mobile — must-haves, status, and evidence

Release **1.1.0** (Android first; the same code builds for iOS but needs an Apple developer account + Xcode).

## What this is measured against

The *official* Hermes Mobile is a **waitlist beta** (hermes-agent.nousresearch.com/mobile) and its page lists no
features, so nothing here claims parity with it. The baseline is (a) what the Hermes **desktop app and dashboard**
document (chat, sessions + search, cron, skills, analytics, logs, config, MCP, kanban, file browser, terminal …) and
(b) what people expect from a phone client for a long-running agent (resume, approve, voice, photos, notifications).
There is also a community plugin, *Hermes Mobile Adapter* (WebSocket platform) — not used here.

## Legend

| Mark | Meaning |
|---|---|
| ✅ **Live** | Exercised against the real server (`scripts/live-features.ts`, 17/17 pass; earlier probes) |
| ✅ **UI** | Exercised end-to-end through the UI in a web preview against `scripts/mock-server.mjs` |
| 🟡 **Built, device-unverified** | Needs a real phone (camera, mic, biometrics, OS notifications). Compiles, bundles, and is in the APK; **nobody has run it on a device yet** |
| ⛔ **Not built** | Needs the dashboard API or other infrastructure — see "Not built" |

## Tasks and chat

| Feature | Status | Evidence / notes |
|---|---|---|
| Streaming replies, live tool steps | ✅ Live, ✅ UI | durable `/v1/runs`; detach/re-attach replays from `Last-Event-ID` with no duplicates |
| Markdown: headings, lists, tables, code blocks with Copy, links | ✅ UI | `react-native-markdown-display`; table borders and code copy checked visually |
| Approval card (Allow once / for this task / always / Deny) | ✅ Live (v1.0.1), ✅ UI (v1.1 redesign) | stacked full-width buttons ≥ 46 px; 30-minute server window; real `approval.settled` clears it |
| Steer and Stop a running task | ✅ Live | |
| Per-task model picker (182 Bedrock models, searchable) | ✅ Live, ✅ UI | `model`+`provider` on `POST /v1/runs` **is** honored (agent log showed Haiku serving it); the session-level lock endpoint is **not** honored by runs, so the app doesn't use it |
| Image attachments (library / camera → resized to 1280 px JPEG) | ✅ Live (server + client shape: model answered "blue"); 🟡 picker and camera | shape is `input=[{role:'user',content:[text,image_url]}]` |
| Voice dictation, optional auto-send on pause | 🟡 | `expo-speech-recognition`; Google speech service declared in the manifest |
| Read replies aloud | 🟡 | `expo-speech` |
| Rename, pin, archive, unarchive, delete, **branch** (fork) | ✅ Live | duplicate titles are rejected by the server — the app now shows the error |
| Search, filters (Needs you / Pinned / Routines / Archived), date groups | ✅ UI, unit-tested | |
| Long-press: copy, read aloud, retry last message; copy conversation; jump to latest | 🟡 | built; retry and clipboard not exercised |
| Read-only view of tasks from other surfaces (CLI, routines) + "Branch & continue" | 🟡 | forking a *non-API* session was not tested; routines' output sessions are the main use |
| Offline banner, pull-to-refresh, skeleton loaders, empty states | ✅ UI (empty/skeleton), 🟡 offline banner | |

## Routines (scheduled tasks)

| Feature | Status | Evidence |
|---|---|---|
| List, create, edit, pause/resume, run now, delete | ✅ Live | |
| Schedule picker: every N min/hours, daily, weekdays, weekly, custom cron/ISO | ✅ Live, unit-tested | server needs `croniter` (present); invalid input returns a readable 400 |
| Runs in **your** timezone | ✅ Live | sandbox was UTC; boot now sets `timezone: Asia/Kolkata` (`HERMES_TIMEZONE` overrides). Next runs show `+05:30` |
| Plain-language schedule ("Weekdays at 09:30"), Failed / Never run chips | ✅ UI, unit-tested | |

## Skills, usage, server

| Feature | Status | Evidence |
|---|---|---|
| Browse / search skills, start a task with one | ✅ Live (54 skills), ✅ UI | needed a **server patch** — see below |
| Usage: tokens, calls, tool calls, cache-hit %, 7/30/all, per-day chart, per-model share, heaviest tasks | ✅ Live data, ✅ UI | cost is not reported for Bedrock models; the screen says so instead of showing $0 |
| Server status: version, gateway, readiness checks | ✅ Live, ✅ UI | |

## Settings, security, connection

| Feature | Status | Notes |
|---|---|---|
| Theme: system / light / dark | ✅ UI | |
| Haptics toggle, default model | ✅ UI | |
| **App lock** (fingerprint / face / PIN; relocks after 30 s in background) | 🟡 | this phone can approve commands — turn it on |
| Task notifications (finished / failed / needs approval) | 🟡 | background check **about every 15 min** (Android minimum) + local notification; tapping opens the task |
| Instant push notifications | ⛔ | needs a Firebase project (FCM) + a server-side notifier |
| Connect screen: paste from clipboard, show/hide key, `hermes-remote://connect?url=…&key=…` deep link | ✅ UI (typed connect), 🟡 paste + deep link | |
| Error boundary ("Something went wrong — Try again") | built | added after a web-only crash showed that a single exception blanked the whole app |
| App icon, adaptive + monochrome icons, branded splash | built | `scripts/make-icons.py` |

## Not built (and why)

| Missing | What it needs |
|---|---|
| Kanban board | dashboard API (`/api/kanban…`) |
| File browser, artifacts, terminal, git review, memory graph, live subagents view | dashboard / desktop backend (terminal is a socket) |
| Config, API keys, logs, profiles, MCP, channels management | dashboard REST (`/api/config`, `/api/logs`, …) |
| Instant push | Firebase project + notifier |
| iOS build | Apple developer account + Xcode |
| Multiple servers, widgets, tablet layout, localisation | scope |

**Decision for the owner:** most of the "not built" rows unlock if the Hermes **dashboard** is exposed on the tailnet
next to the API server (username + password, loopback + `tailscale serve`). It also lets you open the full desktop
workspace in the phone's browser (documented). The cost is a larger remote surface: the dashboard can edit config
and API keys and open a terminal. Not enabled; waiting on a yes/no.

## Server-side changes made for this release (`infra/hermes_modal.py`, BOOT)

1. **`/v1/skills` returned HTTP 500** on Hermes v0.22.5 — the API server passes `include_editorial=` to
   `find_all_skills()`, which does not accept it (same code on the Mac install). BOOT removes the kwarg **only
   while** `tools/skills_tool.py` still lacks it, so a fixed upstream is left alone. Note: it leaves the install's
   git tree dirty; if `hermes update` complains, `git -C ~/.hermes/hermes-agent checkout gateway/platforms/api_server.py`.
2. `timezone` is set from `HERMES_TIMEZONE` (default `Asia/Kolkata`) so cron times mean your clock.

## How it was tested

```bash
cd mobile
npx tsc --noEmit && npx expo lint        # types + React-compiler lint (0 problems)
npm run test:unit                        # pure logic: model names, schedules, usage maths, grouping (7 groups)
npm run mock                             # mock Hermes on :8787, key "mock-key" (offline UI development)
npx expo start --web                     # UI preview (set a focused/visible tab, or the app rightly won't stream)
npx --yes esbuild@0.25 scripts/live-features.ts --bundle --platform=node --format=esm --outfile=dist/live-features.mjs
cd ../infra && uv run --with modal==1.6.3 python hermes_modal.py apptest ../mobile/dist/live-features.mjs   # real server, ~25 s
```

`live-features.ts` covers: health, 182-model list + friendly names, skills, rename, duplicate-title error, image
understanding, per-run model override, transcript persistence, fork, routine create → read back → human text →
IST next-run → edit → pause/resume → invalid-schedule error → delete, and usage aggregation on real sessions.
