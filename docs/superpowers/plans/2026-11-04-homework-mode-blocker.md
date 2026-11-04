# Homework mode — implementation plan, part 2 (blocker)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Continues:** `docs/superpowers/plans/2026-11-04-homework-mode.md` (part 1, tasks 1–6, backend). Its Goal, Architecture, **Global Constraints** and **Review Focus** sections apply here unchanged. Read them first.

**Spec:** `docs/superpowers/specs/2026-11-04-homework-mode-design.md`

**Depends on:** part 1 tasks 2 (the `homework` map in `/internal/state` and the push) and 5 (`POST /internal/homework/activity`).

---

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

> Frontend tasks 12–15 continue in `2026-11-04-homework-mode-frontend.md`.
