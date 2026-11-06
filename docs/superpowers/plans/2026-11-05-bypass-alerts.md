# Bypass Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Alert parents when a device may be a copy of another (B), when someone guesses a parent password (C), and when a paused device tries a VPN / private DNS / proxy / Tor (D).

**Architecture:** B and C are backend-only hooks in existing paths (`/internal/devices/seen`, `/auth/login`). D adds a DNS-name check in the blocker's portal resolver, reported like portal hits to a new internal endpoint. One migration widens two CHECK constraints. UI reuses existing activity/inbox rows.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (backend), Python blocker daemon (scapy DNS), Next.js/React v2 UI, jest, pytest.

**Spec:** `docs/superpowers/specs/2026-11-05-bypass-alerts-design.md`

## Global Constraints

- Branch `feat/bypass-alerts`, rebased on `origin/main` **after PR #61 merges**; migration `down_revision` = output of `alembic heads` at that time.
- Copy says "may", never "cheated". Exact titles/bodies below are verbatim.
- New device-event kinds: `identity_change`, `workaround_try`. New inbox kinds: `password_guess`, `workaround_try`. Neither inbox kind goes in `KID_KINDS`.
- `password_guess` → push event `resisting` (SECURITY). `workaround_try` → new push event `workaround` (label "Tried a workaround"), in `DEFAULT_EVENTS`, **not** in `SECURITY`.
- No new tables, columns, ports, dependencies, or cloud calls.
- Files ≤ 500 lines; ruff check + format clean; `tsc`, jest, eslint clean. Existing theme tokens only.
- Semantic commits; version → next minor (2.2.0 if main is 2.1.0) in `frontend/package.json`, `package-lock.json`, `backend/app/__init__.py`, `backend/tests/test_health.py`.

## Review Focus

1. Unknown or made-up usernames in failed logins → never counted, never alert (Task 3 test `test_unknown_username_not_counted`).
2. Kid-account password failures → no alert; only parent roles (Task 3 `test_kid_account_never_alerts`).
3. First sighting of a model (old value empty) → no alert (Task 2 `test_first_model_no_alert`).
4. DNS query from an IP the box can't map to a MAC, or from an unpaused device → ignored (Task 4 `test_unknown_ip_ignored`, Task 5 `test_unpaused_device_ignored`).
5. Same category twice in one pause → one alert; new pause → alerts again (Task 5 `test_once_per_pause`, `test_new_pause_alerts_again`).

---

### Task 1: Kinds, migration, push event

**Files:**
- Create: `backend/alembic/versions/u4d5e6f7a8b9_bypass_kinds.py`
- Modify: `backend/app/models/device_activity.py` (KINDS, ALERT_KINDS, FILTERS), `backend/app/models/inbox.py` (KINDS), `backend/app/services/notify.py` (EVENTS, DEFAULT_EVENTS, KIND_EVENT)
- Test: `backend/tests/test_bypass_kinds.py`

**Interfaces:**
- Produces: kinds above; `notify.KIND_EVENT["password_guess"] == "resisting"`, `notify.KIND_EVENT["workaround_try"] == "workaround"`; `notify.EVENTS["workaround"] == "Tried a workaround"`.

- [ ] **Step 1: Failing tests**

```python
def test_kinds_registered():
    from app.models import device_activity as da, inbox
    from app.services import notify, inbox as inbox_svc
    assert {"identity_change", "workaround_try"} <= set(da.KINDS)
    assert {"identity_change", "workaround_try"} <= set(da.ALERT_KINDS)
    assert {"identity_change", "workaround_try"} <= set(da.FILTERS["bypass"])
    assert {"password_guess", "workaround_try"} <= set(inbox.KINDS)
    assert not ({"password_guess", "workaround_try"} & inbox_svc.KID_KINDS)
    assert notify.KIND_EVENT["password_guess"] == "resisting"
    assert notify.KIND_EVENT["workaround_try"] == "workaround"
    assert "workaround" in notify.DEFAULT_EVENTS and "workaround" not in notify.SECURITY

def test_db_accepts_new_kinds(db, device):  # use existing fixtures from test_internal_activity.py
    # insert one DeviceEvent of each new kind and one Notification of each new inbox kind; commit succeeds
```

- [ ] **Step 2:** `pytest tests/test_bypass_kinds.py -v` → FAIL.
- [ ] **Step 3:** Edit models/notify. Replace `ALERT_KINDS = KINDS[:6]` with an explicit tuple (the same six plus the two new kinds). Migration: batch-alter `ck_device_event_kind` and `ck_notification_kind` (copy the pattern in the integrations kinds migration: OLD/NEW tuples, upgrade + downgrade).
- [ ] **Step 4:** `pytest tests/test_bypass_kinds.py tests/test_migrations*.py -q` and `alembic heads` (one head) → PASS.
- [ ] **Step 5:** Commit `feat(alerts): bypass alert kinds and workaround push event`.

---

### Task 2: B — "may be a different device"

**Files:**
- Create: `backend/app/lock/identity.py`
- Modify: `backend/app/api/internal.py` (call from the existing-device branch of `devices_seen`, using the `before` tuple already captured)
- Test: `backend/tests/test_identity_change.py`

**Interfaces:**
- Produces: `note_identity_change(db: Session, dev: Device, old_model: str | None, old_fp: str | None, now: datetime) -> None` (caller commits).

Rules: only `dev.status == "assigned"`. Model: old non-empty and new non-empty and different (case-insensitive) → `activity.log(db, dev.id, "identity_change", now, detail=f"{old} → {new}"[:120])` + `inbox.notify_parents(db, "device_bypass", f"{dev.name} may be a different device", f"It now says it's a {new}, not a {old}. Someone may have copied its address. Tap to check.", device_id=dev.id)`. Fingerprint-only change (old and new non-empty, different) → event only, `detail="fingerprint"`, no notification.

- [ ] **Step 1: Failing tests** (POST `/api/v1/internal/devices/seen` twice, as in `test_internal_api.py`)
  - `test_model_change_alerts`: assigned device, model "iPad" then "MacBookPro18,1" → one `identity_change` event, one `device_bypass` notification titled `"<name> may be a different device"`.
  - `test_first_model_no_alert`: model None then "iPad" → no event, no notification.
  - `test_fingerprint_only_logs`: same model, fp "1,3,6" then "1,121,3" → one event `detail == "fingerprint"`, zero notifications.
  - `test_unassigned_ignored`: unassigned device model change → nothing.
  - `test_same_report_twice_once`: change then same report again → still one notification.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** run + `pytest tests/test_internal*.py tests/test_device_hints_api.py -q` → PASS.
- [ ] **Step 5:** Commit `feat(alerts): warn when a device's model changes`.

---

### Task 3: C — password guessing

**Files:**
- Create: `backend/app/services/guess_watch.py`
- Modify: `backend/app/api/auth.py` (on failed login, before raising 401)
- Test: `backend/tests/test_guess_watch.py`

**Interfaces:**
- Produces: `record_failure(db: Session, login: str, now: float | None = None) -> None`; constants `THRESHOLD = 5`, `WINDOW = 900`, `COOLDOWN = 3600`; `reset() -> None` for tests.

Approach: look up user where `lower(username) == lower(login)` or `lower(email) == lower(login)`; skip if none, inactive, or role is KID. In-memory `dict[int, deque[float]]` + `dict[int, float]` last-alert under a `threading.Lock` (`# ponytail: single uvicorn process; resets on restart`). On reaching 5 within 900 s and no alert in the last 3600 s → `inbox.notify_parents(db, "password_guess", f"Someone is guessing {name}'s password", "5 wrong passwords in 15 minutes. If it wasn't you, change it in Settings.")` and commit; `name = user.full_name or user.username`.

- [ ] **Step 1: Failing tests** (via `/api/v1/auth/login`, patching `time.monotonic` or passing `now` to the unit)
  - `test_five_failures_alert`: 5 bad passwords for a parent → one `password_guess` notification with the exact title.
  - `test_four_failures_no_alert`.
  - `test_window_expires`: 4 failures, +901 s, 1 failure → none.
  - `test_cooldown`: 10 failures → one alert; after +3601 s and 5 more → second alert.
  - `test_unknown_username_not_counted`: 20 failures for "nobody" → none.
  - `test_kid_account_never_alerts`.
  - `test_email_login_counts`: failures by email address count for that parent.
  - Existing rate limit (10/min) may 429 in tests: reset `ratelimit` between steps the way `test_auth_hardening.py` does.
- [ ] **Step 2–4:** FAIL → implement → PASS with `pytest tests/test_guess_watch.py tests/test_auth*.py -q`.
- [ ] **Step 5:** Commit `feat(alerts): tell parents when someone is guessing a password`.

---

### Task 4: D (blocker) — spot workaround DNS names

**Files:**
- Create: `blocker/workaround.py`, `blocker/data/workaround_domains.txt`
- Modify: `blocker/portal.py` (`run_dns` gains `on_query: Callable[[str, str], None] | None = None`, called with `(src_ip, qname)`; add `qname_of(wire: bytes) -> str | None`), `blocker/service.py` (create counter, pass `on_query`, drain in `_resist_once`), `blocker/backend.py` (`report_workarounds(cfg, found: dict[str, list[str]]) -> bool` → POST `/devices/workarounds` `{"found": found}`)
- Test: `blocker/tests/test_workaround.py`, extend `blocker/tests/test_portal.py`, `test_service.py`

**Interfaces:**
- Produces: `CATEGORIES = ("vpn", "private_dns", "proxy", "tor")`; `categorize(qname: str) -> str | None`; `class WorkaroundCounter(resolve: Callable[[str], str | None])` with `add(ip: str, qname: str) -> None`, `drain() -> dict[str, list[str]]` (MAC → sorted unique categories).
- Domain file format: `category domain` per line, `#` comments. Suffix match on label boundary (`x.nordvpn.com` matches `nordvpn.com`; `notnordvpn.com` doesn't). Trailing dot and case ignored. ~100–200 entries: major VPN brands (NordVPN, ExpressVPN, Surfshark, Proton VPN, Windscribe, TunnelBear, Hotspot Shield, Psiphon, Turbo VPN, Cloudflare WARP `cloudflareclient.com`), private DNS (`dns.google`, `cloudflare-dns.com`, `one.one.one.one`, `dns.quad9.net`, `dns.adguard-dns.com`, `doh.opendns.com`, `dns.nextdns.io`, `mask.icloud.com`, `mask-h2.icloud.com`), proxies (`croxyproxy.com`, `hide.me`, `proxysite.com`, `kproxy.com`, `hidemyass.com`), Tor (`torproject.org`, `tor.eff.org`). Loaded once, `functools.cache`.

- [ ] **Step 1: Failing tests**
  - `test_categorize`: `"api.nordvpn.com." → "vpn"`, `"DNS.GOOGLE" → "private_dns"`, `"notnordvpn.com" → None`, `"www.torproject.org" → "tor"`.
  - `test_counter_groups_by_mac`: resolver maps ip→mac; two vpn names + one tor → `{"aa:..": ["tor", "vpn"]}`; second `drain()` → `{}`.
  - `test_unknown_ip_ignored`: resolver returns None → nothing.
  - `test_qname_of`: real DNS wire for `example.com` → `"example.com."`; garbage → None.
  - `test_run_dns_calls_on_query` (portal): existing run_dns test pattern, assert callback got `(ip, "example.com.")`.
  - service: `_resist_once` calls `report_workarounds` only when drain is non-empty (inject like `report_hits`).
- [ ] **Step 2–4:** FAIL → implement → `cd blocker && pytest -q` PASS.
- [ ] **Step 5:** Commit `feat(blocker): notice VPN, private DNS, proxy and Tor lookups from paused devices`.

---

### Task 5: D (backend) — workaround endpoint and alert

**Files:**
- Modify: `backend/app/api/internal.py` (new route; if file passes 450 lines, move hits + workarounds routes to new `backend/app/api/internal_tries.py` on the same router prefix)
- Test: `backend/tests/test_internal_workarounds.py`

**Interfaces:**
- Consumes: Task 1 kinds; Task 4 payload `{"found": {mac: [category, ...]}}`.
- Produces: `POST /api/v1/internal/devices/workarounds` (token-protected), body model `WorkaroundReport` (≤1000 MACs, MAC-validated like `HitsReport`, categories limited to `CATEGORIES`), returns `{"logged": int}`.

Rules: only devices with `blocked_since` set and `block_reason(...)` not None (same as `devices_hits`). Per category: skip if a `workaround_try` event with `reason == category` exists at or after `dev.blocked_since`; else `activity.log(db, d.id, "workaround_try", now, reason=category)` and `inbox.notify_parents(db, "workaround_try", f"{d.name} tried {WORD[category]}", "It didn't work — the pause is still on.", device_id=d.id)` with `WORD = {"vpn": "a VPN", "private_dns": "private DNS", "proxy": "a proxy site", "tor": "Tor"}`.

- [ ] **Step 1: Failing tests**
  - `test_alerts_once`: paused device, vpn → 1 event, 1 notification titled `"<name> tried a VPN"`.
  - `test_once_per_pause`: same report twice → still 1.
  - `test_new_pause_alerts_again`: change `blocked_since` to later → second notification.
  - `test_two_categories_two_alerts`.
  - `test_unpaused_device_ignored`.
  - `test_bad_category_422`, `test_requires_token`.
- [ ] **Step 2–4:** FAIL → implement → PASS (`pytest tests/test_internal*.py -q`).
- [ ] **Step 5:** Commit `feat(alerts): alert once per pause when a device tries a workaround`.

---

### Task 6: UI — activity rows, bell, settings

**Files:**
- Modify: `frontend/src/v2/hoursTypes.ts` (event kind union), `frontend/src/v2/manage/DeviceActivity.tsx` (bypass filter kinds + row text), `frontend/src/v2/components/bellRules.ts` (`ALERT_KINDS` add `password_guess`), `frontend/src/v2/components/BellActions.tsx` (password_guess → link to Settings account page; workaround_try → device page like device_bypass)
- Test: extend `frontend/tests/v2/` DeviceActivity and bell tests

Row text: `identity_change` with detail `"fingerprint"` → "Network fingerprint changed"; otherwise → "May be a different device ({detail})". `workaround_try` → "Tried {a VPN|private DNS|a proxy site|Tor} — blocked".
Bypass filter label stays as is; kinds `['bypass', 'new_address', 'identity_change', 'workaround_try']`.
The new push event shows in notification settings automatically if the settings list is driven by `EVENTS`; if it is hard-coded in the frontend, add `workaround` there.

- [ ] **Step 1:** Failing jest tests for each row text and the bell alert class for `password_guess`.
- [ ] **Step 2–4:** FAIL → implement → `npx jest tests/v2 --silent`, `npx tsc --noEmit`, `npm run lint` PASS.
- [ ] **Step 5:** Screenshots light+dark × phone+desktop: device activity with the new rows, bell with a `password_guess` item, notification settings. Compare with existing mockups; no new colors.
- [ ] **Step 6:** Commit `feat(ui): show bypass alerts in activity and bell`.

---

### Task 7: Docs, site, version

**Files:**
- Modify: `docs/blocker.md` (tricks table per spec rows 1–4, 8, 9), `docs/guide/06-troubleshooting.md` (two entries: "may be a different device" and "tried a VPN"), `docs/adr/0001-blocker-enforcement-vs-firewalla.md` (known limit: unpaused devices are invisible; WireGuard to a raw IP not caught), `site/index.html` (one feature line), version files (Global Constraints)

- [ ] **Step 1:** Edit docs in the guide's plain voice. **Step 2:** `python scripts/build_site.py && node site/check.mjs` PASS. **Step 3:** full `pytest -q`, blocker `pytest -q`, jest PASS.
- [ ] **Step 4:** Commit `docs(guide): bypass alerts` and `chore(release): 2.2.0`.
