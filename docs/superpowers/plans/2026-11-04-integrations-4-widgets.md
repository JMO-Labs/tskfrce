# Integrations framework — implementation plan (part 4 of 5: widgets)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrations show declarative cards on parent screens, and on kid screens if the parent allows it per kid. Cards are rendered by t@sk4ce's own components, framed with the integration's name and icon. Images go through the box proxy. Buttons map only to granted actions.

**Spec:** `docs/superpowers/specs/2026-11-04-integrations-design.md`. **Header, Global Constraints and Review Focus:** `2026-11-04-integrations-1-core.md`. Requires Tasks 1–19.

**Routing ruling:** widget endpoints use their own prefix, `/api/v1/integration-widgets`, so they never collide with `/api/v1/integrations/{id}`.

---

### Task 20: Widget schema, sanitizer, parent widgets endpoint

**Files:**
- Create: `backend/app/integrations/widgets.py` (DB-free schema and sanitizer), `backend/app/integrations/widget_service.py` (fetch and cache), `backend/app/api/integration_widgets.py` (router `APIRouter(prefix="/api/v1/integration-widgets", tags=["integrations"])`)
- Modify: `backend/app/main.py` (include router), `backend/app/api/integrations.py` (`DELETE` and `PATCH` call `widget_service.forget(install.id)`)
- Test: `backend/tests/integrations/test_int_widgets.py`

**Interfaces — Produces:**
- Blocks (pydantic, `extra="forbid"`, discriminated on `type`). Strings are plain text and are never parsed as markup.
  - `card{title: str≤60 | None, children: list[Block] ≤20}`
  - `text{text: str≤200, tone: Literal["normal","muted","good","warn"]="normal", link: str | None}`. `link` must be `https`, with no userinfo.
  - `list{items: list[str≤100] ≤10}`
  - `stat{label ≤40, value ≤20}`
  - `progress{label ≤40, value: float ≥0, max: float >0}`
  - `image{url: https str, alt ≤100}`
  - `button{id ^[a-z0-9_]{1,32}$, label ≤30, action: Literal[*ACTION_PERM]}`
- `Widget{id: str, root: Block}`. Limits: nesting depth ≤ 3, ≤ 40 blocks per widget, ≤ 6 widgets per reply.
- `sanitize(raw: list[dict], decls: list[WidgetDecl], surface: Literal["parent","kid"], grant: Grant) -> tuple[list[dict], set[str]]` returns the clean widgets and the image URLs seen.
  - Drop any widget whose `id` is not declared for `surface`, or that fails validation (logged).
  - Drop any button whose action's permission is not granted.
  - On `kid`, also drop `request.decide` buttons.
  - Raise `ProtocolError("bad widgets")` when the input is non-empty and **every** widget was dropped.
- `widget_service.TTL = 60`.
- `widget_service.get(db, install, surface, kid_id: int | None, now: float) -> list[dict]`. It caches per `(install.id, surface, kid_id)`. On a miss it runs `health.guarded_call(db, install, lambda c: c.widgets(surface, kid_id))` and then `sanitize`. A None or error result gives `[]`. Every `image.url` is rewritten to `/integration-widgets/{install.id}/image?u={quote(url, safe='')}`.
- `widget_service.image_allowed(install_id: int, url: str) -> bool` (the URL is in a live cache entry). `widget_service.button(install_id, surface, kid_id, widget_id, button_id) -> dict | None`. `widget_service.forget(install_id) -> None`.
- `GET /api/v1/integration-widgets?surface=parent` (`require_parent`) → `[{install_id, name, icon, widgets: [...]}]`. Covers active installs with `widgets.parent`. Installs with no widgets are omitted.

- [ ] **Step 1: Write the failing tests**

```python
def test_sanitize_keeps_known_blocks_and_drops_ungranted_buttons():
    out, imgs = sanitize([W("w1", card(text("Hi"), image("https://cdn.example/a.png"),
                                       button("b1", "request.decide")))], DECLS, "parent", GRANT_NO_DECIDE)
    kinds = [b["type"] for b in out[0]["root"]["children"]]
    assert kinds == ["text", "image"] and imgs == {"https://cdn.example/a.png"}

@pytest.mark.parametrize("bad", [{"type": "html", "html": "<b>x</b>"}, {"type": "text", "text": "x", "onclick": "y"},
                                 {"type": "image", "url": "http://cdn.example/a.png", "alt": ""},
                                 {"type": "text", "text": "x", "link": "javascript:alert(1)"}])
def test_unsafe_blocks_rejected(bad):
    with pytest.raises(ProtocolError):
        sanitize([W("w1", bad)], DECLS, "parent", GRANT)

def test_undeclared_or_wrong_surface_dropped():
    out, _ = sanitize([W("kid_only", text("x")), W("w1", text("ok"))], DECLS, "parent", GRANT)
    assert [w["id"] for w in out] == ["w1"]

def test_depth_and_size_caps():
    with pytest.raises(ProtocolError):
        sanitize([W("w1", card(card(card(card(text("deep"))))))], DECLS, "parent", GRANT)

def test_kid_surface_never_has_decide_buttons():
    out, _ = sanitize([W("kid_w", card(button("b", "request.decide"), button("c", "chore.complete")))],
                      DECLS, "kid", GRANT_ALL)
    assert [b["action"] for b in out[0]["root"]["children"]] == ["chore.complete"]

def test_parent_endpoint_frames_with_name_and_proxies_images(client, parent_headers, widget_install, svc):
    svc.widgets = [W("w1", image("https://cdn.example/a.png"))]
    [g] = client.get("/api/v1/integration-widgets?surface=parent", headers=parent_headers).json()
    assert (g["name"], g["icon"]) == ("Demo", "extension")
    assert g["widgets"][0]["root"]["url"].startswith(f"/integration-widgets/{widget_install.id}/image?u=https%3A")

def test_cached_for_60s(client, parent_headers, widget_install, svc):
    for _ in range(3):
        client.get("/api/v1/integration-widgets?surface=parent", headers=parent_headers)
    assert svc.calls == 1

def test_service_down_shows_nothing_not_500(client, parent_headers, widget_install, svc):
    svc.fail()
    assert client.get("/api/v1/integration-widgets?surface=parent", headers=parent_headers).json() == []
```

- [ ] **Step 2: Run** `cd backend && python -m pytest tests/integrations/test_int_widgets.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `widgets.py`, `widget_service.py`, and the GET route.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): declarative widget schema and parent widget feed`

---

### Task 21: Image proxy

**Files:**
- Modify: `backend/app/api/integration_widgets.py`, `backend/app/integrations/widget_service.py`
- Test: `backend/tests/integrations/test_int_image_proxy.py`

**Interfaces — Produces:**
- `IMAGE_TYPES = {"image/png", "image/jpeg", "image/webp", "image/gif"}`, `IMAGE_MAX = 1_048_576`.
- `fetch_image(url: str, transport=None) -> tuple[str, bytes]`. Uses `net.fetch("GET", url, max_bytes=IMAGE_MAX)` (STRICT) with no cookies, no Referer and `User-Agent: t@sk4ce-box/1`. The content type (before `;`) must be in `IMAGE_TYPES` **and** match the magic bytes (PNG `\x89PNG`, JPEG `\xff\xd8\xff`, GIF `GIF8`, WebP `RIFF....WEBP`). Otherwise `FetchError("not an image")`.
- In-memory LRU: 32 entries, ≤ 16 MiB total.
- `GET /api/v1/integration-widgets/{install_id}/image?u=<url>` (any active user). The install must be active, and the user is a parent, or a kid with `kid_widgets` on that install. `image_allowed(install_id, u)` must hold. Otherwise 404. A fetch error gives 502. Response headers: the detected `Content-Type`, `Cache-Control: private, max-age=300`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'`.

- [ ] **Step 1: Write the failing tests**

```python
def test_serves_allowed_png(client, parent_headers, widget_with_image, cdn):
    cdn.serve(PNG_BYTES, "image/png")
    r = client.get(img_path(widget_with_image), headers=parent_headers)
    assert r.status_code == 200 and r.headers["content-type"] == "image/png"
    assert r.headers["x-content-type-options"] == "nosniff" and "cookie" not in cdn.last_headers
    assert "referer" not in cdn.last_headers

def test_url_not_in_widgets_is_404(client, parent_headers, widget_with_image):
    assert client.get(f"/api/v1/integration-widgets/{widget_with_image.id}/image?u=https%3A%2F%2Fevil.example%2Fx.png",
                      headers=parent_headers).status_code == 404

@pytest.mark.parametrize("ctype,body", [("image/svg+xml", b"<svg/>"), ("text/html", b"<html>"),
                                        ("image/png", b"<html>not png")])
def test_non_images_refused(client, parent_headers, widget_with_image, cdn, ctype, body):
    cdn.serve(body, ctype)
    assert client.get(img_path(widget_with_image), headers=parent_headers).status_code == 502

def test_over_one_mb_refused(client, parent_headers, widget_with_image, cdn):
    cdn.serve(PNG_BYTES + b"0" * 1_048_576, "image/png")
    assert client.get(img_path(widget_with_image), headers=parent_headers).status_code == 502

def test_private_image_host_refused(client, parent_headers, widget_with_image, resolve_to):
    resolve_to("192.168.1.10")
    assert client.get(img_path(widget_with_image), headers=parent_headers).status_code == 502

def test_kid_without_widgets_404(client, kid_headers, widget_with_image):
    assert client.get(img_path(widget_with_image), headers=kid_headers).status_code == 404
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_image_proxy.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `fetch_image`, the LRU, and the route.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): size-capped, type-checked widget image proxy`

---

### Task 22: Widget buttons

**Files:**
- Modify: `backend/app/api/integration_widgets.py`
- Test: `backend/tests/integrations/test_int_buttons.py`

**Interfaces — Consumes:** `widget_service.button`, `health.guarded_call`, `apply_actions(..., origin, actor_kid_id)`.
**Interfaces — Produces:**
- `POST /api/v1/integration-widgets/{install_id}/press` with `PressIn{widget_id: str, button_id: str, kid_id: int | None}` (any active user).
  - A kid gets `surface="kid"` and `kid_id = self.id`, and needs `kid_widgets`.
  - A parent gets `surface="parent"` and the body `kid_id`.
  - The button must be in the cached widget for that surface/kid. Otherwise 404 `"That button is gone."`.
- The box calls `c.events([{"kind": "widget.pressed", "widget_id", "button_id", "by": "parent"|"kid", "kid_id"}])` right away. If the reply is None → 502 `"{name} didn't answer."`.
- Only reply actions with `type == button["action"]` are applied, via `apply_actions(db, install, kept, origin="parent_button"|"kid_button", actor_kid_id=kid.id if kid else None)`. Every other action is audited as rejected `"not this button's action"`.
- The response is `[{result, reason}]`. A press clears that install's widget cache.

- [ ] **Step 1: Write the failing tests**

```python
def test_kid_press_completion_always_waits(client, kid_headers, kid_widget_install, svc, kid, run_today):
    kid_widget_install.trusted = True
    svc.press_reply = [cc("p1", kid.id, run_today.chore_id)]
    [r] = client.post(press_url(kid_widget_install), headers=kid_headers, json={"widget_id": "kid_w", "button_id": "done"}).json()
    assert r["result"] == "pending" and svc.last_body["events"][0]["by"] == "kid"

def test_kid_press_cannot_act_for_sibling(client, kid_headers, kid_widget_install, svc, other_kid, run_other):
    svc.press_reply = [cc("p1", other_kid.id, run_other.chore_id)]
    [r] = client.post(press_url(kid_widget_install), headers=kid_headers, json={"widget_id": "kid_w", "button_id": "done"}).json()
    assert r["result"] == "rejected"

def test_reply_action_must_match_button(client, parent_headers, widget_install, svc):
    svc.press_reply = [msg("m1")]  # button action is chore.complete
    [r] = client.post(press_url(widget_install), headers=parent_headers, json={"widget_id": "w1", "button_id": "done"}).json()
    assert r["reason"] == "not this button's action"

def test_unknown_button_404(client, parent_headers, widget_install):
    assert client.post(press_url(widget_install), headers=parent_headers,
                       json={"widget_id": "w1", "button_id": "nope"}).status_code == 404
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_buttons.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the press route.
- [ ] **Step 4: Run** `python -m pytest tests/integrations -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): widget buttons mapped to granted actions`

---

### Task 23: Frontend widget renderer and parent surface

**Files:**
- Create: `frontend/src/v2/integrations/WidgetFrame.tsx`, `frontend/src/v2/integrations/WidgetBlocks.tsx`, `frontend/src/v2/hooks/useIntegrationWidgets.ts`, `frontend/src/v2/integrations/widgets.css`
- Modify: `frontend/src/v2/integrations/types.ts` (`Block` union, `WidgetGroup`), `frontend/src/v2/today/TodayPage.tsx` (render `<IntegrationWidgets surface="parent" />` below `NeedsYouList`)
- Test: `frontend/tests/v2/integrationWidgets.test.tsx`

**Interfaces — Produces:**
- `useIntegrationWidgets(surface: 'parent' | 'kid')`: query key `['integration-widgets', surface]`, `staleTime` 60 000. Kid calls use the same token style as `useKidRewards.ts`.
- `usePressButton(installId: number, surface)` → POST `/integration-widgets/{id}/press`. Toasts: `applied` → "Done.", `pending` → parent "Sent to Needs you." / kid "Asked.", `rejected` → `toastFail(reason)`.
- `<WidgetFrame group={WidgetGroup}>`: always shows the integration's `Icon` + name + an "Integration" tag in the header. The frame uses a dashed `--p-line` border and the `--p-soft` background, so it never looks like a core card. It cannot be hidden by content.
- `<WidgetBlocks block={Block} onPress />`: a `switch` on `type` over the seven blocks. Unknown types render `null`. Text is rendered as React children only (no `dangerouslySetInnerHTML`). `text.link` renders `<a href target="_blank" rel="noopener noreferrer nofollow">`, followed by the `open_in_new` icon and the link's hostname. `image` uses `useAuthImage(block.url)`. `progress` uses a Mantine `Progress` with an `aria-label`.
- `<IntegrationWidgets surface>` renders nothing when the list is empty or on error.

- [ ] **Step 1: Write the failing tests**

```tsx
it('frames every widget with the integration name and icon', () => {
  render(<WidgetFrame group={G}><span /></WidgetFrame>)
  expect(screen.getByText('Demo')).toBeInTheDocument(); expect(screen.getByText('Integration')).toBeInTheDocument()
})
it('external links show their domain and open safely', () => {
  render(<WidgetBlocks block={{ type: 'text', text: 'Open', link: 'https://duo.example.com/x' }} onPress={jest.fn()} />)
  const a = screen.getByRole('link'); expect(a).toHaveAttribute('rel', 'noopener noreferrer nofollow')
  expect(within(a).getByText('duo.example.com')).toBeInTheDocument()
})
it('ignores unknown block types and never injects HTML', () => {
  const { container } = render(<WidgetBlocks block={{ type: 'html', html: '<img src=x onerror=alert(1)>' } as any} onPress={jest.fn()} />)
  expect(container.innerHTML).toBe('')
})
it('text that looks like HTML stays text', () => {
  render(<WidgetBlocks block={{ type: 'text', text: '<b>hi</b>' }} onPress={jest.fn()} />)
  expect(screen.getByText('<b>hi</b>')).toBeInTheDocument()
})
it('button press posts to the press endpoint', async () => { /* click → */
  expect(apiMock).toHaveBeenCalledWith('/integration-widgets/7/press', expect.objectContaining({ method: 'POST' })) })
it('source never uses dangerouslySetInnerHTML', () => {
  for (const f of ['WidgetBlocks.tsx', 'WidgetFrame.tsx']) expect(readSrc(`src/v2/integrations/${f}`)).not.toMatch(/dangerouslySetInnerHTML/)
})
```

- [ ] **Step 2: Run** `cd frontend && npx jest tests/v2/integrationWidgets.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the components, the hook, and the Today placement.
- [ ] **Step 4: Run** `npx jest tests/v2/integrationWidgets.test.tsx && npm run lint && npm run type-check`. Expected: PASS. Screenshot Today with a demo widget in light and dark.
- [ ] **Step 5: Commit** `feat(integrations): framed widget renderer on parent Today`

---

### Task 24: Kid surface (per-kid opt-in)

**Files:**
- Modify:
  - `backend/app/api/integration_widgets.py` (`GET /kid`, `require_kid`)
  - `backend/app/integrations/client.py` (`widgets` takes an optional `grant_out` override)
  - `frontend/src/v2/kid/MePage.tsx` (render `<IntegrationWidgets surface="kid" />`; skip in preview)
  - `frontend/src/v2/integrations/IntegrationDetail.tsx` (per-kid "Show cards on {kid}'s screens" switches → `PATCH {kid_widget_ids}`; only when `widgets.kid` is granted)
- Test: `backend/tests/integrations/test_int_kid_widgets.py`, `frontend/tests/v2/integrationKidWidgets.test.tsx`

**Interfaces — Produces:**
- `GET /api/v1/integration-widgets/kid` → `[WidgetGroup]` covering active installs where the caller is in `kid_widget_ids` and `widgets.kid` is granted. The `widgets` request is sent with `surface="kid"`, `kid_id=self.id`, and a `grant_out` whose `kids` holds **only** this kid.
- The kid-surface `sanitize` drops `request.decide` buttons (Task 20). Presses are `kid_button` (Task 22).

- [ ] **Step 1: Write the failing tests**

```python
def test_kid_sees_only_enabled_installs(client, kid_headers, kid_widget_install, widget_install_not_enabled, svc):
    groups = client.get("/api/v1/integration-widgets/kid", headers=kid_headers).json()
    assert [g["install_id"] for g in groups] == [kid_widget_install.id]

def test_kid_widget_request_carries_only_that_kid(client, kid_headers, kid_widget_install, svc, kid):
    client.get("/api/v1/integration-widgets/kid", headers=kid_headers)
    assert [k["id"] for k in svc.last_body["grant"]["kids"]] == [kid.id] and svc.last_body["kid_id"] == kid.id

def test_parent_cannot_call_kid_feed(client, parent_headers):
    assert client.get("/api/v1/integration-widgets/kid", headers=parent_headers).status_code == 403

def test_kid_toggle_requires_permission(client, parent_headers, widget_install, kid):
    r = client.patch(f"/api/v1/integrations/{widget_install.id}", headers=parent_headers, json={"kid_widget_ids": [kid.id]})
    assert r.status_code == 422  # widget_install lacks widgets.kid
```

```tsx
it('detail shows a per-kid card switch only with widgets.kid', () => { expect(screen.getByRole('switch', { name: "Show cards on Sam's screens" })).toBeInTheDocument() })
it('kid Me page renders framed kid cards', () => { expect(screen.getByText('Demo')).toBeInTheDocument() })
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_kid_widgets.py -v` and `cd frontend && npx jest tests/v2/integrationKidWidgets.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** both, plus `npx jest tests/v2/kid.test.tsx && npm run lint && npm run type-check`. Expected: PASS. Screenshot the kid Me page in each age mode, light and dark.
- [ ] **Step 5: Commit** `feat(integrations): opt-in kid widgets`

Next: `2026-11-04-integrations-5-local-devkit.md` (Task 25).
