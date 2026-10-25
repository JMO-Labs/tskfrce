# Eval-kit telemetry — design

Status: awaiting owner approval (builder check done) · 2026-10-25 · branch `eval` only

## 1. Intent

The owner is handing friends and family a complete t@sk4ce home box to try out. The goal is to learn
whether **families actually use chores and locks every day without giving up**, which features
get used, and where people get stuck. Two channels:

1. **Anonymous usage stats**, sent automatically.
2. **Parent feedback**, written and sent by the parent on purpose: ideas, bugs, star rating, screenshots.

## 2. Goals, non-goals, anti-goals

**Goals**
- Daily "still using it" signal per household (works even if nobody opens the app).
- Signals of giving up: manual unlocks/overrides, rules switched off or deleted, chores left
  undone for days, quiet days with no parent visit.
- Signals of getting stuck: setup-wizard drop-off per step, time to first chore and first lock,
  forms opened then abandoned, errors shown to parents.
- In-app feedback with type, stars, text and optional screenshots.

**Non-goals**
- A tool to read feedback. The owner builds that later; this build only writes rows.
- Switching an eval box over to the release build in the field. The owner collects the boxes back.
- Opt-in telemetry for the public release. Maybe later, as a separate project.

**Anti-goals**: it fails even if it works when any of these happen.
- **Any telemetry code, config or dependency reaches the open-source release.** It lives only on
  the `eval` branch.
- **Personal data leaves the home in the usage stats.** That covers names, usernames, chat or note
  text, device names, MACs, IPs and location.
- **The family doesn't know telemetry is on.**
- **Telemetry breaks or slows the app when the internet or the owner's server is down.**

## 3. Owner decisions (binding)

| Topic | Decision |
|---|---|
| Stats backend | Self-hosted **Umami** container on the owner's **Unraid** server, exposed through a **Cloudflare Tunnel** |
| Umami database | Owner's **cloud Supabase** Postgres: direct connection on port 5432 with SSL, its own project or schema |
| Feedback storage | A table and a storage bucket in the same Supabase |
| Branch | Separate `eval` branch, cut from `feat/v3-parent-restyle`, never merged into a release branch |
| Identity | A random per-household ID; nothing that identifies a person |
| Kid events | Tagged by **age group** only; age range asked in the setup form |
| Notice | First-run notice in the **setup wizard**, plus a line in **Settings** |
| Kit | The owner pre-provisions each box completely and helps the family with wifi. The family runs the setup wizard themselves (parent login, kids) |
| End of eval | The owner collects the boxes back |
| Success | Families use chores and locks daily without giving up |

## 4. Design

### 4.1 One way out: the box

Browsers never talk to Umami or Supabase. The parent app and the kid app post events to the box
backend, and the backend forwards them. *(My call.)* Why:
- There's no third-party script in the browser.
- One place adds the household ID and app version and strips everything else.
- One place queues while offline.
- Kid devices never contact an outside host.

```
parent/kid browser --POST /api/eval/event--> box backend --queue--> Umami /api/send (via CF tunnel)
parent browser  --POST /api/eval/feedback--> box backend --queue--> Supabase REST + Storage
box lock loop / daily timer ---------------> box backend --queue--> Umami (heartbeat)
```

- **Own database file.** The outbox, daily counters and "sent once" flags live in a separate
  SQLite file, `DATA_DIR/eval.db`. That means no Alembic migrations and no change to the main
  schema. *(My call.)*
- **Queue.** The outbox in `eval.db`, with a retry worker using backoff. Drop events older than 14
  days; never drop feedback. *(My call.)*
- **Single process.** The box runs one uvicorn process (the entrypoint passes no workers flag), so
  the worker, daily timer and once-flags need no cross-process locking. *(My call.)*
- **Authenticated intake.** `/api/eval/*` requires a parent or kid session. `source` and
  `age_group` are derived from the session, never from the request body. *(My call.)*
- **Failure isolation.** Telemetry calls never raise into request handlers or the lock loop. A
  failed send only logs a warning.
- **Off switch.** If the `EVAL_*` settings are unset, everything is a silent no-op. Tests and dev
  runs therefore send nothing.

### 4.2 Provisioning (owner does this per box)

Box env file:
- `EVAL_UMAMI_URL`
- `EVAL_UMAMI_WEBSITE_ID`
- `EVAL_SUPABASE_URL`
- `EVAL_SUPABASE_ANON_KEY`

**Household ID:** a random UUID generated on first boot and stored in `DATA_DIR`.
- Families never see or type any of this.
- Wiping a box between families means deleting `DATA_DIR`, which also resets the household ID.
- The builder documents this in a short `docs/eval-kit.md` on the `eval` branch, together with
  Umami/Supabase setup: schema, RLS policies, bucket policy, CF tunnel notes. *(My call.)*

### 4.3 Event context and privacy rules

Every event carries:
- `household` (random ID)
- `app_version`
- `source`: `parent`, `kid` or `box`
- kid events only: `age_group`, one of `≤7`, `8–10`, `11–13` or `14+` *(buckets are my call)*.
  - **Where it comes from (owner).** The setup wizard's kid step asks each kid's **age range**
    with a simple picker.
  - **Storage (my call).** Stored in `eval.db` keyed by kid id, not in the main schema.
  - **Kids added later (my call).** The add-kid form on the eval branch shows the same picker.
  - **Fallback.** Kids without a range send `unknown`.

Rules, enforced in the backend forwarder, not trusted from the browser:
- **Allow-list of event names and property keys.** Unknown keys are dropped, and string
  properties are limited to enum-like values: no free text in stats.
- **Umami version.** The owner deploys the latest stable Umami, and `docs/eval-kit.md` pins that
  version. The builder checks the server-side `/api/send` payload and User-Agent rules against
  that version's docs (context7). *(My call.)*
- **No IP or location.** Umami derives country from the client IP. The forwarder sends a fixed
  dummy client IP header, and Umami is configured to read the client IP from that header
  (Umami's `CLIENT_IP_HEADER` env), so no real IP or geo is stored. Umami's distinct-ID field
  carries the household ID. The builder verifies both against the deployed Umami version.
- **Page paths.** Route patterns only, such as `/kids/[id]`, never concrete IDs or query strings.

### 4.4 Event list

**Daily heartbeat (box, once a day per household, counts for the previous local day):**

| Field | Meaning |
|---|---|
| parent_opened | Whether any parent session hit the API (0 or 1) |
| kids_opened | Kids who opened the kid app |
| chores_assigned / chores_done / chores_approved / chores_skipped | Chore counts |
| locks_by_hours | Devices locked by lock hours |
| locks_by_chores | Devices locked by unfinished chores |
| manual_unlocks / manual_locks | Parent overrides |
| chores_stale_3d | Chores still undone 3 or more days after due |
| devices_total / kids_total | Size of the setup |

The heartbeat is sent even if nobody opened the app; that's how "quiet days" show up.

How the heartbeat works *(my calls)*:
- **Day boundary.** "Day" means a local day in the family's timezone (`families.timezone`).
- **Counts are events from that day,** not a snapshot. The eval module keeps per-day counters in
  `eval.db`, bumped from hooks:
  - lock-state transitions in the lock loop
  - the override API
  - chore status changes
  - the first authenticated parent or kid request of the day
- **Missed days.** There is no backfill. If the box was off at the tick, those days simply have no
  heartbeat.
- **Off vs giving up.** A `box_boot` event on every startup, plus the gap in heartbeats, tells "box
  was off" apart from "family stopped using it".

**Live events:**

| Event | Source | Props |
|---|---|---|
| `screen_view` | parent, kid | route pattern |
| `wizard_step` | parent | step number, `started` or `done` |
| `wizard_done` | parent | — |
| `first_chore` / `first_lock` | box | minutes since `wizard_done` (sent once) |
| `override` | box | `unlock` or `lock`, `duration_bucket` |
| `rule_off` | box | kind: `hours`, `chore_lock` or `rule_deleted` |
| `form_abandoned` | parent | form name from a fixed list |
| `error_shown` | parent | error kind, such as http status or `network`; never the message text |
| `feedback_sent` | parent | type, stars (the text itself goes to Supabase only) |
| `chore_done` / `chore_note` | kid | — |
| `box_boot` | box | — |

The builder hooks these where the app already acts:
- the lock loop and override API for box events
- `WizardFrame` for wizard steps
- `toastFail` for errors
- the router for screen views

### 4.5 Feedback

- **Where.** A "Send feedback" item in the parent app: the account menu, plus Settings. *(My call.)*
  It isn't in the kid app.
- **Form.** Type (Feature idea, Bug, Other), 1–5 stars (optional), a text note (required, 2,000
  characters max), and up to 3 screenshots.
- **Screenshots.**
  - Taken with a "Capture this screen" button (client-side DOM-to-image; the builder picks a
    small library or uses an upload field if capture is impractical) or uploaded from a file.
  - Each screenshot shows a preview and a remove ✕ before send.
  - A visible line warns that screenshots may show names.
- **Attached automatically.** Current route pattern, app version, household ID and timestamp. For
  bugs, also the last 5 error kinds from this session. Nothing else.
- **Storage.**
  - Supabase table `feedback(id, household, type, stars, text, route, app_version, errors, created_at, screenshot_paths)`.
  - Storage bucket `feedback-shots`.
  - The anon key may only **insert** into both: RLS has no select/update/delete for anon.
- **Offline.** The box queues the feedback and the parent sees "Sent" (queued). It uploads when the
  box is back online.

### 4.6 Notice

- **Setup wizard.** A short step or panel before the family finishes setup, saying:
  - this is an evaluation build that sends anonymous usage counts to the person who lent the kit
  - what's sent
  - what's never sent
  - that feedback is only sent when they press Send
- **No opt-out.** The notice has no toggle; the eval kit is lent on the condition of telemetry.
  *(My call; flag if the owner wants a toggle.)*
- **Settings.** A "Usage stats (evaluation)" line showing the same text and the household ID.

## 5. Constraints

- **Branch isolation.**
  - All new code goes in new modules: backend `app/eval/`, frontend `src/v2/eval/`.
  - Existing files get one-line hooks only, so the `eval` branch stays easy to rebase onto later
    v3 work.
- **Project rules.**
  - Files under 500 lines.
  - Semantic commits.
  - CI must pass: backend ruff format/check plus pytest; frontend tsc, lint and jest.
  - Never run prettier.
- **New dependencies.** None on the backend beyond what's installed (use the existing HTTP
  client). At most one small screenshot library on the frontend.

## 6. Left to the builder

- Exact outbox schema, retry timing and worker placement (alongside the existing lock loop is fine).
- How to detect "form abandoned" (open then close without save) for the list of main forms.
- Umami payload details for server-side sends and distinct ID, checked against Umami docs
  (use context7).
- SQL for the Supabase table, RLS and bucket policies, delivered in `docs/eval-kit.md`.
