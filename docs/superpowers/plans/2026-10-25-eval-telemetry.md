# Eval-kit telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Anonymous usage stats (live events + a daily heartbeat) and parent feedback with screenshots, forwarded from the home box to the owner's Umami and Supabase, on the `eval` branch only.

**Architecture:** Browsers post to the box (`/api/v1/eval/*`); the box adds the household ID, app version, source and age group, writes to an outbox in its own SQLite file `DATA_DIR/eval.db` (stdlib `sqlite3`, no Alembic), and a background worker forwards to Umami `/api/send` and Supabase REST/Storage with retry. Box events come from one SQLAlchemy `after_flush` listener (chores, overrides, rule changes, kid notes) and a lock-loop hook (lock transitions). All new code lives in `backend/app/eval/` and `frontend/src/v2/eval/`; existing files get one-line hooks.

**Tech Stack:** FastAPI, SQLAlchemy, stdlib `sqlite3`, `httpx` (already installed), pytest; Next.js pages router, React Query, Mantine, jest. One new frontend dependency: `html-to-image@1.11.13`.

**Spec:** `docs/superpowers/specs/2026-10-25-eval-telemetry-design.md` (approved; "(My call)" items are settled).

**Repo:** `/home/user/code/tskfrce-eval`, branch `eval`. Never merge into a release branch. Don't push.

## Global Constraints

- New code only in `backend/app/eval/`, `backend/tests/eval/`, `frontend/src/v2/eval/`, `frontend/tests/v2/eval/`, `docs/eval-kit.md`. Existing files: the one-line hooks each task names (an import line plus a call line counts as one hook), nothing else.
- Off switch: stats run only when `EVAL_UMAMI_URL` and `EVAL_UMAMI_WEBSITE_ID` are both set; feedback only when `EVAL_SUPABASE_URL` and `EVAL_SUPABASE_ANON_KEY` are both set. Off = no network, no `eval.db` file created, endpoints answer success and do nothing.
- Telemetry never raises into request handlers or the lock loop. Every hook is wrapped by `hooks.safe` (catch `Exception`, log a warning, return `None`).
- Single uvicorn process: module-level state (caches, last lock reasons) is fine; no cross-process locks.
- Event context on every Umami event: `household`, `app_version`, `source` (`parent` | `kid` | `box`); kid events add `age_group` in `≤7` | `8–10` | `11–13` | `14+` | `unknown` (strings verbatim).
- `source` and `age_group` come from the session, never from the request body.
- No free text in stats. Never send names, usernames, chat/note text, device names, MACs, IPs or location.
- Outbox: Umami rows older than 14 days are dropped; feedback rows are never dropped. Backoff `min(60 * 2**attempts, 3600)` seconds.
- Files under 500 lines. Semantic commits, each ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only the files the task lists.
- Before each commit, backend tasks: `cd /home/user/code/tskfrce-eval/backend && /home/user/code/tskfrce-redesign/.venv/bin/ruff format --check . && /home/user/code/tskfrce-redesign/.venv/bin/ruff check . && /home/user/code/tskfrce-redesign/.venv/bin/python -m pytest -q`. Below, `$PY` = `/home/user/code/tskfrce-redesign/.venv/bin/python`, `$RUFF` = `/home/user/code/tskfrce-redesign/.venv/bin/ruff`. Use `$RUFF format <file>` on your own new files only.
- Before each commit, frontend tasks: `cd /home/user/code/tskfrce-eval/frontend && npx tsc --noEmit && npm run lint && npx jest`. Never run prettier.
- Parent UI uses `Icon` (Material Symbols names), `p-btn`, Mantine; no emojis in parent UI. Copy is plain, sentence case; error strings are full sentences.

## Decisions taken (owner may override)

1. Browser intake is `/api/v1/eval/*` (the Next proxy maps `/api/proxy/*` → `/api/v1/*`), not the spec's `/api/eval/*`.
2. Eval settings live in their own `EvalSettings` (pydantic-settings) in `app/eval/config.py`; `app/core/config.py` is untouched. Household ID lives in `eval.db` (`kv.household`), which is inside `DATA_DIR`.
3. Box events come from one `after_flush` listener instead of hooks in each API file: new `ChoreRun` → `chores_assigned`; status → `submitted` → `chores_done` + `chore_done` (kid = `submitted_by_id`); → `done` → `chores_approved` (+ `first_chore`); → `skipped` → `chores_skipped`; new kid `ThreadMessage` with `note_label` → `chore_note`; new manual `Override` → `override` + `manual_locks`/`manual_unlocks` (once per flush per action, not per device).
4. `rule_off` kinds: `hours` = an `allowed` time window deleted; `chore_lock` = a device switched to `guest`; `rule_deleted` = a chore deleted or archived.
5. `first_chore` = first chore approved after `wizard_done`; `first_lock` = first device locked by hours or chores (not a manual lock) after `wizard_done`. Neither is sent before `wizard_done` is recorded.
6. `locks_by_hours` / `locks_by_chores` count per-device transitions into that lock reason, seen by the lock loop. The first tick after boot only records a baseline.
7. `chores_stale_3d` (the reset cancels unfinished runs nightly, so runs never stay open for 3 days) = number of (assignment, kid) pairs with a run on each of the last 3 local days and none of those runs approved, skipped or submitted.
8. `devices_total` = devices with status `assigned`; `kids_total` = active kid users. Heartbeat for a day before the box's first boot day is never sent.
9. `screen_view` is a named Umami event with `url` = route pattern; unknown routes become `other`; the catch-all `/[...slug]` becomes `/404`.
10. Pre-login events (setup steps 1–2) are buffered in memory (max 20) and sent once a parent token exists.
11. `form_abandoned` forms: `chore` (ChoreDetail), `kid` (KidEditor), `window` (WindowEditor), `feedback`. Abandoned = dirty, then unmounted or cleaned without a save. Closing the browser tab is not tracked.
12. Feedback opens in a drawer over the current page (so "Capture this screen" captures that page); entry points: a rail button, the phone More page, and Settings → Usage stats.
13. Umami IP: forwarder sends header `X-Eval-Client-IP: 192.0.2.1` (TEST-NET, no geo) and the same value as `payload.ip`; Umami runs with `CLIENT_IP_HEADER=x-eval-client-ip` and `DISABLE_BOT_CHECK=1`. Distinct ID = `payload.id` = household.
14. Umami answers: 2xx = sent (a `{"beep":"boop"}` bot answer is logged as a warning); 4xx = drop with a warning; else retry. Supabase: object upload 409 (or 400 whose body says `Duplicate`/`already exists`) = already uploaded; row insert 409 = already inserted.
15. Screenshots are JPEG (quality 0.7, pixel ratio 1) when captured; uploads accept PNG/JPEG/WebP; max 3 per feedback, 3 MB each.

## Review Focus

1. Internet or owner server down: request handlers and the lock loop behave exactly as before; rows wait in the outbox. → Task 3 `test_flush_stops_on_network_error`, Task 5 `test_hooks_never_raise`.
2. `EVAL_*` unset (tests, dev, release-like runs): nothing is written or sent and no `eval.db` appears. → Task 4 `test_off_is_noop`.
3. A browser forges context or free text (`source`, `age_group`, a name in `route`, extra keys). → Task 4 `test_event_allow_list`.
4. Family time zone ≠ UTC: counters and the heartbeat use the family's local day. → Task 1 `test_local_day_uses_family_tz`, Task 6 `test_heartbeat_uses_family_day`.
5. Box offline for weeks with queued feedback: feedback survives, stats older than 14 days drop, a retry after a half-finished upload does not duplicate or stall. → Task 3 `test_prune_keeps_feedback`, `test_feedback_retry_after_partial_upload`.
6. Kid devices and the login page: eval calls never trigger the parent login redirect. → Task 7 `test_status_never_throws`, `test_track_swallows_auth_error`.

---

### Task 1: Eval settings and `eval.db` store

**Files:**
- Create: `backend/app/eval/__init__.py` (empty), `backend/app/eval/config.py`, `backend/app/eval/store.py`
- Create: `backend/tests/eval/__init__.py` (empty), `backend/tests/eval/conftest.py`, `backend/tests/eval/test_store.py`

**Interfaces — Produces:**
- `config.py`: `class EvalSettings(BaseSettings)` with `EVAL_UMAMI_URL: str = ""`, `EVAL_UMAMI_WEBSITE_ID: str = ""`, `EVAL_SUPABASE_URL: str = ""`, `EVAL_SUPABASE_ANON_KEY: str = ""` (`SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=True)`); `eval_settings = EvalSettings()`; `stats_on() -> bool`, `feedback_on() -> bool`, `any_on() -> bool`; `APP_VERSION = f"{app.__version__}-eval"`.
- `store.py` (all functions open a short `sqlite3.connect(db_path(), timeout=5, isolation_level=None)`; schema created with `CREATE TABLE IF NOT EXISTS` on each connect):
  - Tables: `kv(key TEXT PRIMARY KEY, value TEXT NOT NULL)`, `counters(day TEXT, name TEXT, value INTEGER NOT NULL, PRIMARY KEY(day, name))`, `seen(day TEXT, who TEXT, PRIMARY KEY(day, who))`, `kid_ages(kid_id INTEGER PRIMARY KEY, age_group TEXT NOT NULL)`, `outbox(id INTEGER PRIMARY KEY, kind TEXT NOT NULL, body TEXT NOT NULL, created_at REAL NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at REAL NOT NULL)`.
  - `db_path() -> Path` = `settings.DATA_DIR / "eval.db"` (read at call time).
  - `household() -> str` (uuid4 created on first call, stored in `kv`).
  - `kv_get(key: str) -> str | None`, `kv_set(key: str, value: str) -> None`, `once(key: str) -> bool` (True only the first time for that key).
  - `set_tz(name: str) -> None` (cached module `ZoneInfo`; bad name → UTC), `local_day(now_utc: datetime | None = None, days_back: int = 0) -> str` (ISO date in the cached zone).
  - `bump(name: str, n: int = 1, day: str | None = None) -> None`, `counters(day: str) -> dict[str, int]`.
  - `mark_seen(who: str, day: str | None = None) -> None` (in-memory `set` of `(day, who)` skips the DB after the first call), `seen_counts(day: str) -> tuple[int, int]` → `(parent_opened 0|1, kids_opened)`; `who` is `"parent"` or `f"kid:{id}"`.
  - `set_kid_age(kid_id: int, group: str) -> None`, `kid_age(kid_id: int | None) -> str` (`"unknown"` when missing or None).
  - `enqueue(kind: str, body: dict, now: float | None = None) -> None` (`kind` is `"umami"` or `"feedback"`; `next_at = created_at`).
  - `OutRow = NamedTuple(id: int, kind: str, body: dict, created_at: float, attempts: int)`; `due(now: float, limit: int = 20) -> list[OutRow]` (oldest first, `next_at <= now`); `sent(row_id: int) -> None` (delete); `failed(row_id: int, attempts: int, now: float) -> None` (sets `attempts`, `next_at = now + min(60 * 2**attempts, 3600)`); `prune(now: float) -> int` (deletes `umami` rows with `created_at < now - 14*86400`).
  - `_reset() -> None` clears the tz cache and the seen set (tests only).
- `tests/eval/conftest.py`: fixture `eval_on(monkeypatch, tmp_path)` sets `settings.DATA_DIR = tmp_path`, all four `eval_settings` fields to `http://umami.test`, a uuid, `http://supa.test`, `anon-key`, calls `store._reset()`, yields `tmp_path`.

- [ ] **Step 1:** Write `test_store.py`: `test_household_is_stable` (two calls equal, valid UUID), `test_once` (True then False), `test_bump_and_counters` (`bump("chores_done")` twice + `bump("manual_locks", day="2026-10-24")` → `counters(today)["chores_done"] == 2`, other day separate), `test_seen_counts` (`mark_seen("parent")` ×2, `mark_seen("kid:3")`, `mark_seen("kid:4")` → `(1, 2)`), `test_kid_age_default` (`kid_age(9) == "unknown"`, `kid_age(None) == "unknown"`; after `set_kid_age(9, "8–10")` → `"8–10"`), `test_local_day_uses_family_tz` (`set_tz("America/New_York")`; `local_day(datetime(2026,10,25,3,30,tzinfo=UTC)) == "2026-10-24"`; `days_back=1` → `"2026-10-23"`; `set_tz("Not/AZone")` → UTC date `"2026-10-25"`), `test_outbox_backoff` (enqueue at t=1000; `due(1000)` has 1 row; `failed(id, 1, 1000)` → `due(1100) == []`, `due(1121)` has it; `sent(id)` → empty), `test_prune_age` (umami row at t=0 and feedback row at t=0; `prune(15*86400) == 1`; feedback row still due).
- [ ] **Step 2:** Run `cd backend && $PY -m pytest tests/eval/test_store.py -q` → FAIL (module missing).
- [ ] **Step 3:** Implement `config.py` and `store.py` per Interfaces.
- [ ] **Step 4:** Run the same command → PASS. Run the backend CI line → PASS.
- [ ] **Step 5:** Commit `feat(eval): eval settings and eval.db store`.

### Task 2: Event allow-list and Umami payload

**Files:**
- Create: `backend/app/eval/events.py`
- Test: `backend/tests/eval/test_events.py`

**Interfaces — Consumes:** Task 1 `store`, `config`.
**Produces:**
- `AGE_GROUPS = ("≤7", "8–10", "11–13", "14+")`.
- `ROUTES = frozenset({"/", "/chat", "/devices", "/kid", "/kids", "/more", "/settings", "/setup", "/login", "/join", "/register", "/reset", "/404"})`.
- `FORMS = ("chore", "kid", "window", "feedback")`.
- `clean(name: str, props: dict) -> dict | None` — browser events only; `None` = drop the event; output has only the keys below:
  - `screen_view`: `{"route": r if r in ROUTES else "other"}`.
  - `wizard_step`: `step` int 1–7 (accept `int` or digit string) and `state` in `started|done`, else `None`.
  - `wizard_done`: `{}`.
  - `form_abandoned`: `form` in `FORMS`, else `None`.
  - `error_shown`: `kind` matching `^(http_[1-5]\d\d|network|other)$`, else `"other"`.
  - any other name (including box-only names such as `heartbeat`, `first_lock`) → `None`.
- `duration_bucket(minutes: int | None) -> str`: `None` → `"until_cleared"`, ≤30 → `"30m"`, ≤120 → `"2h"`, ≤480 → `"8h"`, else `"24h"`.
- `umami_body(name: str, data: dict, *, source: str, age_group: str | None, url: str, ts: float) -> dict` →
  `{"type": "event", "payload": {"website": <EVAL_UMAMI_WEBSITE_ID>, "hostname": "box", "url": url, "name": name, "id": household(), "ip": "192.0.2.1", "timestamp": int(ts), "data": {**data, "household": household(), "app_version": APP_VERSION, "source": source, ["age_group": age_group when not None]}}}`.
- `emit(name: str, data: dict | None = None, *, source: str = "box", age_group: str | None = None, url: str = "/box") -> None` — no-op unless `stats_on()`; enqueues `("umami", umami_body(...))` with `ts = time.time()`; never raises (wrap the body in `try/except Exception` + `logger.warning`).

- [ ] **Step 1:** Write `test_events.py`: `test_clean_drops_unknown_keys` (`clean("screen_view", {"route": "/kids", "name": "Mia"}) == {"route": "/kids"}`), `test_clean_route_free_text` (`{"route": "/kids/12?x=1"}` → `{"route": "other"}`), `test_clean_wizard` (`{"step": "3", "state": "done"}` → `{"step": 3, "state": "done"}`; `step 9` → None; `state "x"` → None), `test_clean_error_kind` (`"http_404"` kept; `"Kid Mia not found"` → `"other"`), `test_clean_rejects_box_names` (`clean("heartbeat", {}) is None`, `clean("first_lock", {}) is None`, `clean("bogus", {}) is None`), `test_duration_bucket` (None, 15, 60, 300, 1440 → the five buckets), `test_emit_payload(eval_on)` (`emit("chore_done", {}, source="kid", age_group="8–10")` → one `umami` outbox row whose payload has `website`, `id == household()`, `ip == "192.0.2.1"`, `data.source == "kid"`, `data.age_group == "8–10"`, `data.app_version` ends with `-eval`), `test_emit_off_is_silent` (no `eval_on`; `emit("box_boot")` creates no `eval.db` under `settings.DATA_DIR` — point `DATA_DIR` at `tmp_path` with monkeypatch).
- [ ] **Step 2:** Run `$PY -m pytest tests/eval/test_events.py -q` → FAIL.
- [ ] **Step 3:** Implement `events.py`.
- [ ] **Step 4:** Run → PASS; backend CI line → PASS.
- [ ] **Step 5:** Commit `feat(eval): event allow-list and Umami payload`.

### Task 3: Sender and outbox flush

**Files:**
- Create: `backend/app/eval/sender.py`
- Test: `backend/tests/eval/test_sender.py`

**Interfaces — Consumes:** Task 1 `store`, `config`.
**Produces:**
- Constants: `UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36 task4ce-eval"`, `DUMMY_IP = "192.0.2.1"`, `IP_HEADER = "X-Eval-Client-IP"`, `BUCKET = "feedback-shots"`, `SHOTS_DIR = "eval-shots"` (under `settings.DATA_DIR`).
- `send_umami(body: dict) -> str` returns `"ok" | "drop" | "retry"`: `httpx.post(f"{EVAL_UMAMI_URL.rstrip('/')}/api/send", json=body, headers={"User-Agent": UA, IP_HEADER: DUMMY_IP, "x-umami-website-id": <id>}, timeout=10)`. 2xx → `"ok"` (log a warning if the JSON has `"beep"`); 4xx → `"drop"` + warning; other status or exception → `"retry"`.
- `send_feedback(body: dict) -> str` returns `"ok" | "retry"` (never `"drop"`). Body shape (written by Task 4): `{"id", "household", "type", "stars", "text", "route", "app_version", "errors": list[str], "created_at": ISO str, "shots": list[str]}` where `shots` are file names inside `DATA_DIR/eval-shots/`.
  1. For each shot `i, name`: object path `f"{household}/{id}-{i}.{ext}"`; if the local file is missing, treat it as uploaded. Else `httpx.post(f"{SUPA}/storage/v1/object/{BUCKET}/{path}", content=bytes, headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": mime}, timeout=30)`. Uploaded = 2xx, or 409, or 400 whose text contains `Duplicate` or `already exists`. Anything else → `"retry"`.
  2. `httpx.post(f"{SUPA}/rest/v1/feedback", json=row, headers={"apikey", "Authorization", "Content-Type": "application/json", "Prefer": "return=minimal"}, timeout=10)` where `row` = body minus `shots`, plus `screenshot_paths` = the object paths. 201/2xx or 409 → delete the local shot files, `"ok"`; else `"retry"`.
- `flush(now: float | None = None) -> int`: `store.prune(now)`; for each `store.due(now)`: dispatch by kind (`umami` rows only when `stats_on()`, `feedback` rows only when `feedback_on()`, else skip the row untouched); `ok`/`drop` → `store.sent`; `retry` → `store.failed(id, attempts + 1, now)` and **stop the pass** (box is probably offline). Returns rows sent.

- [ ] **Step 1:** Write `test_sender.py` with a fake `httpx.post` (monkeypatch `app.eval.sender.httpx.post` with a function that records `(url, kwargs)` and returns `httpx.Response(status, json=..., request=httpx.Request("POST", url))` from a queue): `test_umami_headers(eval_on)` (one flush → URL `http://umami.test/api/send`, headers carry `UA` and `X-Eval-Client-IP: 192.0.2.1`, row gone), `test_umami_4xx_drops`, `test_umami_bot_answer_counts_as_sent` (`{"beep": "boop"}`), `test_flush_stops_on_network_error` (3 rows; fake raises `httpx.ConnectError` → after flush 3 rows remain, first has `attempts == 1`, fake called once), `test_prune_keeps_feedback` (umami row and feedback row created 15 days ago; flush with fake always 500 → umami row gone, feedback row still present), `test_feedback_upload_then_row` (feedback with one shot file `abc.jpg` in `eval-shots/` → first call to `/storage/v1/object/feedback-shots/<household>/<id>-0.jpg` with `Content-Type: image/jpeg`, second to `/rest/v1/feedback` with `Prefer: return=minimal` and JSON `screenshot_paths == ["<household>/<id>-0.jpg"]`, no `shots` key; local file deleted), `test_feedback_retry_after_partial_upload` (first flush: upload 200, row 500 → row kept, file kept; second flush: upload 400 `{"error":"Duplicate"}`, row 201 → done).
- [ ] **Step 2:** Run `$PY -m pytest tests/eval/test_sender.py -q` → FAIL.
- [ ] **Step 3:** Implement `sender.py`. MIME by extension: `png` → `image/png`, `jpg` → `image/jpeg`, `webp` → `image/webp`.
- [ ] **Step 4:** Run → PASS; backend CI line → PASS.
- [ ] **Step 5:** Commit `feat(eval): forward outbox to Umami and Supabase with retry`.

### Task 4: Intake API

**Files:**
- Create: `backend/app/eval/api.py`, `backend/app/eval/hooks.py` (only `safe` and `seen` in this task)
- Modify: `backend/app/main.py` (import + `fastapi_app.include_router(eval_router)` next to the other `include_router` lines), `backend/app/api/deps.py` (in `get_current_user_from_token`, call `eval_hooks.seen(user)` just before `return user`)
- Test: `backend/tests/eval/test_api.py`

**Interfaces — Consumes:** Tasks 1–2.
**Produces:**
- `hooks.safe(fn)` decorator (catch `Exception`, `logger.warning("Eval hook failed", hook=fn.__name__, error=str(exc))`, return `None`). `hooks.seen(user) -> None` (safe; no-op unless `stats_on()`; `store.mark_seen("parent" if user.role == UserRole.PARENT else f"kid:{user.id}")`). `hooks.py` imports nothing from `app.api` or `app.models` at module level (import inside functions) to avoid import cycles with `deps.py`.
- Router `APIRouter(prefix="/api/v1/eval", tags=["eval"])`:
  - `GET /status` (any active user) → `{"stats": stats_on(), "feedback": feedback_on(), "household": household() if any_on() else None}`.
  - `POST /event` (any active user) body `EventIn{name: str (1–40), props: dict[str, str | int] = {}}` → 204 always. When `stats_on()` and `clean()` is not None: `source = "parent"|"kid"` from `user.role`; `age_group = store.kid_age(user.id)` for kids else None; `emit(name, cleaned, source=..., age_group=..., url=cleaned.get("route", "/app"))`. For `wizard_done` also `store.kv_set("wizard_done_at", str(time.time()))` if `kv_get` is None.
  - `PUT /kids/{kid_id}/age` (parent) body `{age_group: Literal["≤7","8–10","11–13","14+"]}` → 204; kid must exist with role KID else 404 "That kid doesn't exist."; `set_kid_age` only when `stats_on()`.
  - `POST /feedback` (parent), multipart: `type` (`feature|bug|other`, else 422 "Pick Feature idea, Bug or Other."), `stars` optional int (1–5, else 422 "Stars go from 1 to 5."), `text` (stripped, 1–2000; empty → 422 "Write a short note first."; longer → 422 "Keep the note under 2,000 characters."), `route` (→ `"other"` unless in `ROUTES`), `errors` optional comma list (each kept only if it matches the `error_shown` pattern; max 5; only stored when `type == "bug"`), `shots: list[UploadFile] = []` (>3 → 422 "Send up to 3 screenshots."; content type not PNG/JPEG/WebP → 422 "Screenshots must be PNG, JPEG or WebP images."; >3 MB → 422 "Each screenshot must be under 3 MB."). When `feedback_on()`: `id = uuid4()`, save shots as `DATA_DIR/eval-shots/{id}-{i}.{ext}`, `enqueue("feedback", body)` (shape in Task 3), and `emit("feedback_sent", {"type": t, "stars": s or 0}, source="parent", url=route)`. Store failure → 503 "Couldn't save your feedback. Try again.". Returns `{"ok": true}`.

- [ ] **Step 1:** Write `test_api.py` (use `client`, `parent_headers`, `kid_headers`, `kid` from the main conftest): `test_off_is_noop` (no `eval_on`, `DATA_DIR` → `tmp_path`: `/status` → stats False, household None; POST `/event` → 204; POST `/feedback` → 200; no `eval.db` in `tmp_path`), `test_event_allow_list(eval_on)` (kid posts `screen_view` with `props={"route": "/kid", "source": "parent", "age_group": "14+", "name": "Mia"}` after parent PUTs that kid's age `"8–10"` → outbox payload `data == {route:"/kid", household, app_version, source:"kid", age_group:"8–10"}`), `test_unknown_event_dropped(eval_on)` (`heartbeat` from browser → 204, outbox empty), `test_wizard_done_records_time(eval_on)`, `test_kid_cannot_set_age` (403), `test_age_unknown_kid(eval_on)` (404), `test_feedback_queues(eval_on)` (bug with stars 4, text, route `/kids`, `errors="http_500,Mia broke"`, one JPEG → feedback row body `errors == ["http_500"]`, `shots` length 1 and the file exists; a `feedback_sent` umami row with `data.type == "bug"`), `test_feedback_rules(eval_on)` (empty text, 2001 chars, 4 shots, a `text/plain` shot, `stars=6` → 422 with the copy above), `test_seen_counts_requests(eval_on)` (parent GET `/api/v1/eval/status` twice and kid once → `seen_counts(local_day()) == (1, 1)`).
- [ ] **Step 2:** Run `$PY -m pytest tests/eval/test_api.py -q` → FAIL.
- [ ] **Step 3:** Implement `api.py`, `hooks.safe`/`hooks.seen`, the two hook lines.
- [ ] **Step 4:** Run → PASS; backend CI line (full suite) → PASS.
- [ ] **Step 5:** Commit `feat(eval): event, kid age and feedback intake`.

### Task 5: Box events — flush listener and lock transitions

**Files:**
- Create: `backend/app/eval/listeners.py`, `backend/app/eval/locks.py`
- Modify: `backend/app/eval/hooks.py` (add `after_tick`), `backend/app/lock/loop.py` (in `_run_once`, call `eval_hooks.after_tick(db)` on the line after `push_blocked(...)`)
- Test: `backend/tests/eval/test_listeners.py`, `backend/tests/eval/test_locks.py`

**Interfaces — Consumes:** Tasks 1–2; `app.lock.state.device_facts`, `Prefetch`; `app.lock.rules.DeviceFacts`; `app.lock.schedule.local_now`, `in_window`.
**Produces:**
- `listeners.register() -> None`: `event.listen(Session, "after_flush", on_flush)` once (check `event.contains`). `on_flush(session, ctx)` is `hooks.safe`-wrapped and returns at once unless `stats_on()`. It reads `session.new`, `session.dirty`, `session.deleted` and attribute history (`sqlalchemy.inspect(obj).attrs.<col>.history`) and does Decision 3 and 4:
  - `ChoreRun` in `new` → `bump("chores_assigned")`.
  - `ChoreRun.status` history new value: `submitted` → `bump("chores_done")` + `emit("chore_done", {}, source="kid", age_group=kid_age(run.submitted_by_id), url="/kid")`; `done` → `bump("chores_approved")` + `first_event("first_chore")`; `skipped` → `bump("chores_skipped")`.
  - `ThreadMessage` in `new` with `note_label` and an `author_id` → `emit("chore_note", {}, source="kid", age_group=kid_age(author_id), url="/kid")`.
  - `Override` in `new` with `source == "manual"`: group by `(action, minutes)` where `minutes = round((expires_at - created_at) / 60s)` or None; per group `bump("manual_locks" | "manual_unlocks")` and `emit("override", {"action": action, "duration_bucket": duration_bucket(minutes)})`.
  - `TimeWindow` in `deleted` with `kind == "allowed"` → `emit("rule_off", {"kind": "hours"})`; `Device.status` history new value `guest` → `{"kind": "chore_lock"}`; `Chore` in `deleted`, or `Chore.archived_at` history None → value → `{"kind": "rule_deleted"}`.
  - `first_event(key: str) -> None`: when `kv_get("wizard_done_at")` is set and `once(key)` is True → `emit(key, {"minutes": round((time.time() - wizard_done_at) / 60)})`.
- `locks.reason(f: DeviceFacts, now_local: datetime) -> str | None` → `"override"` | `"new_device"` | `"hours"` | `"chores"` | `None`, mirroring `rules.is_online` branch by branch: manual lock → `override`; guest → None; unassigned → None if online else `new_device`; outside allowed windows → `hours`; chores not done and no free window / unlock / bonus → `chores`; else None. Invariant: `reason(f, t) is None == is_online(f, t)`.
- `locks.track(db, now_utc: datetime) -> None`: compute `reason` for every device (one `Prefetch(db, devices)`), compare with module `_last: dict[int, str | None] | None`; first call only stores the baseline. A device whose reason changes to `hours` → `bump("locks_by_hours")`, to `chores` → `bump("locks_by_chores")`; either → `listeners.first_event("first_lock")`.
- `hooks.after_tick(db) -> None` (safe; no-op unless `stats_on()`): `fam = get_family(db)`; `store.set_tz(fam.timezone)`; `locks.track(db, datetime.now(UTC))`.

- [ ] **Step 1:** Write `test_locks.py`: `test_reason_matches_is_online` (build ≥8 `DeviceFacts` covering each branch — manual lock, guest, unassigned blocked/unblocked, outside window, chores open, chores open in free window, unlock override, all done — assert the reason per case and the invariant), `test_track_counts_transitions(eval_on, db)` (one kid device; first `track` baseline with chores open = no bump; approve chores → `track`; reopen → `track` → `locks_by_chores == 1`; `first_lock` sent only when `wizard_done_at` set), `test_hooks_never_raise(db, monkeypatch, eval_on)` (monkeypatch `store.bump` to raise → `hooks.after_tick(db)` returns None and `loop._run_once()` with a patched `SessionLocal`/`push_blocked` completes).
- [ ] **Step 2:** Write `test_listeners.py` (call `listeners.register()` in a fixture; use factories/conftest helpers to create chores, runs, devices, windows): `test_run_counters` (new run → assigned 1; kid `done` endpoint → chores_done 1 and a `chore_done` row with the kid's age group; approve → chores_approved 1; skip another → skipped 1), `test_first_chore_once` (with `wizard_done_at` set, approve two runs → exactly one `first_chore` row with integer `minutes`), `test_override_once_per_action` (kid with 3 devices, POST `/api/v1/kids/{id}/override` `{"action":"unlock","minutes":60}` → `manual_unlocks == 1`, one `override` row `duration_bucket == "2h"`), `test_rule_off_kinds` (delete an allowed window → `hours`; deleting a free window → nothing; set device status guest → `chore_lock`; delete a chore with history → `rule_deleted`), `test_chore_note_event` (kid note on a run → `chore_note` row, payload contains no note text), `test_listener_off` (no `eval_on` → none of the above writes `eval.db`).
- [ ] **Step 3:** Run `$PY -m pytest tests/eval/test_locks.py tests/eval/test_listeners.py -q` → FAIL.
- [ ] **Step 4:** Implement `locks.py`, `listeners.py`, `hooks.after_tick`, the loop hook line.
- [ ] **Step 5:** Run → PASS; backend CI line (full suite, including `tests/lock`) → PASS.
- [ ] **Step 6:** Commit `feat(eval): box events from chores, overrides, rules and lock loop`.

### Task 6: Heartbeat, worker and startup

**Files:**
- Create: `backend/app/eval/heartbeat.py`, `backend/app/eval/worker.py`
- Modify: `backend/app/eval/hooks.py` (add `start`, `stop`), `backend/app/main.py` (`eval_hooks.start(fastapi_app)` at the end of `startup_event`, `eval_hooks.stop(fastapi_app)` at the start of `shutdown_event`), `docker-compose.prod.yml` (backend `environment:` gets `EVAL_UMAMI_URL: ${EVAL_UMAMI_URL:-}`, same for `EVAL_UMAMI_WEBSITE_ID`, `EVAL_SUPABASE_URL`, `EVAL_SUPABASE_ANON_KEY`)
- Test: `backend/tests/eval/test_heartbeat.py`

**Interfaces — Consumes:** Tasks 1–5.
**Produces:**
- `heartbeat.KEYS = ("parent_opened", "kids_opened", "chores_assigned", "chores_done", "chores_approved", "chores_skipped", "locks_by_hours", "locks_by_chores", "manual_unlocks", "manual_locks", "chores_stale_3d", "devices_total", "kids_total")`.
- `heartbeat.stale_3d(db, day: date) -> int` (Decision 7: group `ChoreRun` rows with `day` in `[day-2, day]` by `(assignment_id, kid_id)`; count groups with 3 distinct days where every run has `status not in ("done", "skipped")` and `submitted_at IS NULL`).
- `heartbeat.build(db, day: date) -> dict[str, int]`: every key in `KEYS` (0 default) from `store.counters(day.isoformat())`, `store.seen_counts(...)`, `stale_3d`, `Device.status == "assigned"` count, active `UserRole.KID` count.
- `heartbeat.maybe_send(db, now_utc: datetime) -> bool`: `today = local_day(now_utc)`; set `kv first_day = today` if missing; `yday = local_day(now_utc, 1)`; skip if `yday < first_day` or `kv heartbeat_day == yday`; else `emit("heartbeat", build(db, date.fromisoformat(yday)) | {"day": yday})`, `kv_set("heartbeat_day", yday)`, True.
- `worker.cycle() -> None` (sync), two independent `try/except Exception` → warning blocks: (1) `SessionLocal()`; `store.set_tz(get_family(db).timezone)`; if `stats_on()`: `heartbeat.maybe_send(db, datetime.now(UTC))`; close; (2) `sender.flush()` — so a main-DB problem never blocks the outbox.
- `async worker.run_forever(interval: int = 30) -> None`: loop `await asyncio.to_thread(cycle)` then `await asyncio.sleep(interval)`.
- `hooks.start(app) -> None` (safe): no-op unless `any_on()`; `listeners.register()`; if `stats_on()`: `emit("box_boot")`; `app.state.eval_task = asyncio.create_task(worker.run_forever())`. `hooks.stop(app) -> None` (safe): cancel `app.state.eval_task` if present.

- [ ] **Step 1:** Write `test_heartbeat.py`: `test_build_has_every_key(eval_on, db)` (empty DB → all 13 keys, all 0), `test_heartbeat_uses_family_day(eval_on, db)` (family tz `America/New_York`; `set_tz`; `bump("chores_done", day="2026-10-24")`; `kv_set("first_day", "2026-10-20")`; `maybe_send(db, datetime(2026,10,25,5,0,tzinfo=UTC))` → True and the heartbeat payload has `data.day == "2026-10-24"`, `data.chores_done == 1`; a second call → False), `test_no_heartbeat_before_first_boot(eval_on, db)` (fresh store → `maybe_send` False, `first_day` set to today), `test_stale_3d(db)` (run todo/cancelled on 3 consecutive days for one kid → 1; same but one day `submitted_at` set → 0; only 2 days → 0), `test_start_off_is_noop` (no `eval_on`: `hooks.start(fake_app)` sets no `eval_task`), `test_box_boot_on_start(eval_on)` (inside an `asyncio.run` wrapper with `worker.run_forever` monkeypatched to a no-op coroutine → one `box_boot` row).
- [ ] **Step 2:** Run `$PY -m pytest tests/eval/test_heartbeat.py -q` → FAIL.
- [ ] **Step 3:** Implement `heartbeat.py`, `worker.py`, `hooks.start/stop`, the two `main.py` lines and the four compose lines.
- [ ] **Step 4:** Run → PASS; backend CI line (full suite) → PASS.
- [ ] **Step 5:** Commit `feat(eval): daily heartbeat and outbox worker`.

### Task 7: Frontend tracking core

**Files:**
- Create: `frontend/src/v2/eval/track.ts`, `frontend/src/v2/eval/errors.ts`, `frontend/src/v2/eval/useEvalStatus.ts`, `frontend/src/v2/eval/useScreenViews.ts`, `frontend/src/v2/eval/useWizardTelemetry.ts`, `frontend/src/v2/eval/useFormAbandon.ts`, `frontend/src/v2/eval/feedbackStore.ts`, `frontend/src/v2/eval/EvalRoot.tsx` (screen views only in this task; Task 9 adds the drawer)
- Modify (one hook each): `frontend/pages/_app.tsx` (`<EvalRoot />` just inside `<UnifiedAuthProvider>`), `frontend/src/v2/setup/WizardFrame.tsx` (`useWizardTelemetry(step, STEPS.length)` after `useLook`), `frontend/src/v2/notify.tsx` (`toastFail` calls `noteError(e)` before `notifications.show`), `frontend/src/v2/manage/ChoreDetail.tsx` (`const saved = useFormAbandon('chore', dirty)`; call `saved()` first in both save `onSuccess` callbacks), `frontend/src/v2/manage/KidEditor.tsx` (`useFormAbandon('kid', name.trim() !== (kid?.full_name ?? '') || avatar !== (kid?.avatar ?? '') || pin !== '')`; `saved()` first in `onSuccess`), `frontend/src/v2/manage/WindowEditor.tsx` (`useFormAbandon('window', adding !== null)`; `saved()` in the create `onSuccess` before `setAdding(null)`)
- Test: `frontend/tests/v2/eval/track.test.ts`, `frontend/tests/v2/eval/hooks.test.tsx`

**Interfaces — Produces:**
- `track.ts`: `type EvalEvent = 'screen_view' | 'wizard_step' | 'wizard_done' | 'form_abandoned' | 'error_shown'`; `track(name: EvalEvent, props: Record<string, string | number> = {}, opts: { kid?: boolean } = {}): void` → `api('/eval/event', { method: 'POST', body: { name, props }, kid: opts.kid })`, fire and forget, every error swallowed (never calls `toastFail`). Token check first: parent = `tokenManager.getAccessToken()`, kid = `localStorage[KID_TOKEN_KEY]` (in try/catch). No parent token → push to an in-memory buffer (max 20, drop oldest); kid without token → drop. When a parent token exists, send the buffer first. `_resetTrack()` for tests.
- `errors.ts`: `errorKind(e: unknown): string` (`ApiError` → `` `http_${status}` ``; `TypeError` → `'network'`; else `'other'`); `noteError(e: unknown): void` (keeps the last 5 kinds, then `track('error_shown', { kind })`); `recentErrors(): string[]`.
- `useEvalStatus.ts`: `interface EvalStatus { stats: boolean; feedback: boolean; household: string | null }`; `useEvalStatus()` = `useQuery({ queryKey: ['eval-status'], queryFn: () => api<EvalStatus>('/eval/status').catch(() => OFF), staleTime: Infinity, retry: false })` with `OFF = { stats: false, feedback: false, household: null }` — the query never rejects, so the global `onAuthError` redirect never fires.
- `useScreenViews.ts`: `routePattern(pathname: string): string` (`'/[...slug]'` → `'/404'`, else `pathname`); `useScreenViews(): void` tracks `screen_view {route}` on mount and on `router.events` `routeChangeComplete`, with `{ kid: pattern === '/kid' }`.
- `useWizardTelemetry(step: number, last: number): void`: keeps the highest step seen in a ref. When `step` passes it: `wizard_step {step: prev, state: 'done'}` for the previous max, then `wizard_step {step, state: 'started'}` if `step <= last`, or `wizard_done` (once) if `step > last`. On mount: `started` for the initial step. Going back sends nothing.
- `useFormAbandon(form: 'chore' | 'kid' | 'window' | 'feedback', dirty: boolean): () => void` — returns `saved()`. Sends `form_abandoned {form}` when dirty goes true → false without `saved()` since it became dirty, or on unmount while dirty and not saved.
- `feedbackStore.ts`: `openFeedback(): void`, `closeFeedback(): void`, `useFeedbackOpen(): boolean` (module state + `useSyncExternalStore`).
- `EvalRoot()`: calls `useScreenViews()`; renders `null` for now.

- [ ] **Step 1:** Write `track.test.ts` (`jest.mock('@/v2/api')` keeping real `ApiError`/`AuthError`; mock `tokenManager`): `test buffers before login then flushes in order` (no token: track A, B; token: track C → `api` called with A, B, C), `test buffer caps at 20`, `test kid without token drops`, `test_track_swallows_auth_error` (api rejects `AuthError` → no throw, no unhandled rejection), `errorKind` cases (`new ApiError(404,'x')` → `http_404`, `new TypeError()` → `network`, `'boom'` → `other`), `recentErrors` keeps last 5.
- [ ] **Step 2:** Write `hooks.test.tsx`: `useWizardTelemetry` via `renderHook` (last = 7) with steps 1→2→3→2→3→4 → `track` calls exactly `[['wizard_step',{step:1,state:'started'}], ['wizard_step',{step:1,state:'done'}], ['wizard_step',{step:2,state:'started'}], ['wizard_step',{step:2,state:'done'}], ['wizard_step',{step:3,state:'started'}], ['wizard_step',{step:3,state:'done'}], ['wizard_step',{step:4,state:'started'}]]`; a second hook starting at 7 then 8 → `[['wizard_step',{step:7,state:'started'}], ['wizard_step',{step:7,state:'done'}], ['wizard_done', {}]]`; `useFormAbandon` five cases (dirty then unmount → 1 call; dirty, saved, unmount → 0; dirty true→false unsaved → 1; dirty, saved, false → 0; never dirty → 0); `routePattern('/[...slug]') === '/404'`; `test_status_never_throws` (api rejects `AuthError` → hook data equals OFF, `onAuthError` spy not called — wrap with `makeQueryClient()`).
- [ ] **Step 3:** Run `npx jest tests/v2/eval` → FAIL.
- [ ] **Step 4:** Implement the files and the hook lines.
- [ ] **Step 5:** Run → PASS; frontend CI line → PASS (existing `WizardFrame`, `choreDetail`, `manage`, `notify` tests still pass; add `jest.mock('@/v2/eval/track')` in any existing test file that now fails only because of an unexpected `api` call, and list those files in the commit).
- [ ] **Step 6:** Commit `feat(eval): frontend event tracking, wizard steps, errors and abandoned forms`.

### Task 8: Age range picker and telemetry notice

**Files:**
- Create: `frontend/src/v2/eval/AgePicker.tsx`, `frontend/src/v2/eval/EvalNotice.tsx`, `frontend/src/v2/eval/EvalSettings.tsx`
- Modify: `frontend/src/v2/setup/StepKids.tsx` (`const age = useAgePicker()`; render `{age.picker}` after the PIN input; `age.save(k.id)` in `onSuccess`), `frontend/src/v2/manage/KidEditor.tsx` (same three lines; picker only when `!kid`; `save` with the new id in `onSuccess`), `frontend/pages/setup.tsx` (`{step > LAST && <EvalNotice />}` after `StepFinish`), `frontend/src/v2/manage/SettingsPage.tsx` (add `'eval'` to `S`, list entry `{ id: 'eval', label: 'Usage stats (evaluation)', description: 'What this kit sends', icon: 'query_stats' }`, render `{section === 'eval' && <EvalSettings />}`), `frontend/src/v2/parent/MorePage.tsx` (entry `{ href: '/settings?section=eval', label: 'Usage stats (evaluation)', sub: 'What this kit sends', icon: 'query_stats' }`)
- Test: `frontend/tests/v2/eval/notice.test.tsx`

**Interfaces — Consumes:** Task 7 `useEvalStatus`. Task 9 adds the feedback button to `EvalSettings`.
**Produces:**
- `AGE_OPTIONS = [{ value: '≤7', label: '7 or under' }, { value: '8–10', label: '8–10' }, { value: '11–13', label: '11–13' }, { value: '14+', label: '14 or older' }]`.
- `useAgePicker(): { picker: ReactNode; save: (kidId: number) => void }` — picker is a Mantine `SegmentedControl`-style radio group labelled "Age range (for anonymous stats)", optional, no default; `picker` is `null` and `save` a no-op unless `status.stats`. `save` does `api('/eval/kids/{id}/age', { method: 'PUT', body: { age_group } })` when a value is picked, errors swallowed; then clears the pick.
- `NOTICE` copy (exact):
  - Title: "This is an evaluation kit"
  - "This t@sk4ce box is a test version, lent to you by the person who set it up. It sends them anonymous usage counts so they can make it better."
  - "What's sent: which screens are opened, setup steps finished, daily counts of chores and locks, error types, and each kid's age range."
  - "Never sent: names, usernames, chat or note text, device names, network addresses or your location."
  - "Feedback is only sent when you press Send."
- `EvalNotice()`: renders `NOTICE` as an info card (`Icon name="query_stats"`) only when `status.stats`.
- `EvalSettings()`: when stats off → "Usage stats are off on this box."; else `<EvalNotice />` plus "Household ID: {household}" in monospace.

- [ ] **Step 1:** Write `notice.test.tsx` (mock `useEvalStatus`, mock `@/v2/api`): notice hidden when `stats: false`; shows the five lines when on; `EvalSettings` shows "Household ID: abc"; `useAgePicker` inside a test component: pick "8–10", call `save(7)` → `api('/eval/kids/7/age', {method: 'PUT', body: {age_group: '8–10'}})`; with no pick → no call; stats off → picker not rendered.
- [ ] **Step 2:** Run `npx jest tests/v2/eval/notice` → FAIL.
- [ ] **Step 3:** Implement and add the hook lines.
- [ ] **Step 4:** Run → PASS; frontend CI line → PASS (`setup.test.tsx`, `settings.test.tsx`, `SettingsList.test.tsx`, `manage.test.tsx` included; mock `@/v2/eval/useEvalStatus` there only if they break on the new query).
- [ ] **Step 5:** Commit `feat(eval): kid age range picker and evaluation notice`.

### Task 9: Feedback drawer with screenshots

**Files:**
- Create: `frontend/src/v2/eval/FeedbackDrawer.tsx`, `frontend/src/v2/eval/FeedbackShots.tsx`, `frontend/src/v2/eval/FeedbackEntry.tsx`
- Modify: `frontend/package.json` + `package-lock.json` (`npm install --save-exact html-to-image@1.11.13`), `frontend/src/v2/eval/EvalRoot.tsx` (render `<FeedbackDrawer />`), `frontend/src/v2/eval/EvalSettings.tsx` (a "Send feedback" `p-btn` calling `openFeedback()` when `status.feedback`), `frontend/src/v2/parent/Rail.tsx` (`<FeedbackRailButton />` as the last child of `<nav>`), `frontend/src/v2/parent/MorePage.tsx` (`<FeedbackMoreLink />` after the Settings list)
- Test: `frontend/tests/v2/eval/feedback.test.tsx`

**Interfaces — Consumes:** Task 7 `feedbackStore`, `useFormAbandon`, `recentErrors`, `routePattern`, `useEvalStatus`; Task 4 `POST /eval/feedback`.
**Produces:**
- `FeedbackShots.tsx`: `type Shot = { blob: Blob; url: string }`; `captureScreen(): Promise<Blob>` = `toJpeg(document.body, { quality: 0.7, pixelRatio: 1 })` → `fetch(dataUrl).then(r => r.blob())`; `FeedbackShots({ shots, onChange, onCapture })` renders "Capture this screen" (`photo_camera`) and "Add a picture" (`add_photo_alternate`, hidden `<input type="file" accept="image/png,image/jpeg,image/webp">`), both disabled at 3 shots; thumbnails with a remove button (`Icon name="close"`, aria-label "Remove screenshot N"); warning line "Screenshots may show names. Remove any you don't want to send."; a file over 3 MB shows "That picture is too big. Pick one under 3 MB."; capture failure shows "Couldn't capture the screen. Add a picture instead.". Revoke object URLs on remove/unmount.
- `FeedbackDrawer()`: Mantine `Drawer` (right) titled "Send feedback", open = `useFeedbackOpen()`. Fields: `SegmentedControl` Feature idea / Bug / Other (`feature|bug|other`, default `feature`); Mantine `Rating` labelled "How's it going? (optional)"; `Textarea` "What's on your mind?" (required, `maxLength={2000}`, counter "N / 2,000"); `FeedbackShots`. The route is `routePattern(router.pathname)` captured when the drawer opens. Capture: close the drawer, wait 400 ms, `captureScreen()`, reopen. Send: empty text → inline "Write a short note first."; else `FormData` (`type`, `stars` if set, `text`, `route`, `errors` = `recentErrors().join(',')` for bugs, each shot as `shots` named `shot-N.jpg`) → `api('/eval/feedback', { method: 'POST', body: form })` → `toastOk('Sent')`, `saved()`, reset, `closeFeedback()`; failure → `toastFail`. `useFormAbandon('feedback', text.trim() !== '')`.
- `FeedbackEntry.tsx`: `FeedbackRailButton()` (rail-style button with `Tooltip` "Send feedback", `Icon name="rate_review"`, aria-label "Send feedback", class `p-rail-item`) and `FeedbackMoreLink()` (a `p-more-link` row "Send feedback" / "Ideas, bugs and screenshots"); both render `null` unless `status.feedback`; both call `openFeedback()`.

- [ ] **Step 1:** Write `feedback.test.tsx` (`jest.mock('html-to-image', () => ({ toJpeg: jest.fn() }))`, mock `@/v2/api`, `useEvalStatus` → feedback on, `next/router` mock with `pathname: '/kids'`): Send with empty text shows "Write a short note first." and no api call; Bug + 4 stars + text sends FormData with `type=bug`, `stars=4`, `route=/kids`, `errors` from a prior `noteError(new ApiError(500,'x'))` = `http_500`; adding a 4 MB file shows the too-big line; after 3 shots both add buttons are disabled; removing a shot drops it; `FeedbackRailButton` renders nothing when feedback is off.
- [ ] **Step 2:** Run `npx jest tests/v2/eval/feedback` → FAIL.
- [ ] **Step 3:** Install the dependency, implement, add the hook lines.
- [ ] **Step 4:** Run → PASS; frontend CI line → PASS (`parentShell`, `parentIconButtons`, `polish` tests included).
- [ ] **Step 5:** Manual check: `cd frontend && npx next build` succeeds (catches SSR use of `document` in `html-to-image`; import it only inside `captureScreen` with `await import('html-to-image')` if the build fails).
- [ ] **Step 6:** Commit `feat(eval): feedback drawer with screenshots`.

### Task 10: `docs/eval-kit.md` and end-to-end check

**Files:**
- Create: `docs/eval-kit.md` (< 300 lines)

Sections (in this order; plain, numbered owner steps):
1. **What this is**: eval branch only, never merged; what is sent / never sent (copy `NOTICE`); feedback is insert-only.
2. **Umami on Unraid behind a Cloudflare Tunnel**:
   - Pin the version: run `gh release list -R umami-software/umami --exclude-pre-releases --limit 3`, take the newest stable tag, and write the exact image reference into the doc (no `latest`). Then use context7 (`/umami-software/umami`) for that version's `/api/send` docs and confirm `payload.id`, `payload.ip`, `payload.timestamp`, `CLIENT_IP_HEADER` and `DISABLE_BOT_CHECK` exist; if any differ, fix `events.umami_body`/`sender.send_umami` and their tests in this task.
   - Container env: `DATABASE_URL=postgresql://<user>:<password>@<host>:5432/postgres?sslmode=require&schema=umami`, `APP_SECRET=<openssl rand -hex 32>`, `CLIENT_IP_HEADER=x-eval-client-ip`, `DISABLE_BOT_CHECK=1`, `DISABLE_TELEMETRY=1`. Note: Supabase's direct host `db.<ref>.supabase.co` is IPv6-only unless the IPv4 add-on is on; if Unraid has no IPv6, use the **session pooler** host (also port 5432).
   - `cloudflared` container with a tunnel token; public hostname `umami.<domain>` → `http://<umami-container>:3000`. Optional Cloudflare Access on the dashboard paths, but `/api/send` must stay open to the boxes.
   - First login: change the default `admin`/`umami` password, add a website named "t@sk4ce eval", copy its website ID.
3. **Supabase feedback storage** (SQL editor, run as is):
   ```sql
   create table public.feedback (
     id uuid primary key,
     household uuid not null,
     type text not null check (type in ('feature','bug','other')),
     stars smallint check (stars between 1 and 5),
     text text not null check (char_length(text) between 1 and 2000),
     route text not null,
     app_version text not null,
     errors text[] not null default '{}',
     created_at timestamptz not null,
     screenshot_paths text[] not null default '{}'
   );
   alter table public.feedback enable row level security;
   revoke all on public.feedback from anon, authenticated;
   grant insert on public.feedback to anon;
   create policy "eval boxes insert feedback" on public.feedback
     for insert to anon with check (true);
   insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
   values ('feedback-shots', 'feedback-shots', false, 3145728,
           array['image/png','image/jpeg','image/webp']);
   create policy "eval boxes upload shots" on storage.objects
     for insert to anon with check (bucket_id = 'feedback-shots');
   ```
   Explain: no select/update/delete policy for `anon`, so a box can't read or change anything; the owner reads feedback with the dashboard or the secret key. Use the project's publishable (anon) key for `EVAL_SUPABASE_ANON_KEY`, never the secret key.
4. **Provision a box**: add the four `EVAL_*` lines to the box's `.env` next to `docker-compose.prod.yml`, `docker compose -f docker-compose.prod.yml up -d --build`; check: `docker compose logs backend | grep -i eval` shows no warnings; within a minute Umami shows a `box_boot` event; the household ID is in Settings → Usage stats.
5. **Check privacy after the first event**: in Umami, the session's country/city is empty and the IP is not stored; event data keys are only the allow-listed ones.
6. **Wipe a box between families**: `docker compose -f docker-compose.prod.yml down -v` (deletes the `task4ce_data` volume = `DATA_DIR`, including `eval.db`, the household ID and queued feedback). Warn: flush first — confirm the outbox is empty with `docker compose exec backend python -c "import sqlite3; print(sqlite3.connect('/app/data/eval.db').execute('select count(*) from outbox').fetchone())"` → `(0,)`.
7. **Turning it off**: remove the `EVAL_*` lines and restart; everything becomes a silent no-op.

- [ ] **Step 1:** Write `docs/eval-kit.md` with the sections above, including the pinned Umami tag from the `gh` lookup.
- [ ] **Step 2:** Local smoke test with a fake Umami: in one shell `cd /home/user/code/tskfrce-eval && $PY -c "import http.server as h; h.HTTPServer(('127.0.0.1', 8766), type('H', (h.BaseHTTPRequestHandler,), {'do_POST': lambda s: (print(s.path, s.headers.get('X-Eval-Client-IP'), s.rfile.read(int(s.headers['Content-Length']))), s.send_response(200), s.end_headers(), s.wfile.write(b'{}'))})).serve_forever()"`; in another `cd backend && export DATA_DIR=$(mktemp -d) && $PY -m alembic upgrade head && EVAL_UMAMI_URL=http://127.0.0.1:8766 EVAL_UMAMI_WEBSITE_ID=00000000-0000-0000-0000-000000000000 LOCK_LOOP_ENABLED=false $PY -m uvicorn app.main:app --port 8765`. Expected within 30 s: the fake prints `/api/send 192.0.2.1` and a body with `"name": "box_boot"` and `"source": "box"`. Stop both.
- [ ] **Step 3:** Run the backend CI line and the frontend CI line → both PASS.
- [ ] **Step 4:** Commit `docs(eval): eval kit provisioning, Umami, Supabase and wipe guide`.
