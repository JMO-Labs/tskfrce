# Integrations framework — implementation plan (part 2 of 5: catalog and install)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner curates a signed catalog. Boxes sync it. Parents pick an integration, fill in settings, read the permission screen, connect, set trust, and remove it. Untrusted completions land in "Needs you".

**Spec:** `docs/superpowers/specs/2026-11-04-integrations-design.md`. **Header, Global Constraints and Review Focus:** `2026-11-04-integrations-1-core.md` (binding for every task here). Requires Tasks 1–8.

---

### Task 9: Registry Worker: signed catalog and revoked list

**Files:**
- Create: `registry/src/catalog.ts` (`export const CATALOG: object[] = []`, `export const REVOKED: string[] = []`, edited by the owner via PR), `registry/src/sign.ts`, `registry/scripts/integrations-keygen.mjs`, `registry/test/catalog.test.ts`
- Modify: `registry/src/index.ts` (`Env` gains `INTEGRATIONS_SIGNING_KEY: string`; route `'/api/integrations/catalog': { GET: catalog }`), `registry/test/helpers.ts` (`makeEnv` accepts an optional signing key), `registry/README.md` (keygen + `wrangler secret put INTEGRATIONS_SIGNING_KEY` + "paste the public key into `backend/app/integrations/trust.py`")

**Interfaces — Produces:**
- `signEnvelope(obj: unknown, pkcs8B64: string): Promise<{ payload: string; sig: string }>`. `payload` is base64 of `JSON.stringify(obj)` UTF-8 bytes. `sig` is base64 of `crypto.subtle.sign('Ed25519', key, payloadBytes)`, with the key imported as `pkcs8`.
- `GET /api/integrations/catalog` (public, no auth) → `200` with `signEnvelope({ v: 1, issued_at: new Date().toISOString(), integrations: [envelope per manifest], revoked: REVOKED })` and `Cache-Control: public, max-age=300`. With no key configured → `503 {"error":"catalog unavailable"}`.
- `integrations-keygen.mjs`: `node scripts/integrations-keygen.mjs` prints `PRIVATE_PKCS8_B64=…` and `PUBLIC_RAW_B64=…` (raw 32-byte public key from `exportKey('raw')`).

- [ ] **Step 1: Write the failing tests** (generate a key pair in `beforeAll` with `crypto.subtle.generateKey('Ed25519', true, ['sign','verify'])`. `vi.mock('../src/catalog', () => ({ CATALOG: [DEMO_MANIFEST], REVOKED: [] }))` so the per-manifest loop is not vacuous; the "never lists the example" test imports the real module via `vi.importActual`.)

```ts
it('signs the catalog and every manifest', async () => {
  const res = await handle(new Request('https://x/api/integrations/catalog'), env, fakeCf())
  const outer = await res.json()
  expect(await verify(pub, outer)).toBe(true)
  const body = JSON.parse(atob(outer.payload))
  expect(body.v).toBe(1); expect(Array.isArray(body.revoked)).toBe(true)
  expect(body.integrations).toHaveLength(1)
  for (const m of body.integrations) expect(await verify(pub, m)).toBe(true)
})
it('503 without a signing key', async () => {
  const res = await handle(new Request('https://x/api/integrations/catalog'), { ...env, INTEGRATIONS_SIGNING_KEY: '' }, fakeCf())
  expect(res.status).toBe(503)
})
it('never lists the example integration', async () => {
  const real = await vi.importActual<typeof import('../src/catalog')>('../src/catalog')
  expect(real.CATALOG.map((m: any) => m.id)).not.toContain('hello-example')
})
it('POST is 405', async () => {
  expect((await handle(new Request('https://x/api/integrations/catalog', { method: 'POST' }), env, fakeCf())).status).toBe(405)
})
```

- [ ] **Step 2: Run** `cd registry && npm test -- catalog`. Expected: FAIL (route 404).
- [ ] **Step 3: Implement** `sign.ts`, `catalog.ts`, the route, and the keygen script.
- [ ] **Step 4: Run** `cd registry && npm run typecheck && npm test`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(registry): signed integrations catalog and revoked list`

---

### Task 10: Notification kinds, "Needs you" routing, bell pending

**Files:**
- Create: `backend/alembic/versions/c2d3e4f5a6b7_integration_kinds.py` (`down_revision = "c1d2e3f4a5b6"`; `OLD_KINDS` = current `KINDS`; `KINDS = (*OLD_KINDS, "integration_done", "integration_msg", "integration_paused")`; template `a8b9c0d1e2f3_device_hints.py`)
- Modify: `backend/app/models/inbox.py` (`KINDS`), `backend/app/services/notify.py:54` (`KIND_EVENT["integration_done"] = "chore_ok"`; the other two stay bell-only), `backend/app/integrations/apply.py` (pending completion uses `integration_done`), `backend/app/integrations/store.py`, `backend/app/api/family.py:92-140` (`_needs_you`), `backend/app/api/inbox.py:103` (pending for `integration_done`)
- Test: `backend/tests/integrations/test_int_needs_you.py`; `tests/test_migrations.py`, `tests/test_today_payload.py`, `tests/test_inbox.py`; `backend/tests/integrations/test_int_apply.py` (Task 8's `test_untrusted_completion_goes_to_needs_you` now asserts `kind="integration_done"`); `int_helpers.py` gains `bell_item(client, headers, kind) -> dict` (the newest `GET /api/v1/notifications` row of that kind)

**Interfaces — Produces:**
- `store.pending_by_run(db, runs: list[ChoreRun]) -> dict[int, dict]` maps `run_id` → `{"id": install.id, "name": install.name, "icon": install.icon}`. It covers submitted runs that have an `IntegrationAction(result="pending", kind="chore.complete", run_id=…)` with `created_at >= run.submitted_at`. One query.
- `_needs_you` item for those runs: same fields as a chore item, but `"type": "integration"` and `"integration": {id, name, icon}`. Approve and send back use the existing `/chores/{id}/approve|send-back`.
- Bell: `integration_done` rows are `pending` while `run.status == "submitted"`. `path_for` is unchanged (`/?chore={run_id}`).

- [ ] **Step 1: Write the failing tests**

```python
def test_pending_completion_is_integration_item(client, parent_headers, db, install, kid, run_today):
    apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    items = client.get("/api/v1/today", headers=parent_headers).json()["needs_you"]
    [it] = [i for i in items if i["id"] == run_today.id]
    assert it["type"] == "integration" and it["integration"] == {"id": install.id, "name": "Demo", "icon": "extension"}

def test_kid_resubmit_after_send_back_is_plain_chore(client, parent_headers, db, install, kid, run_today):
    apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    chore_actions.send_back(db, run_today, "redo"); db.commit()
    chore_actions.submit(run_today, kid.id, utcnow() + timedelta(seconds=1)); db.commit()
    [it] = [i for i in client.get("/api/v1/today", headers=parent_headers).json()["needs_you"] if i["id"] == run_today.id]
    assert it["type"] == "redo"

def test_bell_item_pending_until_decided(client, parent_headers, db, install, kid, run_today):
    apply_actions(db, install, [cc("k1", kid.id, run_today.chore_id)])
    n = bell_item(client, parent_headers, kind="integration_done")
    assert n["pending"] is True
    client.post(f"/api/v1/chores/{run_today.id}/approve", headers=parent_headers)
    assert bell_item(client, parent_headers, kind="integration_done")["pending"] is False
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_needs_you.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the migration, kinds, `pending_by_run`, `_needs_you` branch and inbox pending.
- [ ] **Step 4: Run** the file plus `tests/test_migrations.py tests/test_today_payload.py tests/test_inbox.py tests/integrations -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): needs-you routing and notification kinds`

---

### Task 11: Box catalog sync, revocation, background loop

**Files:**
- Create: `backend/app/integrations/catalog.py`, `backend/app/integrations/loop.py`
- Modify: `backend/app/main.py:273-315` (start `integrations_task` when `settings.INTEGRATIONS_LOOP_ENABLED`; cancel on shutdown, like `lock_task`), `backend/app/integrations/store.py` (`retire`)
- Test: `backend/tests/integrations/test_int_catalog.py`; `tests/integrations/conftest.py` gains `registry` (a `MockTransport` registry: `.serve(env)`, `.fail()`, `.transport`) and `keypair.catalog(...)`. The autouse `resolve_to` (Task 6) keeps `REGISTRY_URL` off real DNS.

**Review focus:** the registry is down or returns a tampered catalog. Installed integrations keep working, the old catalog stays, and nothing unsigned is accepted. → `test_bad_signature_keeps_previous_catalog`.

**Interfaces — Produces:**
- `@dataclass(frozen=True) Catalog(issued_at: datetime, manifests: dict[str, tuple[Manifest, dict]], revoked: frozenset[str])`. The tuple holds the parsed manifest and its envelope.
- `catalog_path() -> Path` = `settings.DATA_DIR / "integrations" / "catalog.json"` (raw outer envelope, mode 0600, atomic write via tmp + `os.replace`).
- `parse_catalog(env: dict) -> Catalog`. It verifies the outer envelope (`UntrustedError` propagates). A single manifest that fails verification or validation is skipped and logged, and the rest still load.
- `cached() -> Catalog | None`: re-verifies on every load. Returns None when missing or untrusted.
- `sync(db, now: datetime, transport=None) -> bool`: GET `{settings.REGISTRY_URL}/api/integrations/catalog` via `net.fetch` (STRICT, `max_bytes=1_048_576`). On any error, or when the new `issued_at` is older than the cached one (rollback), keep the cache and return False. On success: write the cache, then for every install with `integration_id in revoked` and status `active|paused`, call `store.retire(db, install, "revoked")` and notify parents `integration_paused`, title `f"{name} was turned off"`, body `"t@sk4ce turned it off for safety. Its history is kept."`. Return True.
- `store.retire(db, install, status: str) -> None` (shared with Task 12 `remove`): sets `status`, `secret=None`, `Reward.active=False` for rewards with `integration_install_id == install.id`, and deletes its `IntegrationEvent` rows. Task 20 adds `widget_service.forget(install.id)` here. Audit rows are kept. The caller commits.
- `class SyncSchedule`: `due(now) -> bool` and `mark(ok: bool, now)`. Every 6 h on success. On failure the delay starts at 60 s and doubles up to 6 h.
- `loop.TICK_SECONDS = 15`. `loop._run_once(now: datetime) -> None` opens `SessionLocal()` and runs the steps in `STEPS: list[Callable[[Session, datetime], None]]` (catalog sync first; Tasks 16–17 append). Each step is wrapped like `lock/loop.py` (`OperationalError` "database is locked" → warn; others logged), and the session is closed in `finally`. `async def run_forever()` loops `await asyncio.to_thread(_run_once, now)` then `await asyncio.sleep(TICK_SECONDS)`.

- [ ] **Step 1: Write the failing tests** (use the `keypair` fixture and a `MockTransport` registry. `tmp_path` is monkeypatched as `DATA_DIR`.)

```python
def test_sync_caches_and_lists(db, keypair, registry):
    registry.serve(keypair.catalog([DEMO]))
    assert sync(db, NOW, transport=registry.transport) is True
    assert "demo" in cached().manifests

def test_bad_signature_keeps_previous_catalog(db, keypair, registry):
    registry.serve(keypair.catalog([DEMO])); sync(db, NOW, transport=registry.transport)
    registry.serve(other_signer().catalog([]))
    assert sync(db, NOW, transport=registry.transport) is False
    assert "demo" in cached().manifests

def test_registry_down_keeps_installs_running(db, install, registry):
    registry.fail()
    assert sync(db, NOW, transport=registry.transport) is False and install.status == "active"

def test_revocation_disables_install_and_drops_secret(db, keypair, registry, install):
    registry.serve(keypair.catalog([DEMO], revoked=["demo"])); sync(db, NOW, transport=registry.transport)
    db.refresh(install)
    assert install.status == "revoked" and install.secret is None
    assert db.query(Notification).filter_by(kind="integration_paused").count() >= 1

def test_revocation_removes_rewards_and_events(db, keypair, registry, install):
    db.add(Reward(name="Owned", price=5, integration_install_id=install.id, integration_ref="r1"))
    db.add(IntegrationEvent(install_id=install.id, kind="chore.completed", payload="{}")); db.commit()
    registry.serve(keypair.catalog([DEMO], revoked=["demo"])); sync(db, NOW, transport=registry.transport)
    assert db.query(Reward).filter_by(integration_ref="r1").one().active is False
    assert db.query(IntegrationEvent).count() == 0

def test_older_catalog_is_ignored(db, keypair, registry):
    registry.serve(keypair.catalog([DEMO], issued_at=T2)); sync(db, NOW, transport=registry.transport)
    registry.serve(keypair.catalog([], issued_at=T1))
    assert sync(db, NOW, transport=registry.transport) is False and "demo" in cached().manifests

def test_backoff_doubles_to_six_hours():
    s = SyncSchedule(); t = NOW
    delays = []
    for _ in range(12):
        s.mark(False, t); delays.append((s.next_at - t).total_seconds()); t = s.next_at
    assert delays[:3] == [60, 120, 240] and max(delays) == 21600
```
(The `keypair.catalog(...)` helper builds the outer envelope the way Task 9 does. Add it to `tests/integrations/conftest.py`.)

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_catalog.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `catalog.py`, `loop.py`, and the `main.py` wiring.
- [ ] **Step 4: Run** the file plus `tests/test_health*.py -q` (startup with the loop disabled). Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): verified catalog sync with revocation and backoff`

---

### Task 12: Install / uninstall / settings API

**Files:**
- Create: `backend/app/api/integrations.py` (router `APIRouter(prefix="/api/v1/integrations", tags=["integrations"], dependencies=[Depends(require_parent)])`), `backend/app/schemas/integration.py`
- Modify: `backend/app/main.py` (include router), `backend/app/integrations/store.py` (`remove`)
- Test: `backend/tests/integrations/test_int_install_api.py`; `tests/integrations/conftest.py` gains `synced_catalog` (writes a `keypair`-signed cache holding `DEMO`) and `svc` (a `FakeService` patched in via `monkeypatch.setattr(store, "_transport", svc.transport)`; DNS via the autouse `resolve_to`); `int_helpers.py` gains `install_body(kid, **over) -> dict` and `db_install(id) -> IntegrationInstall`; `fake_service.py` gains `.fail()` (every call answers 500) and `.last_body` (parsed JSON of the last request)

**Interfaces — Produces (HTTP):**
- `GET /catalog` → `[CatalogItem]`: `{id, name, developer, description, icon, version, domain (host of base_url), settings: [SettingField], permissions: [{id, text, high_risk}], widgets: [WidgetDecl], installed: bool}`. Revoked entries are excluded. With no cache → `503 "We couldn't load the list yet. Try again in a minute."`.
- `POST ""` with `InstallIn{integration_id: str, settings: dict[str, str | int], kid_ids: list[int] (min 1), chore_ids: list[int] = [], kid_widget_ids: list[int] = [], accepted_permissions: list[str]}` → `201 InstallOut`. Order of checks:
  1. Not in the catalog, or revoked → 404 `"That integration isn't available."`
  2. An active/paused install of the same id exists → 409 `"That's already connected."`
  3. `set(accepted_permissions) != set(manifest.permissions)` → 409 `"The permissions changed. Look them over again."`
  4. Settings checked against the fields → 422 `{"detail": "<label> is required" | "<label> must be a number" | "<label> isn't one of the choices"}`. Strings ≤ 200 chars.
  5. `kid_ids` must be kids. `chore_ids` must exist. `kid_widget_ids ⊆ kid_ids` and need `widgets.kid`. Otherwise 422.
  6. Build `public_id=uuid4().hex`, `secret=store.new_secret()` and `grant_out` in memory, then call `BoxClient(InstallCtx(public_id, manifest.base_url, secret, grant_out), transport=store._transport).install(all settings)` **before** any `db.add`/flush, so no SQLite write lock is held during the 5 s call. Any `ProtocolError | FetchError | BlockedError` → 502 `"{name} didn't answer. Nothing was connected."` with nothing written. On success add the install (`manifest=json.dumps(envelope)`, the pinned signed envelope from the catalog; `integration_id`, `name`, `icon`; sealed secret, non-secret settings JSON, permissions JSON, links), set `next_poll_at = now` if `poll_seconds`, then commit.
  Ruling: actions in the install reply are ignored.
- `GET ""` → `[InstallOut]` (status ≠ `removed`): `{id, source, integration_id, name, icon, status, paused_reason, trusted, kid_ids, created_at}`.
- `GET /{id}` → `InstallDetail` = `InstallOut` + `{permissions: [{id,text,high_risk}], kids: [{id, name, kid_widgets}], chores: [{id, title}], settings: dict (non-secret), domain, developer}`. `domain` and `developer` come from the pinned `install.manifest`; both are None when `manifest is None` (local installs).
- `PATCH /{id}` with `InstallPatch{trusted: bool | None, kid_widget_ids: list[int] | None, resume: bool | None}`. `resume` works only from `paused` (sets active and failures 0); from `revoked` → 409 `"t@sk4ce turned this one off."`. `kid_widget_ids` needs `widgets.kid` granted and must be ⊆ linked kids, else 422.
- `DELETE /{id}` → 204 via `store.remove(db, install, now)`: best-effort `client.uninstall()` (errors logged, never raised), **skipped when `install.secret is None`** (local and revoked installs), then `store.retire(db, install, "removed")` (Task 11: secret dropped, rewards inactive, events deleted, audit kept) and `removed_at=now`.
- `GET /{id}/log?limit=50` (max 200) → newest first `[{kind, result, reason, kid_name, chore_title, created_at}]`.
- Kids and parents without the parent role → 403 (router dependency).

- [ ] **Step 1: Write the failing tests** (fixtures as listed under Files)

```python
def test_install_happy_path(client, parent_headers, synced_catalog, svc, kid):
    r = client.post("/api/v1/integrations", headers=parent_headers, json=install_body(kid))
    assert r.status_code == 201 and svc.last_path == "/v1/install"
    row = db_install(r.json()["id"])
    assert row.trusted is False and row.secret and svc.last_body["settings"]["username"] == "sam"
    assert "api_key" not in (row.settings or "")  # secret field never stored
    assert (row.integration_id, row.name) == ("demo", "Demo") and load_manifest(json.loads(row.manifest)).id == "demo"
    assert client.get(f"/api/v1/integrations/{row.id}", headers=parent_headers).json()["developer"] == DEMO["developer"]

def test_permission_mismatch_409(client, parent_headers, synced_catalog, kid):
    body = install_body(kid, accepted_permissions=["chores.complete"])
    assert client.post("/api/v1/integrations", headers=parent_headers, json=body).status_code == 409

def test_service_down_leaves_nothing(client, parent_headers, synced_catalog, svc, kid, db):
    svc.fail()
    assert client.post("/api/v1/integrations", headers=parent_headers, json=install_body(kid)).status_code == 502
    assert db.query(IntegrationInstall).count() == 0

def test_kid_cannot_install(client, kid_headers, synced_catalog, kid):
    assert client.post("/api/v1/integrations", headers=kid_headers, json=install_body(kid)).status_code == 403

def test_uninstall_keeps_log_and_drops_secret_and_rewards(client, parent_headers, db, install, svc):
    db.add(Reward(name="Owned", price=5, integration_install_id=install.id, integration_ref="r1")); db.commit()
    assert client.delete(f"/api/v1/integrations/{install.id}", headers=parent_headers).status_code == 204
    db.refresh(install)
    assert install.secret is None and install.status == "removed"
    assert db.query(Reward).filter_by(integration_ref="r1").one().active is False
    assert client.get(f"/api/v1/integrations/{install.id}/log", headers=parent_headers).status_code == 200

def test_uninstall_when_service_down_still_removes(client, parent_headers, install, svc):
    svc.fail()
    assert client.delete(f"/api/v1/integrations/{install.id}", headers=parent_headers).status_code == 204

def test_remove_after_revoke_skips_uninstall(client, parent_headers, db, install, svc):
    install.status, install.secret = "revoked", None; db.commit()
    assert client.delete(f"/api/v1/integrations/{install.id}", headers=parent_headers).status_code == 204
    assert svc.last_path is None  # no uninstall call without a secret

def test_kid_toggle_requires_permission(client, parent_headers, install, kid):
    r = client.patch(f"/api/v1/integrations/{install.id}", headers=parent_headers, json={"kid_widget_ids": [kid.id]})
    assert r.status_code == 422  # install lacks widgets.kid

def test_trust_toggle_and_resume(client, parent_headers, db, install):
    install.status = "paused"; db.commit()
    r = client.patch(f"/api/v1/integrations/{install.id}", headers=parent_headers, json={"trusted": True, "resume": True})
    assert r.json()["trusted"] is True and r.json()["status"] == "active"
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_install_api.py -v`. Expected: FAIL (404s).
- [ ] **Step 3: Implement** the router, schemas, and `store.remove`. Use Task 8's `store._transport` seam for every `BoxClient`. Declare `GET /catalog` before `GET /{id}`.
- [ ] **Step 4: Run** `python -m pytest tests/integrations -q && ruff check backend`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): install, settings, trust and uninstall API`

---

### Task 13: Frontend: catalog, install flow, permission screen

**Files:**
- Create: `frontend/src/v2/integrations/types.ts`, `frontend/src/v2/hooks/useIntegrations.ts`, `frontend/src/v2/integrations/IntegrationsPane.tsx`, `frontend/src/v2/integrations/InstallFlow.tsx`, `frontend/src/v2/integrations/PermissionList.tsx`, `frontend/src/v2/integrations/integrations.css`
- Modify: `frontend/src/v2/manage/settingsSections.ts` (`S` adds `'integrations'`; entry `{ id: 'integrations', label: 'Integrations', description: 'Connect other apps', icon: 'extension' }`), `frontend/src/v2/manage/SettingsPage.tsx` (`{section === 'integrations' && <IntegrationsPane />}`), `frontend/src/v2/hooks/useRewards.ts` (`export` the private `useInvalidating(fn, keys: string[])`; behaviour unchanged)
- Test: `frontend/tests/v2/integrationsInstall.test.tsx`; `frontend/tests/v2/SettingsList.test.tsx` still passes.

**Interfaces — Produces:**
- Types mirroring Task 12: `CatalogItem`, `PermissionOut {id; text; high_risk}`, `SettingFieldOut`, `InstallOut`, `InstallDetail` (includes `domain: string | null`, `developer: string | null`), `AuditRow`.
- Hooks: `useCatalog()` (key `['integrations','catalog']`), `useInstalls()` (`['integrations']`), `useInstall(id)` (`['integrations', id]`), `useInstallIntegration()`, `usePatchIntegration(id)`, `useRemoveIntegration(id)`, `useIntegrationLog(id)`. Mutations use `useInvalidating(fn, ['integrations', 'today', 'rewards'])` imported from `useRewards.ts` (it takes top-level key strings).
- `<PermissionList perms={PermissionOut[]} />` renders the fixed line "Its own settings, and nothing else unless listed below." and then one row per permission. High-risk rows get `data-risk="high"`, the class using `--p-red`/`--p-redbg`, and a "High risk" tag.
- `<InstallFlow item={CatalogItem} onDone />` has three steps:
  1. Settings form. A `secret` field renders `type="password"`, `number` renders a number input, `select` renders a Select.
  2. "Who is this for?" Kid checkboxes (min 1). If `chores.complete` is listed, a chore picker. If `widgets.kid` is listed, a per-kid "Show cards on {kid}'s screens" toggle.
  3. Permission screen. Heading `"{name} will be able to:"`, `<PermissionList>`, a `"Talks to {domain}"` line, and a "By {developer}" line. Primary button "Connect" posts `accepted_permissions = item.permissions.map(p => p.id)`.
  Errors use `toastFail(errorText(e))`.
- `<IntegrationsPane />`: `PaneHead` "Integrations", a "Connected" list (`InstallOut` rows with name, icon and a status chip: Active / Paused / Turned off), and an "Add" list from the catalog (installed ones hidden). Empty catalog: `EmptyState` "Nothing to add yet."

- [ ] **Step 1: Write the failing tests** (mock `@/v2/api` like `RequireParent.test.tsx`)

```tsx
it('marks high-risk permissions in red with a label', async () => {
  render(<PermissionList perms={[{ id: 'requests.decide', text: 'Approve or deny reward requests and chore check-offs', high_risk: true }]} />)
  const row = screen.getByText(/Approve or deny/).closest('[data-risk]')
  expect(row).toHaveAttribute('data-risk', 'high'); expect(within(row!).getByText('High risk')).toBeInTheDocument()
})
it('secret settings are password inputs', async () => { /* step 1 of InstallFlow */ expect(screen.getByLabelText('API key')).toHaveAttribute('type', 'password') })
it('Connect needs a kid and sends the exact permissions', async () => {
  // fill settings → next → no kid ticked: Next disabled → tick Sam → next → Connect
  expect(apiMock).toHaveBeenCalledWith('/integrations', expect.objectContaining({ method: 'POST',
    body: expect.objectContaining({ kid_ids: [3], accepted_permissions: ['chores.complete', 'requests.decide'] }) }))
})
it('shows the domain it talks to', () => { expect(screen.getByText('Talks to svc.example.com')).toBeInTheDocument() })
it('settings list has an Integrations section', () => { expect(SETTINGS_SECTIONS.map(s => s.id)).toContain('integrations') })
```

- [ ] **Step 2: Run** `cd frontend && npx jest tests/v2/integrationsInstall.test.tsx`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** the components and hooks above.
- [ ] **Step 4: Run** `npx jest tests/v2/integrationsInstall.test.tsx tests/v2/SettingsList.test.tsx && npm run lint && npm run type-check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): catalog, install flow and permission screen`

---

### Task 14: Frontend: detail (trust, log, remove), "Needs you" item, bell

**Files:**
- Create: `frontend/src/v2/integrations/IntegrationDetail.tsx`
- Modify: `frontend/src/v2/integrations/IntegrationsPane.tsx` (open detail), `frontend/src/v2/types.ts:230` (`NeedsItem.type` adds `'integration'`; `integration?: { id: number; name: string; icon: string }`), `frontend/src/v2/today/NeedsYouList.tsx:18` (`KIND.integration = { label: 'From an integration', icon: 'extension', tone: 'lav' }`; the row shows the integration's icon and `"via {name}"` and reuses the chore approve / send back buttons), `frontend/src/v2/components/bellRules.ts` (`NEEDS_KINDS` adds `'integration_done'`; `severity`: `integration_done` → `{ name: 'extension', tone: 'lv' }`, `integration_paused` → `{ name: 'extension_off', tone: 'md' }`, `integration_msg` → `{ name: 'extension', tone: 'ok' }`)
- Test: `frontend/tests/v2/integrationsDetail.test.tsx`, `frontend/tests/v2/bellRules.test.ts` (extend)

**Interfaces — Produces:**
- `<IntegrationDetail id={number} onClose />` contains:
  - Header with name and icon. "By {developer} · Talks to {domain}" from `InstallDetail.developer` / `.domain` (Task 12; both null for local installs, which Task 26 handles).
  - `<PermissionList>`.
  - "Trust automatically" switch. When on, the line below reads exactly: **"Its chore check-offs will count right away, without your OK."** When off: "Its chore check-offs wait in Needs you."
  - Paused banner `"Paused: {paused_reason}"` with a "Try again" button (`PATCH {resume: true}`). Revoked banner: "t@sk4ce turned this one off."
  - Linked kids and chores (read-only).
  - "Activity" log list showing result chips Applied / Waiting for you / Rejected, plus the reason.
  - "Remove" with confirm text `"Remove {name}? It stops right away. Its rewards and cards go away. Its history stays."`

- [ ] **Step 1: Write the failing tests**

```tsx
it('trust switch shows the consequence line and PATCHes', async () => {
  await user.click(screen.getByRole('switch', { name: 'Trust automatically' }))
  expect(screen.getByText('Its chore check-offs will count right away, without your OK.')).toBeInTheDocument()
  expect(apiMock).toHaveBeenCalledWith('/integrations/7', expect.objectContaining({ method: 'PATCH', body: { trusted: true } }))
})
it('paused integration offers Try again', async () => { /* detail status paused */ await user.click(screen.getByRole('button', { name: 'Try again' }))
  expect(apiMock).toHaveBeenCalledWith('/integrations/7', expect.objectContaining({ body: { resume: true } })) })
it('needs-you row names the integration', () => { /* NeedsYouList with type integration */ expect(screen.getByText('via Demo')).toBeInTheDocument() })
// bellRules.test.ts
it('integration_done is a needs-you kind', () => { expect(isNeedsYou({ kind: 'integration_done', pending: true } as InboxItem)).toBe(true) })
```

- [ ] **Step 2: Run** `npx jest tests/v2/integrationsDetail.test.tsx tests/v2/bellRules.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** the same tests plus `tests/v2/bell.test.tsx`, then `npm run lint && npm run type-check`. Expected: PASS. Then screenshot the pane, the install flow and the detail in light and dark for owner review.
- [ ] **Step 5: Commit** `feat(integrations): detail screen, trust switch, needs-you item`

Next: `2026-11-04-integrations-3-events-actions.md` (Task 15).
