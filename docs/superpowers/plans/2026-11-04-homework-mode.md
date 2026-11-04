# Homework mode — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A parent (or an approved kid request) can switch a paused device into
homework mode. Starter, family and per-kid allowed sites — plus whatever those
sites pull in — then work. Everything else stays paused, and the parent watches
a live activity list with Block / Add / End controls.

**Architecture:**

- **Backend.** A new `Override` action `homework` (reuses expiry, fan-out and
  push). New tables hold the site lists, kid requests and activity.
  `/internal/state` and the blocker push gain a per-MAC `homework` map.
- **Blocker.** A pure `HomeworkGate` decides per DNS name: list match,
  10 s session follow, or block-list wins. Allowed lookups are forwarded to the
  upstream resolver. Each returned IPv4 address becomes an allowed
  `(MAC, IP)` pair, installed in nftables **before** the DNS reply is sent.
  Activity is batched to the backend. When homework mode ends, conntrack is
  flushed.
- **Frontend.**
  - A **Homework mode** control next to the lock buttons.
  - An activity panel.
  - A Homework settings pane and per-kid lists.
  - A kid "Ask for homework time" button, and a homework row in "Needs you".

**Tech stack:**
- FastAPI, SQLAlchemy and alembic (SQLite)
- blocker: Python 3.11, scapy, nftables, conntrack-tools
- Next.js pages router, React Query, Mantine, jest

**Spec:** `docs/superpowers/specs/2026-11-04-homework-mode-design.md`. Interface
notes from recon: the executor should regenerate these by reading the files
named in each task.

## Global Constraints

- Homework is **permissive**: a pair allows **any protocol and port** (TCP and
  UDP, including QUIC) to the resolved IPv4. **IPv4 only**; AAAA queries keep
  getting an empty NOERROR.
- **Session follow:** after an allowed lookup by a device, every name that
  device looks up within **10 s** is allowed for the rest of the session. The
  window **restarts on every allowed lookup**. "Pulled in by" = the most recent
  allowed name.
- **Pair timeout:** `max(DNS TTL, 300 s)`, refreshed on every lookup.
- **Precedence:** the family **block list always wins**, over starter, family
  and per-kid lists and over session follow.
- **Effective allow list** = starter + family + that device's kid's list.
  Unassigned devices get starter + family.
- **Blocking a name** removes only addresses no still-allowed name has
  resolved to, then deletes conntrack entries for the removed addresses.
- **Ending homework** (manual, timer or schedule) clears the device's pairs and
  deletes its conntrack entries, so the device is fully paused again within
  seconds.
- **Default timer 60 min.** `expires_at = min(now + minutes, next scheduled
  transition)`. The timer is the only cap when no transition exists within 24 h.
- **Homework only applies to currently paused devices.** For a single device
  that isn't paused: 409 `"{device} is already online."` For a kid or group, it
  applies to the paused devices only, and returns 409
  `"None of {name}'s devices are paused."` if there are none.
- **Only parents** edit lists. Domains are stored lowercase, without scheme,
  path, port or trailing dot. An entry matches itself and every subdomain.
- **Activity** stays on the box (backend DB), is purged after **7 days**, and
  holds names and times only.
- **YouTube is not on the starter list.**
- **Copy:** plain sentence case, no emojis in the parent UI. Start-delay hint:
  "It may take up to a minute to start."
- Files < 500 lines (`blocker/service.py` is already 409: new blocker logic goes
  in new files). Semantic commits ending with the session trailer lines. CI
  must pass. Backend: `ruff format --check . && ruff check . && pytest -q`.
  Frontend: `npx tsc --noEmit && npm run lint && npx jest`. Blocker:
  `ruff check . && pytest -q`.

## Review Focus

1. **The DNS reply reaches the device before its nft pair exists.** The first
   connection would be dropped and the page would hang.
   → Task 9 test: the pair is installed before the reply bytes are sent.
2. **Homework ends while a video is still streaming.** The kid must lose access
   within seconds, not when the stream closes.
   → Task 10 test: conntrack delete is called for the device IP on end.
3. **Upstream DNS is down or slow.** The device must get a fast SERVFAIL, not a
   hang, and the portal must keep working for paused devices.
   → Task 9 test with a timeout.
4. **A parent pastes a URL as a domain** (`https://Classroom.Google.com/u/0/`).
   It must be stored as `classroom.google.com`; junk is rejected with 400.
   → Task 1 tests.
5. **Homework is turned on for a device that just came online, or twice.** Expect
   a clear 409 for the first. A second "homework" call replaces the timer and
   does not stack.
   → Task 3 tests.

---

### Task 1: Data model, migration, starter list, domain normaliser

**Files:**
- Create: `backend/app/models/homework.py`
- Create: `backend/app/data/homework_starter.txt`
- Create: `backend/app/services/homework_domains.py`
- Create: `backend/alembic/versions/h1a2b3c4d5e6_homework_mode.py`
- Modify:
  - `backend/app/models/lock.py:109-122` — `ck_override_action` adds `'homework'`
  - `backend/app/models/inbox.py:16-36` — `KINDS` adds `homework_request`
  - `backend/app/services/notify.py:54` — map the new kind
  - `backend/app/core/database.py` — `_import_all_models`
- Test: `backend/tests/test_homework_domains.py`; `backend/tests/test_migrations.py` must still pass.

**Interfaces — Produces:**
- `HomeworkSite(id, kid_id: int|None FK users.id ondelete CASCADE, domain: str(253), kind: 'allow'|'block', created_at)`.
  - `UniqueConstraint(kid_id, domain, kind, name="uq_homework_site")`
  - `CheckConstraint("kind IN ('allow','block')", name="ck_homework_site_kind")`
  - `CheckConstraint("kind = 'allow' OR kid_id IS NULL", name="ck_homework_block_family")`
- `HomeworkRequest(id, kid_id FK users.id, status 'pending'|'approved'|'denied' (CHECK ck_homework_request_status), minutes int|None, created_at, decided_at|None, decided_by_id|None)`.
- `HomeworkActivity(id, device_id FK devices.id ondelete CASCADE, session_start DateTime, domain str(253), via 'list'|'follow' (CHECK), pulled_by str|None, first_seen, last_seen, lookups int, active_minutes int)`.
  - `UniqueConstraint(device_id, session_start, domain, name="uq_homework_activity")`
- `normalize_domain(raw: str) -> str | None`. It strips the scheme, userinfo,
  path, query, port and trailing dot, then lowercases and IDNA-encodes. It
  returns None unless the result has ≥2 labels, each label matches
  `[a-z0-9-]{1,63}` with no leading or trailing `-`, and the total is ≤253.
- `domain_matches(name: str, entry: str) -> bool`: true when equal, or when
  `name` ends with `"." + entry`.
- `STARTER: tuple[str, ...]`, loaded once from `homework_starter.txt`. One
  domain per line; `#` comments are allowed.

- [ ] **Step 1: Failing tests** in `test_homework_domains.py`:
  ```python
  @pytest.mark.parametrize("raw,want", [
    ("https://Classroom.Google.com/u/0/", "classroom.google.com"),
    ("khanacademy.org.", "khanacademy.org"), ("  docs.google.com:443 ", "docs.google.com"),
    ("user@site.example.com/x?y=1", "site.example.com")])
  def test_normalize_ok(raw, want): assert normalize_domain(raw) == want
  @pytest.mark.parametrize("raw", ["", "localhost", "-bad.com", "a..b.com", "x"*254 + ".com", "http://", "*.google.com"])
  def test_normalize_rejects(raw): assert normalize_domain(raw) is None
  def test_matches_subdomain(): assert domain_matches("a.b.google.com", "google.com") and not domain_matches("notgoogle.com", "google.com")
  def test_starter_is_normalized_and_has_no_youtube():
      assert STARTER and all(normalize_domain(d) == d for d in STARTER)
      assert not any(domain_matches("youtube.com", d) or d.endswith("youtube.com") for d in STARTER)
  ```
- [ ] **Step 2: Run** `cd backend && pytest tests/test_homework_domains.py -q`. Expected: FAIL (import error).
- [ ] **Step 3: Implement** the models, the normaliser and the starter file.
  Seed the starter file with the services the spec lists (section 3) **and
  their helper domains**. Examples:
  - Google: `accounts.google.com`, `gstatic.com`, `googleusercontent.com`,
    `classroom.google.com`, `docs.google.com`, `drive.google.com`
  - Microsoft: `login.microsoftonline.com`, `office.com`, `teams.microsoft.com`
  - Learning platforms: `instructure.com`, `schoology.com`, `clever.com`,
    `powerschool.com`, `seesaw.me`
  - Learning sites: `khanacademy.org`, `kastatic.org`, `quizlet.com`,
    `ixl.com`, `desmos.com`
  - Reference: `wikipedia.org`, `wikimedia.org`, `britannica.com`
- [ ] **Step 4: Migration.** Run `cd backend && alembic heads` and use the
  printed head as `down_revision` (expected `b0c1d2e3f4a5`). Create the 3
  tables, with explicit constraint names. Use `batch_alter_table` to recreate
  `ck_override_action` with `('lock','unlock','homework')`, and
  `ck_notification_kind` with the old kinds plus `homework_request`. Follow the
  precedent in `l5e6f7a8b9c0_kid_app_v3.py:40-58`. Downgrade reverses this.
- [ ] **Step 5: Run** `pytest tests/test_homework_domains.py tests/test_migrations.py -q && ruff format --check . && ruff check .`. Expected: pass.
- [ ] **Step 6: Commit** `feat(homework): data model, migration and starter list`.

### Task 2: Lock logic — homework facts, next transition, blocker state

**Files:**
- Create: `backend/app/lock/homework.py`
- Modify:
  - `backend/app/lock/rules.py:13-29`: `DeviceFacts.homework_until: datetime | None = None`
  - `backend/app/lock/state.py:48-89` (`device_facts`) and `:102-117` (`tick` returns the homework map too)
  - `backend/app/lock/hours.py`: add `next_transition`
  - `backend/app/lock/blocker_client.py`: `push_blocked` → `push_state`
  - `backend/app/lock/loop.py:27`
  - `backend/app/api/internal.py:205-211`
- Test: `backend/tests/lock/test_homework_state.py`, `backend/tests/lock/test_hours.py` (add), `backend/tests/test_internal_api.py` (add)

**Interfaces:**
- Consumes: Task 1 models, `STARTER`.
- Produces:
  - `hours.next_transition(allowed_sets, off, now_local: datetime) -> datetime | None`.
    Scans minute by minute up to 24 h, like `locks_at`. Returns the first
    whole minute where `(_allowing(...), in_off(...))` differs from its value
    at `now_local`.
  - `homework.effective_allow(db, kid_id: int | None) -> list[str]`: starter +
    family allow + that kid's allow, de-duplicated and sorted.
  - `homework.block_list(db) -> list[str]`.
  - `homework.state_map(db, rows: list[tuple[Device, DeviceFacts]], blocked: set[str]) -> dict[str, dict]`.
    It returns `{mac: {"allow": [...], "block": [...], "until": iso_z}}` for
    each MAC in `blocked` whose facts have `homework_until`.
  - `tick(db, now_utc) -> tuple[list[str], dict[str, dict]]`, as `(blocked, homework)`.
    Update every caller: `desired_blocked` is unchanged, and `loop._run_once`
    calls `push_state(blocked, homework)`.
  - `blocker_client.push_state(blocked: list[str], homework: dict) -> bool`
    POSTs `{"blocked": [...], "homework": {...}}`.
  - `/internal/state` adds `"homework": {...}`, empty when `listen_only`.
- **Schedule changes:** on every `tick`, a live homework override whose
  `expires_at` is later than that device's `next_transition` is clamped down to
  it. Spec: "If the schedule changes while homework mode is on, recompute
  `expires_at`."
- `device_facts`: the newest live **manual** override with action `homework`
  sets `homework_until = expires_at`. For `block_reason`, `override` is
  treated as `None` when the action is `homework`, so the device keeps whatever
  pause reason it otherwise has.

- [ ] **Step 1: Failing tests.**
  - `test_next_transition_bedtime`: allowed 15:00–20:00, `now` 19:30 local → 20:00.
  - `test_next_transition_off_window_start`: off 21:00–07:00, `now` 20:30, outside allowed → 21:00.
  - `test_next_transition_none_within_24h` → None.
  - `test_homework_device_stays_blocked_and_in_map`: device paused by chores
    plus a homework override expiring at T → MAC in `blocked`, and
    `homework[mac]["until"] == T` as Z-string.
  - `test_effective_allow_merges_kid_list_and_excludes_other_kid`.
  - `test_block_list_in_map`.
  - `test_expired_homework_not_in_map`.
  - `test_tick_clamps_homework_to_new_bedtime`: a homework override expiring
    at 21:00; the hours rule changes to end at 20:00; `tick` → `expires_at`
    is 20:00.
  - `test_internal_state_has_homework` (with `tok()`).
  - `test_push_state_body` (monkeypatch `urllib`/`requests` as the existing
    blocker_client tests do).
- [ ] **Step 2: Run** `pytest tests/lock tests/test_internal_api.py -q`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** per Interfaces. Keep `homework.py` ≤ 150 lines.
- [ ] **Step 4: Run** `pytest -q && ruff format --check . && ruff check .`. Expected: all pass. Existing lock tests stay green.
- [ ] **Step 5: Commit** `feat(homework): lock state and blocker payload`.

### Task 3: Homework override API (device, kid, group)

**Files:**
- Modify:
  - `backend/app/schemas/lock.py:32`: `action: Literal["lock","unlock","homework"]`
  - `backend/app/lock/overrides.py`: add `set_homework`
  - `backend/app/api/devices.py:205-216, 332-345`
  - `backend/app/api/device_activity.py:149-165`
- Test: `backend/tests/test_homework_api.py`

**Interfaces:**
- Produces:
  - `overrides.set_homework(db, devices: list[Device], minutes: int | None, user_id: int, now_utc) -> list[Device]`.
    - Keeps only devices currently paused (via `device_facts` and
      `block_reason`).
    - `minutes` defaults to 60.
    - `expires_at = min(now+minutes, next_transition for that device)`.
    - Clears existing manual overrides first, so a second call replaces the
      timer.
    - Returns the devices it applied to.
  - The endpoints route `action == "homework"` to `set_homework`. Errors use
    the exact copy in Global Constraints. Responses: `{"ok": True}` for a
    device, `{"ok": True, "devices": n}` for a kid or group. `trigger()` is
    called after commit.

- [ ] **Step 1: Failing tests:**
  - device paused → 200 and a homework override with `expires_at ≈ now+60m`
  - device online → 409 `"... is already online."`
  - with bedtime in 20 min → `expires_at` = bedtime
  - second call with `minutes=30` → exactly one manual override, 30 min
  - kid with one paused and one online device → `devices == 1`
  - kid with none paused → 409 `"None of ...'s devices are paused."`
  - group → applies to paused only
  - kid token → 401/403
  - `DELETE` (existing) ends homework
- [ ] **Step 2: Run** `pytest tests/test_homework_api.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `pytest -q && ruff format --check . && ruff check .`. Expected: pass.
- [ ] **Step 5: Commit** `feat(homework): turn homework mode on per device, kid or group`.

### Task 4: Site lists API

**Files:**
- Create: `backend/app/api/homework.py`, router prefix `/api/v1/homework`, `require_parent`; register it in `main.py`
- Create: `backend/app/schemas/homework.py`
- Test: `backend/tests/test_homework_sites_api.py`

**Interfaces:**
- `GET /homework/sites` → `{"starter": [..], "allow": [..], "block": [..], "kids": {kid_id: [..]}}`.
- `POST /homework/sites` body `SiteIn{domain: str, kind: 'allow'|'block', kid_id: int|None}`.
  - Normalises with `normalize_domain`: 400 `"That doesn't look like a website address."`
  - `block` with a `kid_id` → 400 `"Blocks apply to the whole family."`
  - Unknown kid → 404 `"We couldn't find that kid."`
  - A duplicate is a no-op 200.
  - Adding `block` removes a family `allow` for the same domain.
  - Returns the stored `{domain, kind, kid_id}`.
  - Calls `trigger()`.
- `DELETE /homework/sites` with the same body → 204. Calls `trigger()`.

- [ ] **Step 1: Failing tests:**
  - add a family allow from a pasted URL → stored normalised
  - add a per-kid allow → appears under `kids[kid_id]` only
  - add a block → removes the family allow and appears in `block`
  - block with `kid_id` → 400
  - junk → 400
  - delete → gone
  - kid token → 403
  - starter returned read-only (a starter entry can't be deleted; DELETE of a
    starter-only domain → 404 `"That site is on the built-in list."`)
- [ ] **Step 2–4:** Run, implement, then run `pytest -q && ruff …`.
- [ ] **Step 5: Commit** `feat(homework): family, per-kid and block site lists`.

### Task 5: Activity — internal upload, parent read, retention

**Files:**
- Modify: `backend/app/api/internal.py` (new route), `backend/app/api/homework.py` (read routes), `backend/app/lock/state.py:tick` (purge)
- Test: `backend/tests/test_homework_activity.py`

**Interfaces:**
- `POST /api/v1/internal/homework/activity`, token-protected. Body
  `ActivityReport{items: list[{mac, session_start: iso, domain, via: 'list'|'follow', pulled_by: str|None, first_seen, last_seen, lookups: int, active_minutes: int}]}`,
  with the existing `MAC_RE` validator and ≤ 500 items.
  - Upserts on `(device, session_start, domain)`. `lookups` and
    `active_minutes` **replace** (the blocker sends totals). `last_seen` takes
    the max.
  - Unknown MAC → skipped.
  - Returns `{"ok": true, "stored": n}`.
- `GET /api/v1/homework/activity?device_id=` or `?kid_id=` returns the
  **current or most recent session** per device:
  `[{device_id, device_name, session_start, active: bool, until, items: [{domain, via, pulled_by, active_minutes, last_seen}]}]`,
  with items sorted by `active_minutes` descending.
- `tick` deletes `HomeworkActivity` rows with `last_seen` older than 7 days.

- [ ] **Step 1: Failing tests:**
  - upload, then read → sorted rows
  - a second upload replaces the totals
  - unknown MAC skipped
  - bad token → 403
  - 501 items → 422
  - kid filter returns all that kid's devices
  - an 8-day-old row is purged by `tick`, a 6-day-old row is kept
- [ ] **Step 2–4:** Run, implement, then run `pytest -q && ruff …`.
- [ ] **Step 5: Commit** `feat(homework): activity upload, parent view and 7-day retention`.

### Task 6: Kid request and "Needs you"

**Files:**
- Modify:
  - `backend/app/api/kid.py`: `POST /kid/homework`; `GET /kid/today` adds `homework`
  - `backend/app/api/homework.py`: approve and deny
  - `backend/app/api/family.py:92-175` (`_needs_you`)
  - `backend/app/services/inbox.py:78` (`path_for`)
- Test: `backend/tests/test_homework_requests.py`

**Interfaces:**
- `POST /api/v1/kid/homework` (`require_kid`):
  - Kid not paused on any device → 409 `"Your internet is already on."`
  - A pending request already exists → 409 `"You already asked. A parent will answer soon."`
  - Otherwise creates a `HomeworkRequest` and calls
    `inbox.notify_parents(db, "homework_request", "Homework time", f"{kid.full_name} is asking for homework time")`.
  - Returns `{"ok": true, "id": n}`.
- `GET /kid/today` adds `"homework": {"until": iso} | None` and `"homework_pending": bool`.
- `POST /api/v1/homework/requests/{id}/approve` with body `{minutes: int = 60, 15..240}`:
  - Calls `set_homework` on the kid's devices.
  - A request that was already decided → 409 `"Someone already answered this request."`
  - If no device is paused, the request is marked approved with 0 devices.
    Response `{"ok": true, "devices": 0}`.
  - `inbox.notify(db, [kid_id], "redemption_decided", ...)` is reused for the
    kid's bell.
- `POST /homework/requests/{id}/deny` → denied, and the kid is notified.
- `_needs_you` emits pending requests as
  `{"type": "homework", "id", "kid_id", "kid_name", "title": "Homework time", "submitted_at"}`.

- [ ] **Step 1: Failing tests:**
  - kid paused → request created and the parent notified (assert notification row)
  - duplicate → 409
  - not paused → 409
  - approve → homework override on the kid's paused devices, request approved
  - double approve → 409
  - deny
  - `GET /today` needs_you contains a `homework` item
  - kid today shows `homework_pending` and then `homework.until`
- [ ] **Step 2–4:** Run, implement, then run `pytest -q && ruff …`.
- [ ] **Step 5: Commit** `feat(homework): kid requests and Needs you`.

### Task 7: Blocker — HomeworkGate (pure logic)

**Files:**
- Create: `blocker/homework.py` (≤ 250 lines)
- Test: `blocker/tests/test_homework_gate.py`

**Interfaces — Produces:**
- `FOLLOW_SECS = 10.0`, `MIN_PAIR_SECS = 300`.
- `class HomeworkGate(clock=time.monotonic)`:
  - `update(state: dict[str, dict]) -> set[str]`.
    - `state` is the `homework` map from the backend: mac → `{allow, block, until}`.
    - Returns the **MACs whose sessions ended** (no longer present).
    - It starts a new session when a MAC first appears. A changed `until`
      keeps the same session.
  - `decide(mac: str, name: str) -> tuple[bool, str | None, str | None]` returns `(allowed, via, pulled_by)`:
    - the name is lowercased with the trailing dot stripped
    - block match → `(False, None, None)`
    - allow-list match → `(True, "list", None)`, and the follow window restarts
    - within `FOLLOW_SECS` of the last allowed lookup, or already followed this
      session → `(True, "follow", last_allowed_name)`
    - otherwise `(False, None, None)`
    - not in homework → `(False, None, None)`
  - `record(mac: str, name: str, ips: list[str], ttl: int, via, pulled_by) -> set[str]`.
    - Adds or refreshes `(mac, ip)` pairs with expiry `now + max(ttl, MIN_PAIR_SECS)`.
    - Records activity (lookups +1, active minute bucket, first/last seen).
    - Returns the **newly added** IPs.
  - `pairs() -> set[tuple[str, str]]`: unexpired pairs.
  - `blocked_cut(mac: str) -> set[str]`: IPs to remove after the block list
    changed. These are IPs resolved **only** by names that now match the block
    list, and they are removed from pairs.
  - `drain_activity() -> list[dict]`: rows in the `ActivityReport` item shape
    (Task 5) with **totals**, and `session_start` as an ISO Z string.
  - `active(mac) -> bool`.

- [ ] **Step 1: Failing tests** (use a fake clock):
  - list match allowed and starts the window
  - an unrelated name 5 s later → follow, `pulled_by` set
  - 11 s later with no new allowed lookup → denied
  - the window restarts on each allowed lookup (allowed at t=0 and t=8, other
    name at t=15 → follow)
  - a followed name stays allowed at t=600
  - block beats list, follow and per-kid allow
  - subdomain matching
  - pairs expire at `max(ttl, 300)` and a re-lookup refreshes
  - `update` drops a MAC → returned as ended, and its pairs are gone
  - `blocked_cut` keeps an IP shared with a still-allowed name
  - `drain_activity` totals and `active_minutes` counts distinct minutes
  - non-homework MAC → denied
- [ ] **Step 2: Run** `cd blocker && pytest tests/test_homework_gate.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `ruff check . && pytest -q`. Expected: pass.
- [ ] **Step 5: Commit** `feat(blocker): homework gate with session follow`.

### Task 8: Blocker — firewall pairs and conntrack

**Files:**
- Modify:
  - `blocker/firewall.py:26-80`: `render_ruleset(..., hw_out: set[tuple[str, str]] = frozenset(), hw_back: set[tuple[str, str]] = frozenset())`
  - `blocker/firewall.py`: add `add_pairs`, `kill_conntrack`
  - `blocker/Dockerfile:5`: `apk add conntrack-tools`
- Test: `blocker/tests/test_firewall.py` (add)

**Interfaces — Produces:**
- The ruleset gains two sets:
  - `hw_out` (type `ether_addr . ipv4_addr`), elements `mac . ip`
  - `hw_back` (type `ipv4_addr . ipv4_addr`), elements `remote_ip . device_ip`

  `hw_out` holds `(mac, remote_ip)` pairs and `hw_back` holds
  `(remote_ip, device_ip)` pairs. Task 10 builds both.
- Rules in `chain forward`:
  - `ether saddr . ip daddr @hw_out accept` goes **before**
    `ether saddr @blocked_mac drop` and before
    `ip saddr @blocked_v4 tcp dport 443 drop`.
  - `ip saddr . ip daddr @hw_back accept` goes **before**
    `ip daddr @blocked_v4 drop`.
- `add_pairs(out: set[tuple[str, str]], back: set[tuple[str, str]]) -> None`
  runs `nft add element inet task4ce hw_out { ... }` and the same for
  `hw_back`. It does nothing when both are empty, and raises
  `CalledProcessError` on failure.
- `kill_conntrack(ips: set[str], device_ip: str | None = None) -> None` runs
  `conntrack -D -s <device_ip>` and `conntrack -D -d <ip>` for each IP. It
  ignores exit status 1 ("0 flow entries"), and logs a warning if the
  `conntrack` binary is missing.

- [ ] **Step 1: Failing tests:**
  - render with pairs → the set declarations and elements appear
  - accept rules are ordered before the drops (assert the index ordering of
    lines)
  - empty pairs → the sets are declared empty and the rules are still present
  - `add_pairs` builds the exact `nft` command (inject a `run=` callable, as
    `apply` does, or monkeypatch `subprocess.run`)
  - `kill_conntrack` command list, and status 1 tolerated
- [ ] **Step 2–4:** Run, implement, then run `ruff check . && pytest -q`. Also run `docker build -t blk-test blocker && docker run --rm --entrypoint conntrack blk-test --version`.
- [ ] **Step 5: Commit** `feat(blocker): nft homework pairs and conntrack cut`.

### Task 9: Blocker — DNS forwarding for homework devices

**Files:**
- Create: `blocker/upstream.py` (≤ 120 lines)
- Modify: `blocker/portal.py:41-60` (`run_dns` gets an optional `handle` hook), `blocker/config.py` (`upstream_dns`)
- Test: `blocker/tests/test_upstream.py`, `blocker/tests/test_portal.py` (add)

**Interfaces — Produces:**
- `Config.upstream_dns: str`. It comes from env `UPSTREAM_DNS`, else the first
  non-loopback `nameserver` in `/etc/resolv.conf`, else `""`. When empty, the
  service uses the LAN gateway IP.
- `upstream.forward(query: bytes, server: str, timeout: float = 2.0) -> bytes | None`:
  a UDP round trip. It returns None on timeout or error.
- `upstream.a_records(reply: bytes) -> tuple[list[str], int]`: the IPv4
  answers and the minimum TTL, via scapy.
- `upstream.servfail(query: bytes) -> bytes | None`.
- `run_dns(cfg, box_ip, stop, handle: Callable[[str, bytes], bytes | None] | None = None)`:
  for each datagram it calls `handle(client_ip, data)` first. If that returns
  bytes, they are sent. If it returns None, it falls back to
  `dns_response(data, box_ip)` (today's behaviour).
- `upstream.handle_homework(gate, firewall_add, mac_for_ip, server, client_ip, query) -> bytes | None`
  is the glue Task 10 wires in:
  1. Parse the qname and qtype. Unparsable → None.
  2. `mac = mac_for_ip(client_ip)`; if it's not `gate.active(mac)` → None.
  3. qtype AAAA → None (the portal returns the empty answer).
  4. `gate.decide(...)` is False → None (portal answer).
  5. Otherwise `forward`. On None → `servfail(query)`.
  6. `ips, ttl = a_records(reply)`.
  7. `new = gate.record(...)`.
  8. **`firewall_add({(mac, ip) for ip in new}, {(ip, client_ip) for ip in new})` BEFORE returning the reply.**
  9. Return the reply.

- [ ] **Step 1: Failing tests** (fake gate, fake firewall_add recording call
  order, fake forward via monkeypatch):
  - allowed A query → forward called, `firewall_add` called before the
    function returns, reply returned unchanged
  - denied → None
  - AAAA → None
  - non-homework IP → None
  - upstream timeout → SERVFAIL bytes (rcode 2), with the same txid
  - `a_records` parses 2 A records plus a CNAME
  - `forward` against a local UDP socket fixture echoing a canned reply
  - a `forward` timeout of 0.2 s returns None within 1 s
  - `run_dns` with `handle` returning bytes sends them, and with None falls
    back
  - `Config` reads `UPSTREAM_DNS`, then resolv.conf (tmp file via an
    injectable path)
- [ ] **Step 2–4:** Run, implement, then run `ruff check . && pytest -q`.
- [ ] **Step 5: Commit** `feat(blocker): forward homework DNS upstream and pre-install pairs`.

### Task 10: Blocker — wire the gate into state, push, apply and upload

**Files:**
- Create: `blocker/hw_wiring.py` (≤ 150 lines; keeps `service.py` < 500)
- Modify:
  - `blocker/state_store.py`: add homework state
  - `blocker/api.py:38-53`: accept the optional `homework`
  - `blocker/backend.py:68-80`: keep `homework`; add `report_homework_activity`
  - `blocker/service.py`: `_apply` passes pairs, `_reconcile_once`, `_resist_once`, `start` (DNS handle) — minimal lines
- Test: `blocker/tests/test_homework_wiring.py`; add to `test_api.py`, `test_backend.py`, `test_service.py`.

**Interfaces:**
- `StateStore.set_state(blocked: list[str], homework: dict | None = None) -> set[str]`.
  `set_blocked` stays as a wrapper. Add `homework() -> dict`.
  - It validates the homework MACs and that `allow`/`block` are lists of
    strings. On a bad payload → ValueError, and the old state is kept.
  - Callbacks fire on a change to either part.
- `api._state`: an optional `homework` must be a dict, else 400
  `"'homework' must be an object."`
- `backend.fetch_state` keeps `homework` (default `{}`).
  `report_homework_activity(cfg, items: list[dict]) -> bool` POSTs
  `/homework/activity` best-effort, in chunks of ≤ 500.
- `hw_wiring.HomeworkWiring(gate, firewall, mac_for_ip, ip_for_mac, cfg)`:
  - `on_state(homework)` calls `gate.update`. For each ended MAC it calls
    `firewall.kill_conntrack(set(), device_ip=ip_for_mac(mac))`. For changed
    block lists it calls `blocked_cut` and then `kill_conntrack(cut, …)`.
  - `pairs_for_render() -> tuple[set, set]` returns `(hw_out, hw_back)` built
    from `gate.pairs()` and `ip_for_mac`.
  - `dns_handle(client_ip, query)` delegates to `upstream.handle_homework`.
    `firewall_add` comes from Task 8, and the server is
    `cfg.upstream_dns or gateway_ip`.
  - `flush_activity(report)` sends `gate.drain_activity()` through `report`.
- In `service.py`:
  - `_apply` passes `*wiring.pairs_for_render()` into `render_ruleset`, so the
    full reloads keep the pairs.
  - The store's on_change also calls `wiring.on_state`.
  - `_resist_once` calls `wiring.flush_activity`.
  - `start` passes `handle=wiring.dns_handle` to `run_dns`.

- [ ] **Step 1: Failing tests:**
  - push with `homework` → store updated
  - bad homework → 400 and the state is unchanged
  - `fetch_state` keeps `homework`
  - a homework MAC disappearing → `kill_conntrack` is called with its IP
    (**Review Focus 2**)
  - a block-list change → the cut IPs are removed from the next render and
    conntrack is cut
  - `_apply` render includes the current pairs
  - `_resist_once` uploads the drained activity
  - `start` wires the DNS handle (assert via an injected `run_dns`, or
    expose a factory)
- [ ] **Step 2–4:** Run, implement, then run `ruff check . && pytest -q`. Check `wc -l blocker/service.py` (< 500).
- [ ] **Step 5: Commit** `feat(blocker): homework mode end-to-end in the blocker`.

### Task 11: Lab e2e journey

**Files:**
- Create: `blocker/tests/lab/test_journey_homework.py`
- Modify (if needed): `lab/router/entrypoint.sh` or the lab compose, so a
  fake upstream DNS answers `allowed.test` and `helper.test` with
  `203.0.113.1`.
- Modify: `scripts/lab.sh`, adding a `dig <host> <name>` subcommand if one is
  missing.
- Modify: `blocker/tests/lab/journey.py` helpers.

**Steps:**
- [ ] **Step 1: Write the journey** (`pytestmark = pytest.mark.integration`):
  1. Pause kid1 (`lab("block","kid1",check=True)`) and wait until it's offline.
  2. Family allow `allowed.test` via `POST /homework/sites`.
  3. Turn homework on: `POST /devices/{id}/override {"action":"homework","minutes":10}`.
  4. Within 60 s, `dig allowed.test` from kid1 returns `203.0.113.1`, and an
     HTTP fetch to it succeeds.
  5. `dig helper.test` within 10 s also returns the real IP (follow).
  6. `dig other.test` after 15 s returns the box IP (portal).
  7. Block `helper.test`; then `dig helper.test` returns the box IP.
  8. `DELETE` the override; within 15 s the HTTP fetch to `203.0.113.1` fails.
  9. Activity `GET /homework/activity?device_id=` lists `allowed.test` (via
     list) and `helper.test` (via follow, `pulled_by` `allowed.test`).
- [ ] **Step 2: Run** `cd blocker && RUN_INTEGRATION=1 python -m pytest tests/lab/test_journey_homework.py -v`. Expected: PASS. This needs docker; the CI `lab` job runs it.
- [ ] **Step 3: Commit** `test(lab): homework mode journey`.

### Task 12: Frontend — Homework mode control and status

**Files:**
- Modify:
  - `frontend/src/v2/types.ts:6,13`: add `'homework'` to `OverrideAction`
  - `frontend/src/v2/hooks/useOverride.ts`: `TOAST.homework`, and `minutes` passes through
  - `frontend/src/v2/manage/DeviceDetail.tsx:192-210`
  - `frontend/src/v2/manage/DevicesPage.tsx:64-71`
  - `frontend/src/v2/manage/GroupDetail.tsx`
- Create: `frontend/src/v2/manage/HomeworkButton.tsx` (≤ 120 lines)
- Test: `frontend/tests/v2/homeworkButton.test.tsx`, `frontend/tests/v2/useOverride.test.ts` (add)

**Interfaces:**
- `<HomeworkButton target={OverrideTarget} disabled={boolean} busy={boolean} onStart={(minutes:number)=>void} />`.
  - An `ActionButton` with icon `menu_book` and label "Homework mode".
  - It opens a small menu: 30 / **60** (default) / 90 / 120 min.
  - Shown only when the device is paused (`!device.online`). It is disabled
    while busy.
  - Hint under it: "Homework sites stay on. It may take up to a minute to start."
- `DevicesPage.handleRequestOverride` maps
  `{action:'homework', minutes}` → `choice {action:'homework', minutes}`.
- Toast: `"Homework mode on until {time}."` with undo, using the existing
  `undoChoice`.
- When `device.override?.action === 'homework'`, the status line reads
  "Homework mode until {time}", and "Back to schedule" ends it.

- [ ] **Step 1: Failing tests:**
  - button hidden when the device is online
  - picking 90 calls `onStart(90)`
  - default 60
  - `useOverride` sends `{action:'homework', minutes:60}` to `/devices/3/override`
  - toast copy
  - group detail shows the button
- [ ] **Step 2–4:** Run, implement, then run `npx tsc --noEmit && npm run lint && npx jest`.
- [ ] **Step 5: Commit** `feat(frontend): homework mode control`.

### Task 13: Frontend — Activity panel

**Files:**
- Create: `frontend/src/v2/manage/HomeworkActivity.tsx` (≤ 200 lines), `frontend/src/v2/hooks/useHomework.ts`
- Modify: `frontend/src/v2/manage/DeviceDetail.tsx` (render it when homework is
  active or a session ended within 24 h)
- Test: `frontend/tests/v2/homeworkActivity.test.tsx`

**Interfaces:**
- `useHomeworkActivity({deviceId?, kidId?})` → `GET /homework/activity?...`,
  refetching every 15 s while any session is active.
- `useHomeworkSite()` mutation: POST/DELETE `/homework/sites`. It invalidates
  `['homework-sites']` and `['homework-activity']`.
- Panel `<section className="pk-panel" aria-label="Homework activity">`:
  - rows of `domain · {n} min`, with "pulled in by {pulled_by}" for follow rows
  - buttons **Block** and **Add to allowed**
  - **Add to allowed** opens a choice: "Just for {kid}" / "For everyone". Only
    "For everyone" shows when the device has no kid.
  - Header button **End homework mode** (a DELETE override through
    `useOverride`)
  - Under Block, the one-line hint: "Sites that share servers with an allowed
    site may still load."

- [ ] **Step 1: Failing tests:**
  - rows sorted as returned
  - follow row shows "pulled in by"
  - Block posts `{domain, kind:'block'}`
  - Add → "Just for Sam" posts `{domain, kind:'allow', kid_id}`
  - End calls the override DELETE
  - an unassigned device shows only "For everyone"
- [ ] **Step 2–4:** Run, implement, then run `npx tsc --noEmit && npm run lint && npx jest`.
- [ ] **Step 5: Commit** `feat(frontend): homework activity panel`.

### Task 14: Frontend — lists (settings and per-kid) and docs

**Files:**
- Create: `frontend/src/v2/manage/HomeworkPane.tsx` (≤ 200 lines), `frontend/src/v2/manage/KidHomeworkSites.tsx` (≤ 120 lines)
- Modify:
  - `frontend/src/v2/manage/settingsSections.ts`: add section `'homework'`
  - `frontend/src/v2/manage/SettingsPage.tsx`
  - `frontend/src/v2/manage/KidDetail.tsx`: add a panel
  - `docs/guide/04-everyday-use.md`: a "Homework mode" section
  - `docs/guide/06-troubleshooting.md`: "Homework sites won't load", with the
    Private DNS tip
- Test: `frontend/tests/v2/homeworkPane.test.tsx`

**Interfaces:**
- `useHomeworkSites()` → `GET /homework/sites` (in `useHomework.ts`, Task 13).
- `HomeworkPane`:
  - "Built-in sites" (read-only, collapsed list with a count)
  - "Allowed for everyone" (add input plus remove)
  - "Never during homework" (block list: add plus remove)
  - Server error text is shown inline.
- `KidHomeworkSites` in KidDetail: "Extra homework sites for {kid}" (add plus
  remove). Hint: "Adds to the family list. Blocked sites stay blocked."

- [ ] **Step 1: Failing tests:**
  - pane renders 3 groups
  - adding a pasted URL posts it raw (the server normalises it) and shows the
    returned domain
  - a 400 message is shown inline
  - remove calls DELETE
  - kid panel posts with `kid_id`
- [ ] **Step 2–4:** Run, implement, then run `npx tsc --noEmit && npm run lint && npx jest`.
- [ ] **Step 5: Commit** `feat(frontend): homework site lists` and `docs(guide): homework mode`.

### Task 15: Frontend — kid request and "Needs you"

**Files:**
- Modify:
  - `frontend/src/v2/kid/modes/StatusBanner.tsx`: request button and homework status
  - `frontend/src/v2/types.ts`: `KidToday.homework`, `homework_pending`; `NeedsItem.type` adds `'homework'`
  - `frontend/src/v2/today/NeedsYouList.tsx:18-24,55`: homework branch with a minutes select
  - `frontend/src/v2/components/bellRules.ts`: `homework_request`
- Create: `frontend/src/v2/hooks/useHomeworkRequest.ts`
- Test: `frontend/tests/v2/homeworkRequest.test.tsx`

**Interfaces:**
- Kid side:
  - When `locked && !homework`: button "Ask for homework time" →
    `api('/kid/homework', {method:'POST', kid:true})`.
  - When pending: chip "Waiting for a parent".
  - When `homework`: banner "Homework mode is on until {time}."
- Parent side:
  - `KIND.homework = {label:'Homework time', icon:'menu_book', tone:'blue'}`.
  - The row has a minutes select (30/60/90/120, default 60) and
    Approve/Decline → `/homework/requests/{id}/approve {minutes}` or `/deny`.
  - "Approve all" includes homework items at 60 min.

- [ ] **Step 1: Failing tests:**
  - kid paused → button shown and posts
  - pending chip
  - homework banner text
  - parent row approve with 90 posts `{minutes:90}`
  - decline posts deny
  - approve-all includes homework
- [ ] **Step 2–4:** Run, implement, then run `npx tsc --noEmit && npm run lint && npx jest`.
- [ ] **Step 5: Commit** `feat(frontend): kid homework requests`.
