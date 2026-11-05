# Onboarding phase 2: claim code, kid enrollment and installable pages — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only the person holding the box's sticker can create the first parent. Each kid
signs in on their own phone by scanning a one-time QR. Parent and kid pages install to
the home screen like an app. Boxes installed with `install.sh` keep working unchanged.

**Architecture:**
- **Claim code** lives in `.env` as `CLAIM_CODE`. The backend checks it, server-side, on
  `POST /api/v1/setup` and on a new `POST /api/v1/setup/claim`, behind a per-IP growing
  lockout. No `CLAIM_CODE` → no gate (IP-mode boxes, spec section 8).
- **Kid enrollment:** a parent mints a single-use 24 h token (only its sha256 is stored).
  The kid page trades it for a **device session**: a long-lived random secret, stored
  hashed in `kid_devices`. Kid access JWTs minted from it carry `sid`; deleting the row
  ("Remove") makes those JWTs fail on the next request.
- **PWA:** two static manifests (`/` for parents, `/kid` for kids), PNG icons, and a
  ~30-line service worker that only serves an offline page for navigations. It never
  caches `/api`.
- Fragments (`#claim=`, `#enroll=`) carry the secrets in QR URLs, so they never reach a
  server or an access log. The page posts them in a JSON body and strips the hash.

**Tech stack:** FastAPI + SQLAlchemy + Alembic (Python 3.11, ruff 100), segno (already
used for QR SVG), Next.js 16 pages router + Mantine 9 + TanStack Query, jest +
Testing Library, Playwright (light/dark screenshot projects), POSIX sh + shellcheck.

**Spec:** `docs/superpowers/specs/2026-11-04-easy-onboarding-design.md` (sections 4, 5, 6,
the launch half of 7, and 8; build-order item 2). Phase 1 plan:
`docs/superpowers/plans/2026-11-04-onboarding-p1-hostname-tls.md`.

**Plan files:** this file (Global Constraints, Review Focus, Tasks 1–7: backend and box
scripts) and `2026-11-05-onboarding-p2-claim-enroll-part2.md` (Tasks 8–14: PWA, UI, docs,
owner check, self-review).

## Global Constraints

- Claim code: Crockford base32 alphabet `0123456789ABCDEFGHJKMNPQRSTVWXYZ`, exactly **10**
  characters (50 bits), stored un-grouped; shown grouped `K7M2Q-XA9PB`. Input is
  normalized: upper-case, drop spaces and `-`, map `O→0`, `I→1`, `L→1`.
- Claim code stays valid until the first parent account exists (`FamilySettings.owner_id`
  set). Then it is refused with 409. It is separate from the setup Wi-Fi password.
- Claim failures: **5 per minute per client IP**, then a lockout of 60 s that doubles on
  each further lockout (60, 120, 240 … capped at 3600 s). Lockout memory per IP is
  forgotten 24 h after its last failure. Only failures count.
- Claim compare: `hmac.compare_digest` on normalized strings. Never log the code.
- Enrollment token: `secrets.token_urlsafe(24)`. Store `sha256` hex only. **Single-use,
  expires 24 h** after issue. Issuing a new token for a kid voids that kid's older unused
  tokens. Only a signed-in parent can issue. No limit on devices per kid.
- Device session secret: `secrets.token_urlsafe(32)`, sha256 stored. It expires after
  **180 days without use** (sliding). Remove = delete the row; the kid's next request → 401.
- Secrets in URLs: only in the **fragment** (`/setup#claim=…`, `/kid#enroll=…`). The page
  strips it with `history.replaceState` before any request and sends it in a POST body.
  Never put a token in a query string, path or log line.
- QR 2 (sticker) URL: `https://<box-id>.taskfrce.jmolabs.dev/setup#claim=<code>`.
  Kid QR URL: `${BOX_URL}/kid#enroll=<token>`. Never generate `http://…taskfrce.jmolabs.dev`.
- The gate, enrollment and install hints must work over plain `http://<lan-ip>:3000`
  (IP mode). Only installing waits for HTTPS.
- Wizard: 8 steps. 1 You, 2 Family, 3 Kids, **4 Kids' phones (new, skippable)**, 5 Chores,
  6 Devices, 7 Hours, 8 Remote access (optional). Backend `LAST_STEP = 8`.
- UI: v3 tokens and existing classes only. **No new colors.** Light and dark. Every UI task
  saves light and dark screenshots (phone 390×844 and desktop 1280×800) for owner review,
  compared side by side with the named mockup in
  `docs/superpowers/specs/2026-10-24-v3-redesign-mockups/`.
- Copy: short sentences, no jargon (no "token", "IP", "DNS", "PWA" in UI text).
- Alembic: the new migration chains from main's head **`b0c1d2e3f4a5`**. Re-chain rule:
  `feat/integrations` (PR #60: `c1d2e3f4a5b6`, `c2d3e4f5a6b7`) and `feat/homework-mode`
  also chain from `b0c1d2e3f4a5`. Whichever merges later rebases and sets its first
  migration's `down_revision` to main's head at that moment; `cd backend && alembic heads`
  must print exactly one head before merge.
- Files < 500 lines. Python 3.11, `ruff format --check backend blocker && ruff check backend
  blocker` clean, line length 100. Frontend `npm run lint`, `npm run type-check`, `npm test`.
- Semantic commits. Every commit message ends with exactly:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011K7jrVbDK9XkJbLGVTb23M
  ```

## Review Focus

1. **A parent types the sticker code by hand**: lower-case, with a space or dash, `O` for
   zero. It must be accepted. Task 1 test `test_normalize_forgives_typing`.
2. **One kid QR scanned twice** (a sibling's phone, a screenshot, two taps at once). Exactly
   one phone gets in; the other sees "expired or already used". Task 7 tests
   `test_redeem_twice_second_gets_410` and `test_redeem_race_one_winner`.
3. **A parent taps Remove while the kid is using the phone.** The kid's next request is 401,
   and the kid page shows "Ask a parent for a new code" instead of looping refreshes.
   Task 7 `test_removed_phone_access_token_401`, Task 10 jest `refresh failure clears the device`.
4. **The kid QR opened over plain HTTP** (IP-mode box, or the cert isn't issued yet).
   Sign-in still works; the kid sees no install text; the parent finish screen explains why.
   Task 10 jest `insecure: kid hint hidden`, Task 11 jest `insecure: parent sees why`.
5. **A box updated mid-wizard** with a saved step ≥ 4 resumes on the same screen after the
   wizard grows from 7 to 8 steps. Task 5 test `test_setup_step_shifts_past_new_step`.

---

### Task 1: Claim-code core and growing lockout

**Files:**
- Create: `backend/app/core/claim.py` (≤ 50 lines)
- Create: `backend/app/core/lockout.py` (≤ 80 lines)
- Modify: `backend/app/core/config.py` (add `CLAIM_CODE` after `BOX_URL`, line ~31)
- Modify: `backend/tests/conftest.py:22-25` (autouse fixture also calls `lockout.reset()`)
- Test: `backend/tests/test_claim.py`, `backend/tests/test_lockout.py`

**Interfaces:**
- Produces:
  - `config.Settings.CLAIM_CODE: str | None = None`, with a `field_validator` that
    normalizes it and raises `ValueError("CLAIM_CODE must be 10 Crockford base32 chars")`
    when it does not match `^[0-9A-HJKMNP-TV-Z]{10}$`. Empty string → `None` (compose
    passes `CLAIM_CODE=` on IP-mode boxes).
  - `claim.normalize(raw: str) -> str`
  - `claim.matches(raw: str | None) -> bool` (False when `settings.CLAIM_CODE` is unset or
    `raw` is None; constant-time compare)
  - `claim.required(db: Session) -> bool`: `settings.CLAIM_CODE` set and no owner yet.
  - `lockout.check(key: str) -> None`: raises `HTTPException(429, detail)` while locked.
    Detail: `"Too many tries. Wait {n} minute(s) and try again."` (`n` = minutes left,
    rounded up; "minute" when 1).
  - `lockout.fail(key: str) -> None`, `lockout.reset() -> None`.
  - Module constants `FAILS = 5`, `WINDOW = 60`, `BASE = 60`, `CAP = 3600`,
    `FORGET = 86400`, and `_now = time.monotonic` (tests monkeypatch it).

- [ ] **Step 1: Write failing tests.**
  ```python
  @pytest.mark.parametrize("typed", ["k7m2q-xa9pb", "K7M2Q XA9PB", " k7m2qxa9pb ", "K7M2QXA9PB"])
  def test_normalize_forgives_typing(typed, cfg):  # cfg sets settings.CLAIM_CODE = "K7M2QXA9PB"
      assert claim.matches(typed)
  def test_normalize_maps_lookalikes():
      assert claim.normalize("oIl-O") == "0110"
  ```
  Also:
  - `test_wrong_code_false`, `test_none_false`, `test_unset_setting_false`
    (`CLAIM_CODE=None` → `matches("K7M2QXA9PB") is False`).
  - `test_required_until_owner(db, cfg)`: True on an empty DB; False after
    `FamilySettings.owner_id` is set; False when `CLAIM_CODE` is None.
  - `test_settings_rejects_bad_code`: `Settings(CLAIM_CODE="short")` raises; `"k7m2q-xa9pb"`
    is stored as `"K7M2QXA9PB"`.
  - `test_lockout.py` (monkeypatch `lockout._now` to a list-backed clock):
    - 4 fails → `check` passes; 5th fail → `check` raises 429 with `"Wait 1 minute"`.
    - After 61 s it passes again; 5 more fails → locked 120 s (`"Wait 2 minutes"`).
    - Lockout is capped: after 8 lockouts the wait is 3600 s.
    - 24 h after the last fail, the strike count is forgotten (next lockout is 60 s again).
    - Keys are independent (`claim:a` locked, `claim:b` not).
- [ ] **Step 2: Run** `cd backend && python -m pytest tests/test_claim.py tests/test_lockout.py -q`.
  Expected: FAIL (modules missing).
- [ ] **Step 3: Implement** `claim.py`, `lockout.py` and the setting. Lockout state:
  `dict[str, tuple[deque[float], int, float, float]]` (fails, strikes, locked_until,
  last_fail) under a `threading.Lock`, pruned like `ratelimit._sweep` above 1000 keys.
- [ ] **Step 4: Run** the tests, then `ruff format --check backend && ruff check backend`.
  Expected: pass.
- [ ] **Step 5: Commit** `feat(setup): claim code check and growing lockout`

### Task 2: Setup API claim gate

**Files:**
- Modify: `backend/app/api/setup.py` (133 lines; stays < 200)
- Test: `backend/tests/test_setup_claim.py`; update `backend/tests/test_setup.py` only where
  `LAST_STEP` 7 is asserted.

**Interfaces:**
- Consumes: `claim.matches`, `claim.required`, `lockout.check`, `lockout.fail` (Task 1).
- Produces:
  - `GET /api/v1/setup` → `{"needed": bool, "claim": bool}`; `claim = claim.required(db)`.
  - `POST /api/v1/setup/claim` body `{"code": str}` (`max_length=32`):
    - 409 `DONE` once an owner exists.
    - 204 when no `CLAIM_CODE` is configured, or the code matches.
    - 403 `CLAIM_WRONG = "That code doesn't match this box. Check the sticker and try again."`
      plus `lockout.fail`.
    - Lockout key `f"claim:{client_ip(request)}"`; `lockout.check` runs first.
  - `SetupIn.claim_code: str | None = Field(None, max_length=32)`. `run_setup` keeps its 409
    check first, then (only when `claim.required(db)`) the same check/fail/403 as above,
    before creating the user.
  - `LAST_STEP = 8`.

- [ ] **Step 1: Write failing tests** (`cfg` fixture sets `settings.CLAIM_CODE`):
  ```python
  def test_status_reports_claim(client, cfg):
      assert client.get("/api/v1/setup").json() == {"needed": True, "claim": True}
  def test_setup_without_code_403_no_user(client, db, cfg): ...   # POST /setup, no claim_code -> 403, User count 0
  def test_setup_with_code_201(client, cfg): ...                   # claim_code "k7m2q-xa9pb" -> 201
  def test_claim_endpoint_204_and_403(client, cfg): ...
  def test_sixth_wrong_try_429_even_with_right_code(client, cfg): ...  # 5 wrong -> 6th (right) is 429
  def test_claim_after_owner_409(client, cfg): ...                 # after setup, /setup/claim -> 409
  def test_no_claim_code_setting_no_gate(client): ...              # CLAIM_CODE None: claim False, setup 201 without code
  def test_step_8_accepted_9_rejected(client, parent_headers): ...
  ```
  Also assert the 403 response body never contains the configured code.
- [ ] **Step 2: Run** `python -m pytest tests/test_setup_claim.py tests/test_setup.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.** Share one helper `_check_claim(request, code) -> None` between
  both routes.
- [ ] **Step 4: Run** the two test files and ruff. Expected: pass.
- [ ] **Step 5: Commit** `feat(setup): require the box claim code before the first parent`

### Task 3: Box scripts and compose: `CLAIM_CODE`, HTTPS ntfy URL

**Files:**
- Modify: `registry/scripts/new-box.sh` — also generate and print the claim code and QR 2 URL.
- Create: `registry/scripts/test-new-box.sh` (stubs `npx` on `PATH`; ≤ 60 lines)
- Modify: `scripts/enable-hostname.sh` — optional `CLAIM_CODE` env var; write
  `NTFY_PUBLIC_URL=https://<id>.taskfrce.jmolabs.dev:2443`.
- Modify: `scripts/test-enable-hostname.sh`
- Modify: `docker-compose.prod.yml` backend `environment:` add `CLAIM_CODE: ${CLAIM_CODE:-}`
- Modify: `blocker/tests/test_compose.py` (one test)
- Modify: `.github/workflows/ci-cd.yml` installer job: shellcheck and run `test-new-box.sh`.

**Interfaces:**
- `new-box.sh` output, in this order, once:
  `BOX_ID=…`, `BOX_SECRET=…`, `CLAIM_CODE=<10 chars>`,
  `STICKER_QR2=https://<id>.taskfrce.jmolabs.dev/setup#claim=<code>`.
  Code: `LC_ALL=C tr -dc '0-9ABCDEFGHJKMNPQRSTVWXYZ' </dev/urandom | head -c 10`.
  The claim code is **not** sent to the registry (it never leaves the box and sticker).
- `enable-hostname.sh`: when `CLAIM_CODE` is set in the environment, validate it against
  `^[0-9A-HJKMNP-TV-Z]{10}$` (after upper-casing and dropping `-`) and write it; when unset,
  keep any existing `CLAIM_CODE` line. Always replace `NTFY_PUBLIC_URL`. Undo text gains
  `CLAIM_CODE` and `NTFY_PUBLIC_URL`.
- Backend: an empty `CLAIM_CODE=` from compose must mean "unset": Task 1's validator maps
  `""` to `None`.

- [ ] **Step 1: Write failing tests.**
  - `test-new-box.sh`: stub `npx` logs argv. Output has a `CLAIM_CODE=` line matching the
    alphabet and length 10; `STICKER_QR2` ends with `#claim=<that code>`; the `npx` log
    never contains the claim code.
  - `test-enable-hostname.sh`: `CLAIM_CODE=k7m2q-xa9pb` → file has `CLAIM_CODE=K7M2QXA9PB`
    and `NTFY_PUBLIC_URL=https://abc123.taskfrce.jmolabs.dev:2443`; a second run without
    `CLAIM_CODE` keeps it; `CLAIM_CODE=BAD` → non-zero exit, file untouched.
  - `test_compose.py::test_prod_backend_passes_claim_code`: backend env has `CLAIM_CODE`.
  - `backend/tests/test_claim.py::test_empty_setting_is_unset`: `Settings(CLAIM_CODE="")`
    → `None`.
- [ ] **Step 2: Run** `bash registry/scripts/test-new-box.sh; bash scripts/test-enable-hostname.sh;
  cd blocker && python -m pytest tests/test_compose.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the three commands, `shellcheck` on all four scripts, and
  `cd backend && python -m pytest tests/test_claim.py -q`. Expected: pass.
- [ ] **Step 5: Commit** `feat(scripts): claim code on new boxes; ntfy over the HTTPS hostname`

### Task 4: ntfy public URL never uses `http://` on a box hostname

**Files:**
- Modify: `backend/app/services/push.py:20-25` (`public_url`)
- Test: `backend/tests/test_push.py`

**Interfaces:**
- `push.public_url() -> str | None`: unchanged when `NTFY_PUBLIC_URL` is set. Otherwise, when
  `BOX_URL` is `https://…`, return `f"https://{host}:2443"`; keep the `http://{host}:{port}`
  form for `http` BOX_URLs.

- [ ] **Step 1: Write failing test** `test_public_url_https_box_uses_2443`: `BOX_URL=
  "https://abc123.taskfrce.jmolabs.dev"`, `NTFY_PUBLIC_URL=None` →
  `"https://abc123.taskfrce.jmolabs.dev:2443"`. Keep the existing http test.
- [ ] **Step 2: Run** `python -m pytest tests/test_push.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python -m pytest tests/test_push.py tests/test_kid_push.py -q`. Expected:
  pass. The kid ntfy QR link then has no `&secure=false`.
- [ ] **Step 5: Commit** `fix(push): ntfy link uses the HTTPS edge port on hostname boxes`

### Task 5: Models and migration: enrollment tokens, kid devices, wizard step shift

**Files:**
- Create: `backend/app/models/kid_device.py` (≤ 50 lines)
- Modify: `backend/app/models/__init__.py` (import both classes)
- Create: `backend/alembic/versions/o2b3c4d5e6f7_kid_enrollment.py`
  (`revision = "o2b3c4d5e6f7"`, `down_revision = "b0c1d2e3f4a5"`)
- Test: `backend/tests/test_enroll_migration.py` (pattern: `test_hours_migration.py`)

**Interfaces:**
- Produces (pattern: `app/models/password_reset.py`):
  - `KidEnrollToken` (`kid_enroll_tokens`): `id` int pk; `kid_id` FK `users.id`
    `ondelete=CASCADE`, index; `token_hash` String(64) unique not null; `created_by_id` FK
    `users.id` `ondelete=SET NULL` nullable; `created_at` DateTime not null; `expires_at`
    DateTime not null; `used_at` DateTime nullable.
  - `KidDevice` (`kid_devices`): `id` int pk; `kid_id` FK `users.id` CASCADE, index;
    `secret_hash` String(64) unique not null; `label` String(40) not null; `created_at`
    DateTime not null; `last_seen_at` DateTime not null.
  - Naive UTC datetimes, like `deps.touch_active`.
- Migration `upgrade()`: create both tables, then
  `UPDATE family_settings SET setup_step = setup_step + 1 WHERE setup_step >= 4`.
  `downgrade()`: `UPDATE … SET setup_step = setup_step - 1 WHERE setup_step >= 5`, then drop
  both tables.

- [ ] **Step 1: Write failing tests.**
  - `test_tables_created`: upgrade to head; both tables and the `token_hash` / `secret_hash`
    unique indexes exist (`sqlite_master`).
  - `test_setup_step_shifts_past_new_step`: at `b0c1d2e3f4a5`, set `family_settings.setup_step
    = 4` → upgrade → 5; a row at 3 stays 3; `NULL` stays `NULL`.
  - `test_downgrade_round_trip`: upgrade then downgrade to `b0c1d2e3f4a5` restores 4 and
    drops the tables.
  - `tests/test_migrations.py` still passes (single head).
- [ ] **Step 2: Run** `python -m pytest tests/test_enroll_migration.py tests/test_migrations.py -q`.
  Expected: FAIL.
- [ ] **Step 3: Implement** the models and migration.
- [ ] **Step 4: Run** the tests, `alembic heads` (one head: `o2b3c4d5e6f7`), and ruff.
  Expected: pass.
- [ ] **Step 5: Commit** `feat(db): kid enrollment tokens and kid device sessions`

### Task 6: Parent API: issue a kid QR, list and remove phones

**Files:**
- Create: `backend/app/services/kid_enroll.py` (≤ 150 lines; Task 7 adds to it)
- Create: `backend/app/api/kid_enroll.py` (`parent_router`; Task 7 adds `kid_router`)
- Modify: `backend/app/main.py:155-157` (include the router next to `kid_push_router`)
- Test: `backend/tests/test_kid_enroll_parent.py`

**Interfaces:**
- Consumes: `KidEnrollToken`, `KidDevice` (Task 5); `kids._kid(db, kid_id)` (404 helper used
  by `kid_push.py`); `segno` SVG pattern from `kid_push._out`.
- Produces (service):
  - `ENROLL_TTL = timedelta(hours=24)`
  - `hash_token(raw: str) -> str` (sha256 hex)
  - `issue(db: Session, kid: User, by: User) -> tuple[str, datetime]`: marks the kid's
    unused, unexpired tokens `used_at=now`, inserts a new row, commits, returns
    `(raw_token, expires_at)`.
  - `enroll_url(raw: str) -> str`: `f"{settings.BOX_URL.rstrip('/')}/kid#enroll={raw}"`.
- Produces (routes, `prefix="/api/v1/kids"`, `require_parent`):
  - `POST /{kid_id}/enroll` → 201 `{"url": str, "qr_svg": str, "expires_at": "…Z"}`
    (`utc_z` from `app.schemas.lock`). 409 `"Set BOX_URL on the box first."` when
    `BOX_URL` is unset.
  - `GET /{kid_id}/phones` → `[{"id", "label", "created_at", "last_seen_at"}]`, newest first.
  - `DELETE /{kid_id}/phones/{phone_id}` → 204; 404 `"We couldn't find that phone."` when
    the row is missing or belongs to another kid.

- [ ] **Step 1: Write failing tests** (`cfg` sets `BOX_URL="https://abc123.taskfrce.jmolabs.dev"`):
  ```python
  def test_issue_returns_fragment_url_and_qr(client, kid, parent_headers, db, cfg):
      r = client.post(f"/api/v1/kids/{kid.id}/enroll", headers=parent_headers)
      assert r.status_code == 201
      url = r.json()["url"]
      assert url.startswith("https://abc123.taskfrce.jmolabs.dev/kid#enroll=")
      assert "?" not in url and r.json()["qr_svg"].startswith("<svg")
      raw = url.split("#enroll=")[1]
      row = db.query(KidEnrollToken).one()
      assert row.token_hash == hash_token(raw) and raw not in row.token_hash
  def test_reissue_voids_previous(...): ...      # two issues -> first row used_at set
  def test_kid_cannot_issue_403(client, kid, kid_headers, cfg): ...
  def test_unknown_kid_404(...): ...
  def test_no_box_url_409(...): ...
  def test_list_and_remove_phone(...): ...       # seed a KidDevice; GET lists it; DELETE 204; GET []
  def test_remove_other_kids_phone_404(...): ...
  ```
- [ ] **Step 2: Run** `python -m pytest tests/test_kid_enroll_parent.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the test file and ruff. Expected: pass.
- [ ] **Step 5: Commit** `feat(kids): parent issues one-time phone codes and removes phones`

### Task 7: Kid API: redeem a code, refresh the session, instant revocation

**Files:**
- Modify: `backend/app/services/kid_enroll.py`
- Modify: `backend/app/api/kid_enroll.py` (add `kid_router`, `prefix="/api/v1/kid"`; include it
  in `main.py`)
- Modify: `backend/app/core/auth.py` (`AuthService.get_current_user`, ~line 186)
- Test: `backend/tests/test_kid_enroll_kid.py`

**Interfaces:**
- Consumes: Task 5 models, Task 6 `hash_token`; `ratelimit.check/hit`; `client_ip`.
- Produces (service):
  - `SESSION_IDLE = timedelta(days=180)`
  - `device_label(ua: str) -> str`: `"iPhone"`, `"iPad"`, `"Android phone"` (Android +
    `Mobile`), `"Android tablet"`, else `"Phone or computer"`.
  - `redeem(db, raw: str, ua: str) -> tuple[User, KidDevice, str] | None`. A compare-and-set
    `UPDATE kid_enroll_tokens SET used_at=now WHERE token_hash=? AND used_at IS NULL AND
    expires_at > now` must hit exactly 1 row (same lock idea as `setup.claim_owner`). It
    returns None if the kid is missing or inactive. On success it inserts a `KidDevice` and
    returns the raw device secret.
  - `refresh(db, raw_device: str) -> tuple[User, KidDevice] | None`. None if the row is
    missing, idle more than `SESSION_IDLE` (it deletes the row), or the kid is inactive.
    It stamps `last_seen_at` at most every 5 minutes (`deps.ACTIVE_EVERY`).
  - `access_for(auth: AuthService, kid: User, dev: KidDevice) -> str`:
    `create_access_token(data={"sub": str(kid.id), "sid": dev.id})`.
- Produces (routes):
  - `POST /api/v1/kid/enroll` body `{"token": str}` (`max_length=64`) → 200
    `{"access_token", "device_token", "kid": {"id", "full_name", "avatar"}}`; 410
    `ENROLL_GONE = "This code has expired or was already used. Ask a parent for a new one."`.
    Failures counted with `check/hit` on `f"enroll:{ip}"`, 10 per 60 s.
  - `POST /api/v1/kid/session` body `{"device_token": str}` (`max_length=64`) → 200
    `{"access_token"}`; 401 `PHONE_REMOVED = "This phone was removed. Ask a parent for a new
    code."`. Failures on `f"kidsess:{ip}"`, 10 per 60 s.
- `get_current_user`: if the payload has `sid`, return None unless a `KidDevice` with that id
  **and** `kid_id == user.id` exists. Tokens without `sid` (parents, IP-based kid login) are
  unchanged.

- [ ] **Step 1: Write failing tests:**
  ```python
  def test_redeem_signs_kid_in(client, kid, db): ...          # issue via service; POST /kid/enroll -> 200; GET /kid/today with access_token -> 200
  def test_redeem_twice_second_gets_410(client, kid, db): ...
  def test_redeem_race_one_winner(db, kid): ...               # two redeem() calls on separate sessions (shared engine) -> exactly one non-None
  def test_expired_token_410(client, kid, db, monkeypatch): ...   # expires_at in the past
  def test_voided_token_410(...): ...                         # issue twice; first raw -> 410
  def test_inactive_kid_410(...): ...
  def test_label_from_user_agent(): ...                       # iPhone / iPad / Android phone / Android tablet / other
  def test_session_refresh_returns_new_access(client, kid, db): ...
  def test_removed_phone_access_token_401(client, kid, db, parent_headers): ...
      # redeem -> DELETE /kids/{id}/phones/{pid} -> GET /kid/today with the old access_token -> 401
      # and POST /kid/session -> 401 PHONE_REMOVED
  def test_idle_180_days_401_and_row_deleted(...): ...
  def test_parent_token_unaffected(client, parent_headers): ...   # GET /auth/me -> 200
  def test_enroll_failures_rate_limited(client): ...          # 10 bad tokens -> 11th 429
  def test_token_never_in_url_routes(): ...                   # no route path in fastapi_app contains "{token}" under /api/v1/kid
  ```
- [ ] **Step 2: Run** `python -m pytest tests/test_kid_enroll_kid.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python -m pytest tests -q` (whole backend suite: auth changed) and ruff.
  Expected: pass.
- [ ] **Step 5: Commit** `feat(kid): sign in a kid's phone from a one-time code; revocable sessions`

Continue with `2026-11-05-onboarding-p2-claim-enroll-part2.md`.
