# Integrations framework — implementation plan (part 3 of 5: events, polling, actions)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrations hear about linked kids' events, get polled on their interval, and can manage their own rewards, message parents, and approve or deny reward redemptions and chore check-offs. Broken services pause themselves and tell the parent.

**Spec:** `docs/superpowers/specs/2026-11-04-integrations-design.md`. **Header, Global Constraints and Review Focus:** `2026-11-04-integrations-1-core.md`. Requires Tasks 1–14.

---

### Task 15: Health, pause and outbound rate limit

**Files:**
- Create: `backend/app/integrations/health.py`
- Test: `backend/tests/integrations/test_int_health.py`

**Interfaces — Produces:**
- `FAIL_LIMIT = 5`.
- `class RateLimiter(per_minute: int)` with `allow(key: int, now: float) -> bool` (60 s sliding window, a `deque` per key). Singleton `OUTBOUND = RateLimiter(30)`.
- `ok(install) -> None` sets `failures = 0`.
- `fail(db, install, reason: str) -> None`: `failures += 1`. At `FAIL_LIMIT` with status `active` → `status="paused"`, `paused_reason=reason[:200]`, and `inbox.notify_parents(db, "integration_paused", f"{install.name} is paused", "It stopped answering properly. Open it to try again.")`. The caller commits.
- `guarded_call(db, install, fn: Callable[[BoxClient], T]) -> T | None`. Returns None without calling when the install is not active or `OUTBOUND.allow` is False (rate-limited calls are **not** failures). Otherwise it calls `fn(store.client_for(db, install))`, which yields `ok` or `fail`. Reason map: `BlockedError` → `"blocked address"`; `FetchError("timeout")` → `"timed out"`; other `FetchError` → `"not reachable"`; `ProtocolError` with "signature" → `"bad signature"`; other `ProtocolError` → `"bad reply"`. It never raises those errors.

- [ ] **Step 1: Write the failing tests**

```python
def test_five_failures_pause_and_notify(db, install):
    for _ in range(5):
        assert guarded_call(db, install, raising(FetchError("timeout"))) is None
    assert install.status == "paused" and install.paused_reason == "timed out"
    assert db.query(Notification).filter_by(kind="integration_paused").count() >= 1

def test_success_resets_failures(db, install):
    guarded_call(db, install, raising(ProtocolError("bad")))
    guarded_call(db, install, lambda c: "ok")
    assert install.failures == 0

def test_paused_install_is_not_called(db, install):
    install.status = "paused"; called = []
    guarded_call(db, install, lambda c: called.append(1))
    assert called == []

def test_rate_limit_skips_without_failing(db, install, monkeypatch):
    monkeypatch.setattr(health, "OUTBOUND", RateLimiter(1))
    guarded_call(db, install, lambda c: "a")
    assert guarded_call(db, install, lambda c: "b") is None and install.failures == 0

def test_core_app_unaffected_when_service_down(client, parent_headers, install, svc):
    svc.fail()
    assert client.get("/api/v1/today", headers=parent_headers).status_code == 200
```

- [ ] **Step 2: Run** `cd backend && python -m pytest tests/integrations/test_int_health.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `health.py`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): health tracking, auto-pause and rate limit`

---

### Task 16: Events out (outbox, trimming, delivery)

**Files:**
- Create: `backend/app/integrations/events.py`
- Modify:
  - `backend/app/services/chore_actions.py` (`approve` emits `chore.completed`)
  - `backend/app/api/kid.py` (`done` emits `request.created` type chore)
  - `backend/app/integrations/apply.py` (a pending completion emits `request.created` with `skip_install_id`)
  - `backend/app/services/economy.py` (`_request` for kind `reward` emits `request.created`; `_decide` approve for kind `reward` emits `reward.redeemed`). Import `events` inside the function to avoid an import cycle with `apply`.
  - `backend/app/integrations/loop.py` (`STEPS.append(events.flush)`)
- Test: `backend/tests/integrations/test_int_events.py`

**Interfaces — Produces:**
- `EVENT_PERM = {"chore.completed": "events.chore_completed", "request.created": "events.request_created", "reward.redeemed": "events.reward_redeemed"}`. Screen-time, homework and device events do not exist.
- `trim(grant: Grant, kind: str, kid_id: int, kid_first_name: str, fields: dict) -> dict` (pure). Output: `{"kind", "at", "kid_id"}`, plus `"first_name"` only with `kid.name`, plus an allowlist per kind:
  - `chore.completed`: `chore_id, title, points`
  - `request.created`: `type ('reward'|'chore'), id, title, cost`
  - `reward.redeemed`: `reward_name, cost`
  Every other key is dropped.
- `emit(db, kind: str, kid_ids: list[int], *, chore_id: int | None = None, skip_install_id: int | None = None, **fields) -> None`. For each active catalog install with the event permission, for each of `kid_ids` linked to it, and (if `chore_id` is set) only when the chore is linked: add an `IntegrationEvent(payload=json.dumps(trim(...)))`. It runs inside `db.begin_nested()` and swallows and logs any exception, so the caller's action never fails because of integrations.
- `flush(db, now: datetime) -> None` (loop step). Delete events older than 24 h. Then, per active install with events, send the oldest ≤ 50 via `health.guarded_call(db, install, lambda c: c.events(payloads))`. On a reply: delete the sent rows and `apply_actions(db, install, reply.actions)`. On None: `attempts += 1`. Commit.

- [ ] **Step 1: Write the failing tests** (`install` granted `events.chore_completed` and `events.reward_redeemed`, without `kid.name`)

```python
def test_approval_emits_trimmed_event(db, install, kid, run_today, parent):
    chore_actions.approve(db, run_today, parent.id); db.commit()
    [ev] = db.query(IntegrationEvent).all()
    p = json.loads(ev.payload)
    assert p["kind"] == "chore.completed" and p["kid_id"] == kid.id and "first_name" not in p
    assert set(p) <= {"kind", "at", "kid_id", "chore_id", "title", "points"}

def test_unlinked_kid_gets_no_event(db, install, other_kid, parent):
    run = make_run(db, parent, other_kid, status="submitted")
    chore_actions.approve(db, run, parent.id); db.commit()
    assert db.query(IntegrationEvent).count() == 0

def test_unlinked_chore_gets_no_event(db, install, kid, parent):
    run = make_run(db, parent, kid, status="submitted", title="Not linked")
    chore_actions.approve(db, run, parent.id); db.commit()
    assert db.query(IntegrationEvent).count() == 0

def test_screen_time_request_emits_nothing(client, kid_headers, install, db):
    kid_requests_screen_time(client, kid_headers)
    assert db.query(IntegrationEvent).count() == 0

def test_reward_redeemed_has_name_and_cost_only(db, install, kid, reward_redemption, parent):
    economy.decide(db, reward_redemption, parent, True)
    p = json.loads(db.query(IntegrationEvent).one().payload)
    assert p["reward_name"] == "Ice cream" and p["cost"] == 20 and "balance" not in p

def test_emit_failure_never_breaks_approval(db, run_today, parent, monkeypatch):
    monkeypatch.setattr(events, "trim", boom)
    chore_actions.approve(db, run_today, parent.id); db.commit()
    assert run_today.status == "done"

def test_flush_delivers_batches_of_50_and_applies_reply(db, install, svc, kid):
    add_events(db, install, 60)
    events.flush(db, NOW)
    assert len(svc.last_body["events"]) == 50 and db.query(IntegrationEvent).count() == 10

def test_old_events_dropped(db, install):
    add_events(db, install, 1, created_at=NOW - timedelta(hours=25))
    events.flush(db, NOW)
    assert db.query(IntegrationEvent).count() == 0
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_events.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `events.py` and the emit hooks.
- [ ] **Step 4: Run** `python -m pytest tests -q`. The whole suite matters because core flows gained hooks. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): trimmed per-kid event delivery`

---

### Task 17: Poller

**Files:**
- Create: `backend/app/integrations/poller.py`
- Modify: `backend/app/integrations/loop.py` (`STEPS.append(poller.poll_due)`)
- Test: `backend/tests/integrations/test_int_poller.py`

**Interfaces — Produces:**
- `MAX_PER_TICK = 10`.
- `interval(install) -> int` = `max(60, manifest.poll_seconds)`. The manifest is re-verified from `install.manifest` with `load_manifest`. A manifest that fails verification pauses the install with reason `"bad manifest"`.
- `poll_due(db, now: datetime) -> None`. Takes active catalog installs with `next_poll_at <= now`, oldest first, up to `MAX_PER_TICK`. For each: `reply = health.guarded_call(db, install, lambda c: c.poll())`, then `apply_actions(db, install, reply.actions)` when there is a reply. Always set `next_poll_at = now + interval` (failures too), then commit.

- [ ] **Step 1: Write the failing tests**

```python
def test_due_install_is_polled_and_actions_applied(db, install, svc, kid, run_today):
    install.next_poll_at = NOW; svc.actions = [cc("p1", kid.id, run_today.chore_id)]
    poll_due(db, NOW)
    assert svc.last_path == "/v1/poll" and run_today.status == "submitted"
    assert install.next_poll_at == NOW + timedelta(seconds=60)

def test_not_due_not_polled(db, install, svc):
    install.next_poll_at = NOW + timedelta(seconds=1); poll_due(db, NOW)
    assert svc.calls == 0

def test_no_poll_interval_never_polled(db, install, svc):
    install.next_poll_at = None; poll_due(db, NOW)
    assert svc.calls == 0

def test_failures_still_reschedule_and_pause_at_five(db, install, svc):
    svc.fail(); t = NOW
    for _ in range(5):
        install.next_poll_at = t; poll_due(db, t); t += timedelta(seconds=60)
    assert install.status == "paused"

def test_tampered_stored_manifest_pauses(db, install):
    install.manifest = json.dumps({"payload": "e30=", "sig": "AAAA"}); install.next_poll_at = NOW
    poll_due(db, NOW)
    assert install.status == "paused" and install.paused_reason == "bad manifest"
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_poller.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `poller.py`.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): interval poller`

---

### Task 18: Actions: own rewards and parent messages

**Files:**
- Modify:
  - `backend/app/integrations/apply.py` (register `reward.upsert`, `reward.remove`, `message.parents`)
  - `backend/app/integrations/store.py` (`reward_visible_to`)
  - `backend/app/api/kid_rewards.py:29,87` (list and redeem honour `reward_visible_to`)
  - `backend/app/api/rewards.py` (`_out` adds `"integration": {"id","name"} | None`; `delete_reward` keeps `integration_ref`)
- Test: `backend/tests/integrations/test_int_rewards_messages.py`

**Interfaces — Produces:**
- `MAX_REWARDS = 50`, `MAX_MESSAGES_PER_DAY = 20`.
- `reward.upsert`: find `Reward(integration_install_id=install.id, integration_ref=ref)`.
  - None → create (`needs_approval=True`, `visible=True`). Over `MAX_REWARDS` active → rejected `"too many rewards"`.
  - Found and active → update `name`, `price`, `icon`.
  - Found and inactive (a parent removed it) → rejected `"a parent removed this reward"`.
  Result `applied`.
- `reward.remove`: owned and active → `active=False`, `integration_ref=None` (a later upsert with the same ref creates a new reward). Else rejected `"no such reward"`. It never touches rewards owned by others, or core rewards.
- `message.parents`: `MAX_MESSAGES_PER_DAY` already applied in the last 24 h → rejected `"too many messages today"`. Else `notify_parents(db, "integration_msg", f"{install.name}: {title}"[:120], body)`, with control characters stripped. Result `applied`.
- `store.reward_visible_to(db, reward: Reward, kid_id: int) -> bool`: True for core rewards. For integration rewards it needs an install status of `active|paused` and the kid linked.

- [ ] **Step 1: Write the failing tests** (`install` granted `rewards.manage` and `messages.parents`)

```python
def test_upsert_creates_then_updates(db, install):
    apply_actions(db, install, [ru("a", ref="r1", name="Robux", price=50)])
    apply_actions(db, install, [ru("b", ref="r1", name="Robux 2", price=60)])
    [r] = db.query(Reward).filter_by(integration_install_id=install.id).all()
    assert (r.name, r.price, r.needs_approval) == ("Robux 2", 60, True)

def test_cannot_touch_core_reward(db, install):
    core = Reward(name="Park", price=10); db.add(core); db.commit()
    [res] = apply_actions(db, install, [{"type": "reward.remove", "idempotency_key": "x", "ref": str(core.id)}])
    assert res.reason == "no such reward" and core.active is True

def test_parent_removal_sticks(db, install, client, parent_headers):
    apply_actions(db, install, [ru("a", ref="r1")])
    rid = db.query(Reward).filter_by(integration_ref="r1").one().id
    client.delete(f"/api/v1/rewards/{rid}", headers=parent_headers)
    assert apply_actions(db, install, [ru("b", ref="r1")])[0].reason == "a parent removed this reward"

def test_unlinked_kid_cannot_see_or_redeem(db, install, client, other_kid_headers):
    apply_actions(db, install, [ru("a", ref="r1", name="Robux")])
    names = [r["name"] for r in client.get("/api/v1/kid/rewards", headers=other_kid_headers).json()["rewards"]]
    assert "Robux" not in names

def test_message_reaches_parents_with_name(db, install):
    apply_actions(db, install, [msg("m1", title="Streak!", body="Sam hit 30 days")])
    n = db.query(Notification).filter_by(kind="integration_msg").first()
    assert n.title == "Demo: Streak!" and n.body == "Sam hit 30 days"

def test_message_daily_cap(db, install):
    apply_actions(db, install, [msg(f"m{i}") for i in range(20)])
    assert apply_actions(db, install, [msg("m20")])[0].reason == "too many messages today"
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_rewards_messages.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the three handlers, `reward_visible_to`, and the kid-side filter.
- [ ] **Step 4: Run** the file plus `tests/test_rewards_api.py tests/test_redemptions.py -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): integration-owned rewards and parent messages`

---

### Task 19: Action: approve/deny reward redemptions and chore check-offs

**Files:**
- Modify: `backend/app/integrations/apply.py` (register `request.decide`)
- Test: `backend/tests/integrations/test_int_decide.py`

**Interfaces — Consumes:** `economy.decide(db, redemption, None, approve, note)` and `chore_actions.approve` / `send_back`.
**Interfaces — Produces:** the `request.decide` handler. It is not gated by `trusted`, and `kid_button` origin is already denied by `check_action`.
- `target == "reward"`: load the `Redemption`. Missing or not linked (`kid_id` ∉ grant) → rejected `"not found"`. **`kind != "reward"` → rejected `"only the t@sk4ce app can answer this"`.** Status ≠ pending → rejected `"already answered"`. Otherwise call `economy.decide(db, r, None, approve, note)`. The `HTTPException(409, detail)` it raises becomes rejected with `detail`. Refs: `redemption_id`, `kid_id`.
- `target == "chore"`: load the `ChoreRun`. Not linked (no linked kid in `run_kid_ids`, or its chore not linked) → rejected `"not found"`. Status ≠ `submitted` → rejected `"already answered"`. If approve: `chore_actions.approve(db, run, by_id=None)`. Else: `chore_actions.send_back(db, run, note or f"Sent back by {install.name}")`. Refs: `run_id`, `kid_id`, `chore_id`.
- Homework, screen-time and device requests have no target value, so pydantic rejects them as `"bad action"`.

- [ ] **Step 1: Write the failing tests** (`install` granted `requests.decide`)

```python
def test_approves_reward_redemption(db, install, reward_redemption):
    [r] = apply_actions(db, install, [rd("a", "reward", reward_redemption.id, True)])
    assert r.result == "applied" and reward_redemption.status == "approved"

def test_screen_time_never_approvable(db, install, screen_time_redemption):
    before = db.query(Override).count()
    [r] = apply_actions(db, install, [rd("a", "reward", screen_time_redemption.id, True)])
    assert (r.result, r.reason) == ("rejected", "only the t@sk4ce app can answer this")
    assert screen_time_redemption.status == "pending" and db.query(Override).count() == before

@pytest.mark.parametrize("target", ["homework", "screen_time", "device", "unlock"])
def test_other_targets_do_not_exist(db, install, target):
    assert apply_actions(db, install, [rd("a", target, 1, True)])[0].reason == "bad action"

def test_trust_switch_does_not_gate_decide(db, install, reward_redemption):
    install.trusted = False
    assert apply_actions(db, install, [rd("a", "reward", reward_redemption.id, False)])[0].result == "applied"

def test_race_with_parent(db, install, reward_redemption, parent):
    economy.decide(db, reward_redemption, parent, False)
    [r] = apply_actions(db, install, [rd("a", "reward", reward_redemption.id, True)])
    assert (r.result, r.reason) == ("rejected", "already answered") and reward_redemption.status == "denied"

def test_chore_send_back_with_default_note(db, install, kid, run_submitted):
    apply_actions(db, install, [rd("a", "chore", run_submitted.id, False)])
    assert run_submitted.status == "todo" and run_submitted.last_note == "Sent back by Demo"

def test_unlinked_kid_redemption_not_found(db, install, other_kid_redemption):
    assert apply_actions(db, install, [rd("a", "reward", other_kid_redemption.id, True)])[0].reason == "not found"

def test_kid_button_cannot_decide(db, install, kid, reward_redemption):
    [r] = apply_actions(db, install, [rd("a", "reward", reward_redemption.id, True)], origin="kid_button", actor_kid_id=kid.id)
    assert r.reason == "kids can only ask"
```

- [ ] **Step 2: Run** `python -m pytest tests/integrations/test_int_decide.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** the handler.
- [ ] **Step 4: Run** `python -m pytest tests -q && ruff check backend && ruff format --check backend`. Expected: PASS.
- [ ] **Step 5: Commit** `feat(integrations): limited approve/deny for rewards and chore check-offs`

Next: `2026-11-04-integrations-4-widgets.md` (Task 20).
