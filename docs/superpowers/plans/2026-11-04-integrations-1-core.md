# Integrations framework — implementation plan (part 1 of 5: core)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One secure contract that lets developer-run services mark chores done, hear
app events, take a fixed set of actions and show declarative widgets, with every call
checked against a parent-granted, per-kid permission set.

**Architecture:**
- **Box-side protocol core** in `backend/app/integrations/`. The DB-free modules (`protocol`, `net`, `client`, `permissions`, `manifest`, `trust`, `widgets`) are shared by the box and the simulator CLI. The DB modules (`store`, `apply`, `audit`, `events`, `catalog`, `health`, `loop`) are box only.
- **Pull model.** The box always calls out over a guarded HTTPS client (SSRF checks, IP pin, 443 only, no redirects, caps). Services reply with actions. `apply.py` checks each action against the stored grant, applies it through shared services, and writes an audit row keyed by an idempotency key.
- **Trust root.** The registry Worker signs the catalog and each manifest with Ed25519. The public key is pinned in code. A background loop syncs the catalog, polls services and flushes events.

**Tech Stack:** FastAPI, SQLAlchemy 2, alembic (SQLite), httpx 0.28 (sync), cryptography
(Ed25519, Fernet), pydantic 2; Cloudflare Worker (TS, vitest); Next.js pages router,
React Query, Mantine, jest.

**Spec:** `docs/superpowers/specs/2026-11-04-integrations-design.md` (binding).

**Plan files (tasks numbered continuously):**
1. `2026-11-04-integrations-1-core.md`: Tasks 1–8 (this file: header, constraints, review focus)
2. `2026-11-04-integrations-2-install.md`: Tasks 9–14
3. `2026-11-04-integrations-3-events-actions.md`: Tasks 15–19
4. `2026-11-04-integrations-4-widgets.md`: Tasks 20–24
5. `2026-11-04-integrations-5-local-devkit.md`: Tasks 25–28

## Global Constraints

- **Anti-goal, enforced in code and tested:** integrations can never unlock devices or touch hours, schedules, locks, overrides, screen time, homework or blocker state. The action vocabulary is closed. `request.decide` covers **reward redemptions** (`Redemption.kind == 'reward'`) and **chore check-offs** only. `app/integrations/*` must not import `app.lock`, `app.models.lock`, `app.models.hours`, `app.models.screen_time`, `app.services.screen_time`, `app.api.devices`, `app.api.hours` or any `homework` module (Task 4 test).
- The **manifest is never trusted at runtime.** Runtime checks use the grant stored on the box (`integration_installs.permissions`, `integration_kids`, `integration_chores`). Installs pin the manifest they were installed with. A newer catalog version is ignored until the parent removes and re-adds the integration.
- Every grant is **per kid**. Chore actions are limited to linked chores. Events go out only for linked kids, trimmed to the granted fields.
- **Trust switch** is off by default. It gates only `chore.complete`. `request.decide` is not gated by it. A completion from a kid widget button always goes to "Needs you".
- **Outbound:** HTTPS on port 443 only. Refuse private, loopback, link-local, CGNAT (100.64/10), multicast, reserved, unspecified and IPv4-mapped forms of these. Pin the checked IP for the connection. No redirects. Timeout **5 s** total. Reply cap **256 KiB**. Images: png/jpeg/webp/gif only, **1 MiB** cap.
- **Limits:** poll interval ≥ **60 s**. ≤ **20** actions per reply. ≤ **50** events per batch. ≤ **30** outbound calls/min per install. ≤ **20** parent messages/day per install. ≤ **60** local pushes/min per key. Pause after **5** consecutive failures. Signature clock skew ±**300 s**. Event outbox TTL **24 h**. Catalog sync every **6 h**, with backoff from 60 s doubling to 6 h. Widget cache **60 s**.
- **Secrets:** the per-install HMAC secret is `secrets.token_urlsafe(32)`, sealed with `app.core.crypto.seal(..., purpose="integrations")`. Its key is derived from `SECRET_KEY` in `DATA_DIR/secrets.json`, which lives outside the DB file. Secret-typed settings fields are sent once in `install` and **never stored**. Local push keys are stored only as a sha256 hash.
- **Registry unreachable:** keep the last verified catalog. Installed integrations keep running. Revocations apply on the next successful sync.
- **Notification kinds** (≤ 20 chars): `integration_done`, `integration_msg`, `integration_paused` (one migration, Task 10).
- **Alembic:** Task 3 chains from main's head **`b0c1d2e3f4a5`** (revision `c1d2e3f4a5b6`). Task 10 chains from `c1d2e3f4a5b6` (revision `c2d3e4f5a6b7`). The unmerged homework branch adds `w1a2b3c4d5e6` (also off `b0c1d2e3f4a5`) and the kind `homework_request`. Whichever merges second re-chains its first migration onto the other's head and adds the other's kinds to its `OLD_KINDS`/`KINDS`.
- **Deps:** no new Python or npm deps. Use httpx, cryptography and pydantic (for JSON schema output). Registry signing uses WebCrypto Ed25519.
- Python 3.11 syntax. Ruff line length 100 (`ruff format --check backend blocker && ruff check backend blocker`). Every file stays under 500 lines (`frontend/src/v2/types.ts` is at 483, so new frontend types go in `frontend/src/v2/integrations/types.ts`). Naive-UTC datetimes (`datetime.now(UTC).replace(tzinfo=None)`).
- New models go in `app/models/__init__.py` **and** `app.core.database._import_all_models`. `tests/test_migrations.py` must pass.
- Tests: `cd backend && python -m pytest tests -q`. New backend tests live in `backend/tests/integrations/test_int_*.py` (unique basenames, no `__init__.py`). Frontend: `cd frontend && npm run lint && npm run type-check && npx jest <file>`. Jest is not in CI, so run it locally anyway. Registry: `cd registry && npm run typecheck && npm test`.
- UI copy: plain sentence case, no emojis. No mockup exists for these screens. Reuse the existing pane/card components and `parent-tokens.css` variables (high-risk uses `--p-red`/`--p-redbg`). Screenshot each new screen in light and dark for owner review before merge.
- Commits: semantic (`feat(integrations): …`, `refactor(chores): …`), each ending with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011K7jrVbDK9XkJbLGVTb23M
  ```

## Review Focus

1. **A service retries a reply after a timeout.** The box must not award points twice. The same `idempotency_key` returns the first result and does not apply again. → Task 8 `test_duplicate_key_applies_once`.
2. **A hostname resolves to a public IP at check time and a LAN IP at connect time** (DNS rebinding), or a reply is a 302 to `http://192.168.1.1`. Nothing may reach the LAN. → Task 6 `test_connects_to_pinned_ip` and `test_redirect_is_failure`.
3. **A kid is unlinked, or a chore is deleted, while the integration keeps sending actions for them.** Expect a rejected audit row, not a 500 or a silent apply. → Task 8 `test_unlinked_kid_rejected_after_unlink`.
4. **The registry is down or returns a tampered catalog.** Installed integrations keep working, the old catalog stays, and nothing unsigned is accepted. → Task 11 `test_bad_signature_keeps_previous_catalog`.
5. **An integration approves a screen-time redemption, or a parent decides a request at the same moment an integration does.** The first: rejected, no `Override` rows. The second: one decision wins, the other gets a rejected audit row "already answered". → Task 19 `test_screen_time_never_approvable` and `test_race_with_parent`.

---

### Task 1: Shared chore action service (refactor out of routes)

**Files:**
- Create: `backend/app/services/chore_actions.py`
- Modify: `backend/app/api/chores.py:84-117,207-223` (`approve`, `mark_done`, `send_back` call the service), `backend/app/api/kid.py:252-280` (`done` calls `submit`)
- Test: `backend/tests/integrations/test_int_chore_actions.py`. Existing `tests/test_chores_api.py` and kid tests must pass unchanged.

**Interfaces — Produces:**
- `tick_all(run: ChoreRun, by_id: int | None, now: datetime) -> None`: adds a `RunStepTick` for every unticked step.
- `submit(run: ChoreRun, by_id: int | None, now: datetime) -> None`: status `"submitted"`, `submitted_at=now`, `submitted_by_id=by_id`.
- `approve(db: Session, run: ChoreRun, by_id: int | None) -> int`: everything `approve` does now (status done, approved/completed_at, `clear_note`, `award_chore`, `chat.system("Approved · +N")`, badges, `kid_events.chore_decided(..., True)`). Returns points. Does **not** commit.
- `send_back(db: Session, run: ChoreRun, note: str) -> None`: the current `send_back` body, without commit.
- Callers keep their HTTP checks (`_waiting`, race rule, steps/photo checks) and `db.commit()`.

- [ ] **Step 1: Write the failing tests**

```python
def test_approve_awards_points_without_parent(db, parent, kid):
    run = make_run(db, parent, kid, status="submitted", points=7)
    pts = chore_actions.approve(db, run, by_id=None)
    db.commit()
    assert pts >= 7 and run.status == "done" and run.approved_by_id is None
    assert balance(db, kid.id) == pts

def test_tick_all_then_submit(db, parent, kid):
    run = make_run(db, parent, kid, steps=("a", "b"))
    chore_actions.tick_all(run, kid.id, NOW); chore_actions.submit(run, kid.id, NOW)
    assert {t.done_by_id for t in run.ticks} == {kid.id} and len(run.ticks) == 2
    assert run.status == "submitted" and run.submitted_by_id == kid.id

def test_send_back_bumps_attempt(db, parent, kid):
    run = make_run(db, parent, kid, status="submitted", submitted_by=kid)
    chore_actions.send_back(db, run, "Try again")
    assert run.status == "todo" and run.attempt == 2 and run.last_note == "Try again"
```

- [ ] **Step 2: Run** `cd backend && python -m pytest tests/integrations/test_int_chore_actions.py -v`. Expected: FAIL (`ModuleNotFoundError: app.services.chore_actions`).
- [ ] **Step 3: Implement** the four functions by moving the route bodies. Routes become thin wrappers.
- [ ] **Step 4: Run** the new file plus `tests/test_chores_api.py tests/test_kid*.py -q`. Expected: all PASS.
- [ ] **Step 5: Commit** `refactor(chores): extract shared chore action service`

---

### Task 2: Purpose-scoped sealing and settings

**Files:**
- Modify: `backend/app/core/crypto.py`, `backend/app/core/config.py`, `backend/tests/conftest.py:9`
- Test: `backend/tests/integrations/test_int_crypto.py`

**Interfaces — Produces:**
- `seal(text: str, purpose: str = "apprise") -> str`, `unseal(token: str, purpose: str = "apprise") -> str`. Key is `sha256(f"{purpose}:" + SECRET_KEY)`. `_fernet(purpose)` is cached per purpose. Existing Apprise callers stay unchanged.
- Settings: `REGISTRY_URL: str = "https://taskfrce.jmolabs.dev"`, `INTEGRATIONS_LOOP_ENABLED: bool = True`. conftest sets `INTEGRATIONS_LOOP_ENABLED=false`.

- [ ] **Step 1: Write the failing tests**

```python
def test_purposes_are_separate():
    tok = seal("s3cret", purpose="integrations")
    assert unseal(tok, purpose="integrations") == "s3cret"
    with pytest.raises(ValueError):
        unseal(tok)  # apprise key cannot read it

def test_default_purpose_unchanged():
    assert unseal(seal("x")) == "x"
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_crypto.py -v`. Expected: FAIL (`unexpected keyword 'purpose'`).
- [ ] **Step 3: Implement** the signatures above and the two settings.
- [ ] **Step 4: Run** the file plus `tests/test_notify*.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): purpose-scoped secret sealing and settings`

---

### Task 3: Grants, audit and outbox models + migration

**Files:**
- Create: `backend/app/models/integration.py`, `backend/alembic/versions/c1d2e3f4a5b6_integrations.py` (`down_revision = "b0c1d2e3f4a5"`)
- Modify: `backend/app/models/reward.py` (two columns), `backend/app/models/__init__.py`, `backend/app/core/database.py` (`_import_all_models`)
- Test: `backend/tests/integrations/test_int_models.py`; `tests/test_migrations.py`

**Interfaces — Produces:**
- `IntegrationInstall` (`integration_installs`): `id`; `public_id String(32) unique` (uuid4 hex); `source String(8)` CHECK `'catalog'|'local'` (`ck_integration_source`); `integration_id String(40) NULL`; `name String(40)`; `icon String(40)`; `manifest Text NULL` (signed manifest envelope JSON); `settings Text NULL` (JSON, non-secret fields only); `permissions Text NOT NULL` (JSON list); `secret Text NULL` (sealed); `key_hash String(64) NULL unique`; `key_prefix String(12) NULL`; `trusted Boolean default False`; `status String(10)` CHECK `'active'|'paused'|'revoked'|'removed'` (`ck_integration_status`); `paused_reason String(200) NULL`; `failures Integer default 0`; `next_poll_at DateTime NULL`; `created_at`; `created_by_id FK users SET NULL`; `removed_at NULL`. Relationships `kids`, `chores`.
- `IntegrationKid` (`integration_kids`): PK(`install_id` FK CASCADE, `kid_id` FK users CASCADE), `kid_widgets Boolean default False`.
- `IntegrationChore` (`integration_chores`): PK(`install_id` FK CASCADE, `chore_id` FK chores CASCADE).
- `IntegrationAction` (`integration_actions`, the audit log): `id`, `install_id FK CASCADE`, `kind String(24)`, `idempotency_key String(80)`, `result String(8)` CHECK `'applied'|'pending'|'rejected'` (`ck_integration_action_result`), `reason String(200) NULL`, `kid_id`/`chore_id`/`run_id`/`redemption_id` FKs `SET NULL`, `created_at`. `UniqueConstraint(install_id, idempotency_key, name="uq_integration_action_key")`, `Index(install_id, created_at)`.
- `IntegrationEvent` (`integration_events`, the outbox): `id`, `install_id FK CASCADE`, `kind String(24)`, `payload Text`, `created_at`, `attempts Integer default 0`.
- `Reward.integration_install_id` (FK `integration_installs.id` SET NULL, NULL) and `Reward.integration_ref String(64) NULL`, plus `UniqueConstraint(integration_install_id, integration_ref, name="uq_reward_integration_ref")` via `batch_alter_table`.

- [ ] **Step 1: Write the failing tests**

```python
def test_status_check(db):
    db.add(IntegrationInstall(public_id="a"*32, source="catalog", name="X", icon="extension",
                              permissions="[]", status="bogus"))
    with pytest.raises(IntegrityError):
        db.commit()

def test_idempotency_key_unique_per_install(db, install):
    db.add_all([IntegrationAction(install_id=install.id, kind="chore.complete",
                                  idempotency_key="k1", result="applied") for _ in range(2)])
    with pytest.raises(IntegrityError):
        db.commit()
```
(Fixtures go in `backend/tests/integrations/conftest.py` and later tasks reuse them. `install` is an active catalog install named "Demo" with icon "extension", a sealed secret, and permissions `["chores.complete"]`. Later tasks extend the list via `request.param` or by mutating the JSON. It is linked to `kid` and to one chore made with `make_chore`. `run_today` is today's `todo` run of that chore for `kid`. `other_kid` is a second, unlinked kid.)

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_models.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement** the models and migration (`op.create_table` ×5, `batch_alter_table("rewards")`; downgrade drops them).
- [ ] **Step 4: Run** the file plus `tests/test_migrations.py -v`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): grants, audit and outbox tables`

---

### Task 4: Permission vocabulary and engine (DB-free)

**Files:**
- Create: `backend/app/integrations/__init__.py` (empty), `backend/app/integrations/permissions.py`, `backend/app/integrations/protocol.py` (action models only here; Task 7 adds the rest)
- Test: `backend/tests/integrations/test_int_permissions.py`

**Interfaces — Produces:**
- `PERMS: dict[str, Perm]`, where `Perm(text: str, high_risk: bool)` is a frozen dataclass. Exact copy:

| id | text | high_risk |
|---|---|---|
| `kid.name` | Your linked kids' first names | no |
| `events.chore_completed` | When linked chores are done | no |
| `events.request_created` | When linked kids ask for a reward or check off a linked chore | no |
| `events.reward_redeemed` | When linked kids get a reward (name and cost) | no |
| `chores.complete` | Mark linked chores done | no |
| `rewards.manage` | Add, change and remove its own rewards | no |
| `messages.parents` | Send you messages | no |
| `requests.decide` | Approve or deny reward requests and chore check-offs | **yes** |
| `widgets.parent` | Show cards on your screens | no |
| `widgets.kid` | Show cards on your kids' screens | **yes** |

- Fixed line shown on every permission screen (not a permission): "Its own settings, and nothing else unless listed below."
- `protocol.py` action models (pydantic, `extra="forbid"`; every one has `idempotency_key: str` matching `^[A-Za-z0-9._:-]{1,80}$`): `ChoreComplete(type="chore.complete", kid_id: int, chore_id: int)`; `RewardUpsert(type="reward.upsert", ref: str≤64, name: str≤100, price: int 1..100000, icon: str|None ≤40)`; `RewardRemove(type="reward.remove", ref)`; `MessageParents(type="message.parents", title: str≤100, body: str|None ≤300)`; `RequestDecide(type="request.decide", target: Literal["reward","chore"], id: int, approve: bool, note: str|None ≤200)`. `Action = Annotated[Union[...], Field(discriminator="type")]`. `parse_action(raw: dict) -> Action` raises `ValueError("unknown action")` for any other `type`, and `ValueError("bad action")` for validation errors.
- `ACTION_PERM = {"chore.complete": "chores.complete", "reward.upsert": "rewards.manage", "reward.remove": "rewards.manage", "message.parents": "messages.parents", "request.decide": "requests.decide"}`.
- `Origin = Literal["service", "parent_button", "kid_button", "local"]`.
- `@dataclass(frozen=True) Grant(install_id: int, name: str, permissions: frozenset[str], kid_ids: frozenset[int], chore_ids: frozenset[int], kid_widget_ids: frozenset[int], trusted: bool, active: bool)`.
- `class Denied(Exception)` with `.reason: str`.
- `check_action(grant: Grant, action: Action, origin: Origin = "service", actor_kid_id: int | None = None) -> bool` raises `Denied`. It returns `needs_approval`: True iff `chore.complete` and (`not grant.trusted` or `origin == "kid_button"`). Checks run in order with these exact reasons: not active → `"integration is paused"`; permission missing → `"not allowed"`; kid not linked → `"kid not linked"`; chore not linked → `"chore not linked"`; `origin == "kid_button"` with `request.decide` → `"kids can only ask"`; `origin == "kid_button"` and `kid_id != actor_kid_id` → `"kid not linked"`.

- [ ] **Step 1: Write the failing tests**

```python
G = Grant(1, "Demo", frozenset({"chores.complete"}), frozenset({5}), frozenset({9}),
          frozenset(), trusted=False, active=True)

def test_untrusted_completion_needs_approval():
    assert check_action(G, parse_action(cc("k", 5, 9))) is True

def test_trusted_completion_applies():
    assert check_action(replace(G, trusted=True), parse_action(cc("k", 5, 9))) is False

def test_kid_button_never_auto_applies():
    assert check_action(replace(G, trusted=True), parse_action(cc("k", 5, 9)), "kid_button", 5)

@pytest.mark.parametrize("kid,chore,reason", [(6, 9, "kid not linked"), (5, 8, "chore not linked")])
def test_scope(kid, chore, reason):
    with pytest.raises(Denied, match=reason):
        check_action(G, parse_action(cc("k", kid, chore)))

def test_missing_permission():
    with pytest.raises(Denied, match="not allowed"):
        check_action(G, parse_action({"type": "message.parents", "idempotency_key": "k", "title": "hi"}))

@pytest.mark.parametrize("t", ["device.unlock", "hours.set", "lock.off", "homework.start",
                               "blocker.allow", "screen_time.grant", "override.add"])
def test_anti_goal_actions_do_not_exist(t):
    with pytest.raises(ValueError, match="unknown action"):
        parse_action({"type": t, "idempotency_key": "k"})

def test_integrations_never_import_lock_or_homework():
    banned = ("app.lock", "app.models.lock", "app.models.hours", "app.models.screen_time",
              "app.services.screen_time", "app.api.devices", "app.api.hours")
    for path in Path(app.integrations.__file__).parent.glob("*.py"):
        for mod in imported_modules(ast.parse(path.read_text())):
            assert not mod.startswith(banned) and "homework" not in mod, (path.name, mod)

def test_every_action_maps_to_a_permission():
    assert set(ACTION_PERM) == {a.model_fields["type"].default for a in ACTION_MODELS}
    assert set(ACTION_PERM.values()) <= set(PERMS)
```
(`cc(key, kid_id, chore_id) -> dict` lives in `tests/integrations/int_helpers.py` with the other action/widget builders later tasks use (`ru`, `msg`, `rd`, `W`, `card`, `text`, `image`, `button`). `imported_modules` is test-local. `ACTION_MODELS` is the tuple of the five classes, exported from `protocol.py`.)

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_permissions.py -v`. Expected: FAIL (import error).
- [ ] **Step 3: Implement** `permissions.py` and the action half of `protocol.py`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): permission vocabulary and action checks`

---

### Task 5: Manifest model and Ed25519 trust root

**Files:**
- Create: `backend/app/integrations/manifest.py`, `backend/app/integrations/trust.py`
- Test: `backend/tests/integrations/test_int_manifest.py` (+ a `keypair` fixture in `tests/integrations/conftest.py` that monkeypatches `trust.REGISTRY_PUBKEY` and returns a signer)

**Interfaces — Produces:**
- `trust.REGISTRY_PUBKEY: str = ""`: base64 of the raw 32-byte public key. Owner fills it from Task 9's keygen output. It is a code constant only, with no env override. While it is empty, every envelope is `UntrustedError` (fail closed).
- Envelope: `{"payload": "<base64 of JSON bytes>", "sig": "<base64 Ed25519 sig over the payload bytes>"}`. The signature covers the exact decoded bytes, so no canonical JSON is needed.
- `verify_envelope(env: dict) -> dict` returns the parsed payload, or raises `UntrustedError` (missing fields, bad base64, bad signature, non-object JSON). Uses `Ed25519PublicKey.from_public_bytes(...).verify`.
- `Manifest` (pydantic, `extra="forbid"`): `id` `^[a-z0-9][a-z0-9-]{2,39}$`; `name ≤40`; `developer ≤60`; `description ≤300`; `icon` `^[a-z0-9_]{1,40}$` (Material Symbols name only, no remote icons); `version` semver `^\d+\.\d+\.\d+$`; `protocol: Literal["v1"]`; `base_url` (see validator); `poll_seconds: int | None` 60..86400; `settings: list[SettingField]` ≤10; `permissions: list[str]` unique and ⊆ `PERMS`; `widgets: list[WidgetDecl]` ≤6.
- `SettingField(key ^[a-z_]{1,32}$, label ≤60, type Literal["text","username","number","select"], options: list[str] (required iff select, ≤20), secret: bool=False, required: bool=True)`.
- `WidgetDecl(id ^[a-z0-9_]{1,32}$, surface Literal["parent","kid"], title ≤40)`. A `parent` widget requires `widgets.parent`. A `kid` widget requires `widgets.kid`.
- `base_url` validator: `https` scheme, no userinfo/query/fragment, port absent or 443, host is not an IP literal.
- `load_manifest(env: dict) -> Manifest` = `Manifest.model_validate(verify_envelope(env))`.

- [ ] **Step 1: Write the failing tests**

```python
def test_signed_manifest_loads(keypair):
    assert load_manifest(keypair.sign(DEMO)).id == "demo"

def test_tampered_payload_rejected(keypair):
    env = keypair.sign(DEMO); env["payload"] = b64(json.dumps({**DEMO, "name": "Evil"}))
    with pytest.raises(UntrustedError):
        load_manifest(env)

def test_other_key_rejected(keypair):
    with pytest.raises(UntrustedError):
        load_manifest(other_signer().sign(DEMO))

@pytest.mark.parametrize("url", ["http://x.example", "https://x.example:8443",
                                 "https://10.0.0.5", "https://u:p@x.example"])
def test_base_url_rules(url):
    with pytest.raises(ValidationError):
        Manifest.model_validate({**DEMO, "base_url": url})

def test_poll_floor():
    with pytest.raises(ValidationError):
        Manifest.model_validate({**DEMO, "poll_seconds": 59})

def test_kid_widget_needs_permission():
    with pytest.raises(ValidationError):
        Manifest.model_validate({**DEMO, "widgets": [{"id": "w", "surface": "kid", "title": "T"}]})
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_manifest.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `trust.py` and `manifest.py`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): signed manifest model and pinned registry key`

---

### Task 6: Outbound HTTP guard

**Files:**
- Create: `backend/app/integrations/net.py`
- Test: `backend/tests/integrations/test_int_net.py`

**Interfaces — Produces:**
- `@dataclass(frozen=True) OutboundPolicy(https_only=True, port_443_only=True, allow_private=False)`. `STRICT = OutboundPolicy()`. `DEV = OutboundPolicy(False, False, True)` is only for the simulator `--dev` flag.
- `class BlockedError(Exception)` (refused before connecting) and `class FetchError(Exception)` (timeout, size, status, redirect, transport).
- `is_public(ip: ipaddress.IPv4Address | IPv6Address) -> bool`: `ip.is_global`, not in `100.64.0.0/10`, and an IPv4-mapped address is unwrapped first.
- `resolve_pinned(host: str, port: int, policy: OutboundPolicy) -> str`: `socket.getaddrinfo`. Raises `BlockedError` if **any** resolved address fails `is_public` (unless `allow_private`). Otherwise returns the first address.
- `@dataclass GuardedResponse(status: int, content_type: str, body: bytes)`.
- `fetch(method: str, url: str, *, body: bytes | None = None, headers: dict | None = None, policy: OutboundPolicy = STRICT, max_bytes: int = 262_144, timeout: float = 5.0, transport: httpx.BaseTransport | None = None) -> GuardedResponse`. Approach: validate scheme and port per policy, pin the IP with `resolve_pinned`, and rewrite the URL host to that IP (brackets for v6). Send `Host: <host>` and `extensions={"sni_hostname": host}` so TLS verifies the real name. Use `follow_redirects=False`, `httpx.Timeout(timeout)`, and a wall-clock deadline checked while streaming. Abort past `max_bytes`. Any 3xx raises `FetchError("redirect")`. Never send cookies. Send `User-Agent: t@sk4ce-box/1`.

- [ ] **Step 1: Write the failing tests** (monkeypatch `net.socket.getaddrinfo`, inject `httpx.MockTransport`)

```python
@pytest.mark.parametrize("ip", ["127.0.0.1", "10.1.2.3", "192.168.1.1", "169.254.169.254",
                                "100.64.0.1", "::1", "fe80::1", "::ffff:192.168.1.1", "0.0.0.0"])
def test_private_targets_blocked(resolve_to, ip):
    resolve_to(ip)
    with pytest.raises(BlockedError):
        fetch("GET", "https://svc.example/v1/poll")

def test_any_private_answer_blocks(resolve_to):
    resolve_to("93.184.216.34", "10.0.0.1")
    with pytest.raises(BlockedError):
        fetch("GET", "https://svc.example/")

def test_connects_to_pinned_ip(resolve_to, seen):
    resolve_to("93.184.216.34")
    fetch("GET", "https://svc.example/x", transport=seen.transport)
    assert seen.url.host == "93.184.216.34" and seen.headers["host"] == "svc.example"
    assert seen.extensions["sni_hostname"] == "svc.example"

def test_redirect_is_failure(resolve_to):
    resolve_to("93.184.216.34")
    with pytest.raises(FetchError, match="redirect"):
        fetch("GET", "https://svc.example/", transport=reply(302, headers={"location": "http://192.168.1.1"}))

@pytest.mark.parametrize("url", ["http://svc.example/", "https://svc.example:8443/"])
def test_scheme_and_port(url):
    with pytest.raises(BlockedError):
        fetch("GET", url)

def test_size_cap(resolve_to):
    resolve_to("93.184.216.34")
    with pytest.raises(FetchError, match="too large"):
        fetch("GET", "https://svc.example/", transport=reply(200, content=b"x" * 262_145))

def test_dev_policy_allows_loopback_http(resolve_to):
    resolve_to("127.0.0.1")
    assert fetch("GET", "http://localhost:8080/", policy=DEV, transport=reply(200)).status == 200
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_net.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `net.py` as specified.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): SSRF-safe outbound fetch with IP pinning`

---

### Task 7: Wire protocol and box client

**Files:**
- Modify: `backend/app/integrations/protocol.py` (wire models, signing)
- Create: `backend/app/integrations/client.py`
- Test: `backend/tests/integrations/test_int_client.py`; `backend/tests/integrations/fake_service.py` (helper: an `httpx.MockTransport` that verifies the request signature and replies signed. Later tasks and Task 28 reuse it.)

**Interfaces — Produces:**
- `PROTOCOL_VERSION = "v1"`. Endpoints: `POST {base_url}/v1/{install|events|poll|widgets|uninstall}`.
- Request headers: `X-Tsk-Install` (public_id), `X-Tsk-Timestamp` (unix seconds), `X-Tsk-Request-Id` (uuid4 hex), `X-Tsk-Signature: v1=<hex HMAC-SHA256(secret, f"{ts}.{request_id}.".encode() + body)>`.
- Reply: header `X-Tsk-Signature: v1=<hex HMAC-SHA256(secret, f"{request_id}.".encode() + body)>`, and a JSON body with `"request_id"` equal to the request's.
- `sign_request(secret: str, ts: int, request_id: str, body: bytes) -> str`, `sign_reply(secret: str, request_id: str, body: bytes) -> str`, and `verify(sig_header: str, expected: str) -> bool` (`hmac.compare_digest`).
- Request bodies always carry `{"protocol": "v1", "install_id", "request_id", "grant": GrantOut}`, where `GrantOut = {"permissions": [...], "kids": [{"id", "first_name"?}], "chores": [{"id", "title"}]}`. `first_name` appears only with `kid.name`. Extras: install `{"settings": {...}}`; events `{"events": [...]}`; widgets `{"surface", "kid_id"?}`.
- `Reply(request_id: str, actions: list[dict] = [] (max 20))`. `WidgetsReply(request_id, widgets: list[dict])`. Task 20 validates the widget list.
- `@dataclass InstallCtx(public_id: str, base_url: str, secret: str, grant_out: dict)`.
- `class ProtocolError(Exception)`: bad signature, `request_id` mismatch, non-JSON, schema, non-2xx.
- `class BoxClient(ctx: InstallCtx, policy: OutboundPolicy = STRICT, transport=None, now=time.time)` with methods `install(settings: dict) -> Reply`, `events(events: list[dict]) -> Reply`, `poll() -> Reply`, `widgets(surface: str, kid_id: int | None) -> WidgetsReply`, `uninstall() -> None`. Each uses `net.fetch` (max 256 KiB, 5 s).

- [ ] **Step 1: Write the failing tests**

```python
def test_poll_round_trip():
    svc = FakeService(secret="s", actions=[{"type": "chore.complete", "idempotency_key": "a",
                                            "kid_id": 1, "chore_id": 2}])
    r = BoxClient(ctx("s"), policy=DEV, transport=svc.transport).poll()
    assert r.actions[0]["kid_id"] == 1 and svc.last_path == "/v1/poll"
    assert svc.last_signature_ok

def test_reply_signed_with_wrong_secret_rejected():
    svc = FakeService(secret="other")
    with pytest.raises(ProtocolError, match="signature"):
        BoxClient(ctx("s"), policy=DEV, transport=svc.transport).poll()

def test_reply_for_other_request_rejected():
    svc = FakeService(secret="s", request_id_override="stale")
    with pytest.raises(ProtocolError, match="request_id"):
        BoxClient(ctx("s"), policy=DEV, transport=svc.transport).poll()

def test_too_many_actions_is_protocol_error():
    svc = FakeService(secret="s", actions=[act(i) for i in range(21)])
    with pytest.raises(ProtocolError):
        BoxClient(ctx("s"), policy=DEV, transport=svc.transport).poll()

def test_first_name_only_with_permission():
    assert "first_name" not in grant_out_for(perms=[], kids=[KID])["kids"][0]
```
(`grant_out_for` is the pure builder `protocol.grant_out(permissions, kids: list[tuple[int, str]], chores: list[tuple[int, str]]) -> dict`. Add it to Produces.)

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_client.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `protocol.py` additions and `client.py`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): signed v1 protocol and box client`

---

### Task 8: Store, audit with idempotency, and `chore.complete` apply

**Files:**
- Create: `backend/app/integrations/store.py`, `backend/app/integrations/audit.py`, `backend/app/integrations/apply.py`
- Test: `backend/tests/integrations/test_int_apply.py`

**Interfaces — Consumes:** Task 1 `chore_actions`, Task 4 `check_action`/`parse_action`/`Grant`, Task 7 `BoxClient`.
**Interfaces — Produces:**
- `store.load_grant(db, install: IntegrationInstall) -> Grant` (`active = install.status == "active"`).
- `store.new_secret() -> str`, `store.seal_secret(s: str) -> str`, `store.secret_of(install) -> str` (purpose `"integrations"`).
- `store.client_for(db, install) -> BoxClient` (always `STRICT`; uses `protocol.grant_out`).
- `audit.prior(db, install_id: int, key: str) -> IntegrationAction | None`.
- `audit.record(db, install, kind: str, key: str, result: str, reason: str | None = None, **refs) -> IntegrationAction`.
- `@dataclass ActionResult(key: str, result: Literal["applied","pending","rejected"], reason: str | None)`.
- `apply.HANDLERS: dict[str, Handler]`, where `Handler = Callable[[Session, IntegrationInstall, Grant, Action, bool], Outcome]` and `Outcome = tuple[str, str | None, dict]` (result, reason, refs). Phases 3–4 register more handlers here.
- `apply.apply_actions(db, install, raw: list[dict], origin: Origin = "service", actor_kid_id: int | None = None) -> list[ActionResult]`. For each raw action, in order: read the key. If `audit.prior` finds a row, return its result unchanged. Otherwise `parse_action` → `check_action` → handler. `ValueError`/`Denied`/`HTTPException` become a rejected row with the reason. Commit per action. On `IntegrityError` (race on the key), roll back and return the prior row.
- `chore.complete` handler: find today's run for the chore and kid (`ChoreAssignment.chore_id`, `ChoreRun.day == chores.today(db)`, `kid_runs_filter(kid_id)`). Status ≠ `todo` or no run → rejected `"nothing to do today"`. Otherwise `tick_all(run, kid_id, now)` + `submit(run, kid_id, now)`. If `needs_approval`: `inbox.notify_parents(db, "chore_submitted", f"{grant.name}: {kid first name} finished {title}", "Take a look and approve it.", run_id=run.id)` → `pending` (Task 10 switches the kind). Else `chore_actions.approve(db, run, by_id=None)` → `applied`. Refs: `kid_id`, `chore_id`, `run_id`. The audit `created_at` equals the `now` used for `submitted_at` (Task 10 relies on this). Ruling: an integration completion skips the photo requirement. The signal is the proof.

- [ ] **Step 1: Write the failing tests**

```python
def test_untrusted_completion_goes_to_needs_you(db, install, kid, run_today):
    [r] = apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    assert r.result == "pending" and run_today.status == "submitted"
    assert db.query(Notification).filter_by(kind="chore_submitted", run_id=run_today.id).count()

def test_trusted_completion_awards(db, install, kid, run_today):
    install.trusted = True
    [r] = apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    assert r.result == "applied" and run_today.status == "done" and balance(db, kid.id) > 0

def test_duplicate_key_applies_once(db, install, kid, run_today):
    install.trusted = True
    a = cc("k1", kid.id, run_today.chore_id)
    first = apply_actions(db, install, [a]); again = apply_actions(db, install, [a, a])
    assert [x.result for x in again] == [first[0].result] * 2
    assert db.query(Points).filter_by(run_id=run_today.id).count() == 1
    assert db.query(IntegrationAction).count() == 1

def test_unlinked_kid_rejected_after_unlink(db, install, kid, run_today):
    db.query(IntegrationKid).delete(); db.commit()
    [r] = apply_actions(db, install, [cc("k2", kid.id, run_today.chore_id)])
    assert (r.result, r.reason) == ("rejected", "kid not linked") and run_today.status == "todo"

def test_unknown_action_logged_and_nothing_changes(db, install):
    before = db.query(Override).count()
    [r] = apply_actions(db, install, [{"type": "device.unlock", "idempotency_key": "x"}])
    assert (r.result, r.reason) == ("rejected", "unknown action")
    assert db.query(Override).count() == before

def test_one_bad_action_does_not_block_others(db, install, kid, run_today):
    rs = apply_actions(db, install, [{"type": "nope", "idempotency_key": "a"},
                                     cc("b", kid.id, run_today.chore_id)])
    assert [r.result for r in rs] == ["rejected", "pending"]

def test_paused_install_rejects(db, install, kid, run_today):
    install.status = "paused"
    assert apply_actions(db, install, [cc("k", kid.id, run_today.chore_id)])[0].reason == "integration is paused"

def test_secret_sealed_at_rest(db, install):
    s = store.new_secret(); install.secret = store.seal_secret(s)
    assert s not in install.secret and store.secret_of(install) == s and len(s) >= 43
```
(The test file may import `Override` from `app.models.lock`. Only `app/integrations/*` is banned from doing so.)

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_apply.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `store.py`, `audit.py`, `apply.py` as specified.
- [ ] **Step 4: Run** `python -m pytest tests/integrations -v && ruff check backend && ruff format --check backend`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): audited, idempotent action apply with chore completion`

Next: `2026-11-04-integrations-2-install.md` (Task 9).
