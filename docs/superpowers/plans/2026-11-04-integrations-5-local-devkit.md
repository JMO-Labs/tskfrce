# Integrations framework — implementation plan (part 5 of 5: local keys and developer kit)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Home-network sources (Home Assistant, LAN scripts) can push signals with a parent-made local key that only works on the LAN. Developers get a versioned protocol doc, JSON schemas, an example integration, and a box simulator that reuses the box's own client module.

**Spec:** `docs/superpowers/specs/2026-11-04-integrations-design.md`. **Header, Global Constraints and Review Focus:** `2026-11-04-integrations-1-core.md`. Requires Tasks 1–24.

---

### Task 25: Local push keys (LAN only)

**Files:**
- Create: `backend/app/api/integration_local.py` (router `APIRouter(prefix="/api/v1/integration-local", tags=["integrations"])`)
- Modify:
  - `backend/app/main.py` (include router)
  - `backend/app/integrations/protocol.py` (define `PushIn` here from the start, so Task 27's schema export stays DB-free)
  - `frontend/clientIp.js` (export `viaEdge(headers): boolean`, the same token check `clientIp` uses, and `proxied(headers): boolean` = `x-real-ip` **or** `x-edge-token` present at all)
  - `frontend/pages/api/proxy/[...path].ts` (when `proxied(req.headers)` and `rest.startsWith('integration-local/')` → `404 {detail: 'Not found.'}` before forwarding. Caddy always sets `X-Real-IP` and proxies to `127.0.0.1:3000`, so with `EDGE_TOKEN` unset `viaEdge` alone would let edge traffic through as loopback.)
  - No `store.py` change: Task 12's `remove` already skips the uninstall call when `secret is None`, which covers local installs.
- Test: `backend/tests/integrations/test_int_local_keys.py`, `frontend/tests/v2/clientIpEdge.test.ts`; `tests/integrations/conftest.py` gains `local_key` (created via `POST /keys` with `chores.complete` for `kid`; exposes `.id`, `.token`); `int_helpers.py` gains `push(client, token, actions, ip) -> Response`

**Interfaces — Produces:**
- `LOCAL_PERMS = frozenset({"chores.complete", "rewards.manage", "messages.parents", "requests.decide"})`. Events and widgets need an outbound service, so they are not offered.
- `POST /keys` (`require_parent`) with `LocalKeyIn{name: str 1..40, permissions: list[str] ⊆ LOCAL_PERMS (min 1), kid_ids: list[int] (min 1), chore_ids: list[int] = [], trusted: bool = False}` → 201 `{id, token}`. The token is `"tsk_local_" + secrets.token_urlsafe(32)` and is shown once. It creates an `IntegrationInstall(source="local", icon="home", key_hash=sha256(token).hexdigest(), key_prefix=token[:14], secret=None, manifest=None)` with its links. Listing, detail, PATCH (trust), log and DELETE reuse `/api/v1/integrations` (Task 12).
- `is_lan(ip: str) -> bool`: loopback, RFC 1918, IPv6 ULA `fc00::/7`, or link-local. **Not** CGNAT, and not public.
- Dependency `require_local_key(request: Request, authorization: str = Header("")) -> IntegrationInstall`, with checks in this order:
  1. `not is_lan(client_ip(request))` → 403 `"Local keys only work on your home network."`
  2. No `Bearer tsk_local_` prefix, or no active install with that `key_hash` → 401 `"That key isn't valid."`
  3. `ratelimit.limit(f"int-local:{install.id}", 60, 60)` (`app.core.ratelimit`; no new limiter class, the autouse reset clears it) → 429 (catch and re-raise with `"Slow down."`)
- `GET /permissions` (`require_parent`) → `[{id, text, high_risk}]` for `LOCAL_PERMS`, built from `PERMS` (the UI never hard-codes the texts).
- `POST /push` with `protocol.PushIn{actions: list[dict] (max 20)}` → `{"results": [{key, result, reason}]}` via `apply_actions(db, install, actions, origin="local")`.

- [ ] **Step 1: Write the failing tests** (build the client as `TestClient(app, client=("127.0.0.1", 50000))` so the peer is loopback, which is in `TRUSTED_PROXY_IPS`; `push` sets the forwarded IP via `X-Real-IP`)

```python
def test_create_key_returns_token_once_and_stores_hash(client, parent_headers, kid, db):
    r = client.post("/api/v1/integration-local/keys", headers=parent_headers,
                    json={"name": "Home Assistant", "permissions": ["chores.complete"], "kid_ids": [kid.id]})
    tok = r.json()["token"]; row = db.get(IntegrationInstall, r.json()["id"])
    assert tok.startswith("tsk_local_") and row.key_hash == sha256(tok.encode()).hexdigest()
    assert tok not in json.dumps(client.get(f"/api/v1/integrations/{row.id}", headers=parent_headers).json())

def test_push_from_lan_applies(client, local_key, kid, run_today):
    r = push(client, local_key.token, [cc("ha1", kid.id, run_today.chore_id)], ip="192.168.1.50")
    assert r.json()["results"][0]["result"] == "pending"

@pytest.mark.parametrize("ip", ["203.0.113.9", "100.64.1.2", "2001:db8::1"])
def test_push_from_outside_lan_refused(client, local_key, kid, run_today, ip):
    assert push(client, local_key.token, [cc("x", kid.id, run_today.chore_id)], ip=ip).status_code == 403

def test_bad_or_removed_key_401(client, parent_headers, local_key):
    assert push(client, "tsk_local_nope", [], ip="192.168.1.50").status_code == 401
    client.delete(f"/api/v1/integrations/{local_key.id}", headers=parent_headers)
    assert push(client, local_key.token, [], ip="192.168.1.50").status_code == 401

def test_local_key_cannot_unlock(client, local_key):
    r = push(client, local_key.token, [{"type": "device.unlock", "idempotency_key": "u"}], ip="192.168.1.50")
    assert r.json()["results"][0]["reason"] == "unknown action"

def test_local_permissions_list(client, parent_headers):
    r = client.get("/api/v1/integration-local/permissions", headers=parent_headers).json()
    assert {p["id"] for p in r} == LOCAL_PERMS and all(p["text"] == PERMS[p["id"]].text for p in r)

def test_rate_limited_after_60(client, local_key):
    codes = [push(client, local_key.token, [], ip="192.168.1.50").status_code for _ in range(61)]
    assert codes[-1] == 429 and codes[0] == 200

def test_widget_permissions_not_offered(client, parent_headers, kid):
    assert client.post("/api/v1/integration-local/keys", headers=parent_headers,
                       json={"name": "x", "permissions": ["widgets.kid"], "kid_ids": [kid.id]}).status_code == 422
```

```ts
it('viaEdge is true only with the matching edge token', () => {
  process.env.EDGE_TOKEN = 'a'.repeat(64)
  expect(viaEdge({ 'x-edge-token': 'a'.repeat(64), 'x-real-ip': '1.2.3.4' })).toBe(true)
  expect(viaEdge({ 'x-edge-token': 'b'.repeat(64) })).toBe(false); expect(viaEdge({})).toBe(false)
})
it('proxied is true whenever Caddy or the edge touched the request', () => {
  delete process.env.EDGE_TOKEN
  expect(proxied({ 'x-real-ip': '127.0.0.1' })).toBe(true); expect(proxied({ 'x-edge-token': 'x' })).toBe(true)
  expect(proxied({})).toBe(false)
})
```

- [ ] **Step 2: Run** `cd backend && python -m pytest tests/integrations/test_int_local_keys.py -v` and `cd frontend && npx jest tests/v2/clientIpEdge.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the router, the dependency, `PushIn`, `viaEdge`/`proxied`, and the proxy guard.
- [ ] **Step 4: Run** both again, plus `npm run lint && npm run type-check`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): LAN-only local push keys`

---

### Task 26: Local keys UI

**Files:**
- Create: `frontend/src/v2/integrations/LocalKeyForm.tsx`
- Modify: `frontend/src/v2/integrations/IntegrationsPane.tsx` (a "Home network keys" section that lists `source === 'local'` installs, plus a "Create key" button), `frontend/src/v2/integrations/IntegrationDetail.tsx` (for local installs: hide developer/domain; show `"Home network key · {key_prefix}…"`), `frontend/src/v2/hooks/useIntegrations.ts` (`useCreateLocalKey()` via the exported `useInvalidating(fn, ['integrations'])`; `useLocalPermissions()` → `GET /integration-local/permissions`, key `['integrations','local-perms']`), `backend/app/schemas/integration.py` (`InstallOut` adds `key_prefix`), `frontend/src/v2/integrations/types.ts` (`InstallOut.key_prefix?: string | null`)
- Test: `frontend/tests/v2/integrationLocalKeys.test.tsx`

**Interfaces — Produces:**
- `<LocalKeyForm onDone />` has: name; permission checkboxes for the four local permissions, whose texts and risk come from `useLocalPermissions()` (Task 25 `GET /integration-local/permissions`; nothing hard-coded), using the `PermissionList` row style (high-risk in red); kids (min 1); chores (when `chores.complete` is ticked); the trust switch with the Task 14 consequence line. After create it shows the token in a read-only field with a Copy button and the text **"Copy this now. You won't see it again."** It also shows an example: `curl -X POST http://<box>:3000/api/proxy/integration-local/push -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"actions":[...]}'`.

- [ ] **Step 1: Write the failing tests**

```tsx
it('shows the token once after create', async () => {
  apiMock.mockResolvedValueOnce({ id: 9, token: 'tsk_local_abc' })
  /* fill name, tick "Mark linked chores done (it sees their names)", tick Sam, Create */
  expect(screen.getByDisplayValue('tsk_local_abc')).toBeInTheDocument()
  expect(screen.getByText("Copy this now. You won't see it again.")).toBeInTheDocument()
})
it('offers only the four local permissions, as served by the box', () => {  // mock GET /integration-local/permissions
  expect(screen.queryByLabelText("Show cards on your kids' screens")).toBeNull()
  expect(screen.getByLabelText('Approve or deny reward requests and chore check-offs').closest('[data-risk]')).toHaveAttribute('data-risk', 'high')
})
```

- [ ] **Step 2: Run** `cd frontend && npx jest tests/v2/integrationLocalKeys.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the form and the pane section.
- [ ] **Step 4: Run** the same test plus `npm run lint && npm run type-check`. Expected: PASS. Screenshot the form and the token view in light and dark.
- [ ] **Step 5: Commit** `feat(integrations): home network key screens`

---

### Task 27: JSON schemas and protocol doc

**Files:**
- Create: `backend/app/integrations/schemas.py`, `docs/integrations/schemas/{manifest,reply,actions,widgets,local-push}.schema.json` (generated), `docs/integrations/protocol-v1.md`
- Test: `backend/tests/integrations/test_int_schemas.py`

**Interfaces — Produces:**
- `export_schemas() -> dict[str, dict]` keys `manifest` (`Manifest.model_json_schema()`), `reply` (`Reply`), `actions` (`TypeAdapter(Action)`), `widgets` (`TypeAdapter(list[Widget])`), `local-push` (`protocol.PushIn`, defined there by Task 25, so this module stays DB-free).
- CLI `python -m app.integrations.schemas <out_dir>` writes `<key>.schema.json` (`indent=2`, `sort_keys=True`, trailing newline).
- `protocol-v1.md` (< 500 lines) has these sections:
  - Overview and trust model (pull only, signed catalog, permissions enforced on the box)
  - Manifest (fields and limits)
  - Permissions (the Task 4 table, with exact copy)
  - Endpoints, with one request/response example each
  - Signing: the exact HMAC inputs from Task 7 plus a worked example with fixed `secret`/`ts`/`request_id`/body and the resulting hex
  - Replay rules for services: reject skew > 300 s; reject reused `X-Tsk-Request-Id`
  - Actions and their rejection reasons
  - Events and their trimmed fields
  - Widgets (seven blocks, limits, button rules, image rules)
  - Limits table (copied from Global Constraints)
  - Local push keys, with a curl example and a Home Assistant `rest_command` example
  - Versioning: `v1` only grows by optional fields; a breaking change becomes `/v2/…`
  - Getting listed: the owner reviews a PR to `registry/src/catalog.ts`; the example is never listed

- [ ] **Step 1: Write the failing tests**

```python
@pytest.mark.parametrize("name", ["manifest", "reply", "actions", "widgets", "local-push"])
def test_committed_schema_matches_code(name):
    path = REPO / "docs/integrations/schemas" / f"{name}.schema.json"
    assert json.loads(path.read_text()) == export_schemas()[name], "run python -m app.integrations.schemas"

def test_protocol_doc_mentions_whole_vocabulary():
    doc = (REPO / "docs/integrations/protocol-v1.md").read_text()
    for word in [*PERMS, *ACTION_PERM, *EVENT_PERM, "widget.pressed", "X-Tsk-Signature", "X-Tsk-Request-Id"]:
        assert word in doc, word

def test_signing_example_in_doc_is_correct():
    doc = (REPO / "docs/integrations/protocol-v1.md").read_text()
    assert sign_request("example-secret", 1700000000, "0" * 32, b'{"protocol":"v1"}') in doc
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_schemas.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `schemas.py`, generate the files with `cd backend && python -m app.integrations.schemas ../docs/integrations/schemas`, and write the doc.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `docs(integrations): v1 protocol spec and JSON schemas`

---

### Task 28: Example integration and box simulator CLI

**Files:**
- Create: `examples/integration-hello/server.py` (stdlib only), `examples/integration-hello/manifest.json`, `examples/integration-hello/README.md`, `backend/app/integrations/simulator.py`
- Modify:
  - `backend/app/integrations/manifest.py` (the `base_url` validator allows `http`, any host and any port when `info.context == {"dev": True}`; add `load_dev_manifest(path: Path) -> Manifest`, which is unsigned and dev-validated)
  - `backend/app/integrations/client.py` (`last_request` plus `raw_post(path: str, body: bytes, headers: dict) -> GuardedResponse`, used for the replay check)
  - `.github/workflows/ci-cd.yml` (ruff lint/format paths add `examples`)
  - `docs/integrations/protocol-v1.md` (a "Test with the simulator" section)
- Test: `backend/tests/integrations/test_int_simulator.py`; `tests/integrations/conftest.py` gains `example_server` (runs `server.py` in a daemon thread on `127.0.0.1:0`; `.url`) and `lenient_server` (same, with the request-id replay check off; `.manifest`). Both call `resolve_to("127.0.0.1")` so the autouse default (`93.184.216.34`) does not redirect them; `DEMO_DEV_MANIFEST` (in `int_helpers.py`) uses `base_url` `http://127.0.0.1:8787`.

**Interfaces — Produces:**
- Example service on `127.0.0.1:8787` (`python examples/integration-hello/server.py --port 8787`). Manifest id **`hello-example`**, permissions `["chores.complete", "widgets.parent"]`, `poll_seconds` 60, one parent widget `hello`.
  - It verifies the signature, ±300 s skew and request-id replay on every call, and keeps per-install secrets in memory.
  - `/v1/poll`: replies `chore.complete` for every (kid, chore) in `grant`, with `idempotency_key = f"{date}:{kid}:{chore}"` ("always done").
  - `/v1/widgets`: replies a card with text "Hello from the example integration.", a stat "Polls" with its count, and a button `done` "Mark done" with action `chore.complete`.
  - `/v1/events`: on `widget.pressed`, replies `chore.complete` for that kid.
  - `/v1/uninstall`: forgets the install.
  - A request that fails verification → 401.
- `run_simulation(manifest: Manifest, policy: OutboundPolicy, steps: list[str], transport=None, out=print) -> bool`.
  - Fake grant: kids `[(1, "Sam")]`, chores `[(1, "Practice")]`, all of the manifest's permissions, `trusted=True`.
  - Steps (default all, in order): `install`, `poll`, `events` (one sample event per subscribed `events.*` permission), `widgets` (each declared surface), `press` (the first button found), `replay` (re-sends `last_request` byte for byte; PASS only if the service answers non-2xx), `uninstall`.
  - Each reply goes through the same `BoxClient` checks, then `parse_action` + `check_action` per action and `sanitize` for widgets.
  - Prints `PASS <step>` or `FAIL <step>: <reason>` per check. Returns True iff no FAIL.
- CLI: `cd backend && python -m app.integrations.simulator --manifest ../examples/integration-hello/manifest.json --dev [--steps poll,widgets]`. Exit code 0 or 1. Without `--dev` it uses `STRICT` and requires a signed manifest envelope.

- [ ] **Step 1: Write the failing tests** (start `server.py` in a daemon thread on port 0, loaded via `importlib.util.spec_from_file_location`)

```python
def test_example_passes_simulator(example_server, capsys):
    m = load_dev_manifest(EXAMPLE / "manifest.json").model_copy(update={"base_url": example_server.url})
    assert run_simulation(m, DEV, ALL_STEPS) is True
    out = capsys.readouterr().out
    assert "FAIL" not in out and "PASS replay" in out

def test_wrong_secret_service_fails(capsys):
    svc = FakeService(secret="other")
    assert run_simulation(DEMO_DEV_MANIFEST, DEV, ["install"], transport=svc.transport) is False
    assert "FAIL install: bad signature" in capsys.readouterr().out

def test_strict_policy_refuses_localhost(example_server, capsys):
    m = load_dev_manifest(EXAMPLE / "manifest.json").model_copy(update={"base_url": example_server.url})
    assert run_simulation(m, STRICT, ["install"]) is False

def test_service_that_skips_replay_check_fails(lenient_server, capsys):
    run_simulation(lenient_server.manifest, DEV, ["install", "poll", "replay"])
    assert "FAIL replay" in capsys.readouterr().out

def test_simulator_uses_box_client():
    assert simulator.BoxClient is client.BoxClient

def test_dev_manifest_rejected_by_box():
    with pytest.raises(ValidationError):
        Manifest.model_validate(json.loads((EXAMPLE / "manifest.json").read_text()))
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_simulator.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the example, the simulator and the manifest dev context. Write the README: run the server, then run the simulator command above.
- [ ] **Step 4: Run** `python -m pytest tests -q && ruff format --check backend blocker examples && ruff check backend blocker examples`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): example integration and box simulator CLI`

---

## Finish

- [ ] Full suite: `cd backend && python -m pytest tests -q`, `cd frontend && npm run lint && npm run type-check && npx jest`, `cd registry && npm run typecheck && npm test`.
- [ ] Owner tasks (not code): run `registry/scripts/integrations-keygen.mjs`, set the Worker secret, and paste `PUBLIC_RAW_B64` into `trust.REGISTRY_PUBKEY`. Review the light/dark screenshots.
- [ ] Before merging after the homework branch (or vice versa), re-chain the alembic migration per Global Constraints.
