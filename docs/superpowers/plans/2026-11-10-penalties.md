# Penalties Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Parents give a penalty (points, banked screen time, or a device block) to one kid or every kid in two taps; kids earn part back with make-up chores.

**Architecture:** One `Penalty` row per kid. A service (`services/penalties.py` + `services/penalty_earnback.py`) takes the thing, creates make-up chores as one-off `ChoreRun`s tagged `penalty_id`, and returns slices on approval. Blocks are `Override(source="penalty")` rows the lock rules treat as a lock. Make-up runs are invisible to daily counting (chore lock, streaks, badges, recap, boost). Frontend: one `PenaltySheet` opened from five places, a kid-page list, a kid-app card.

**Tech Stack:** FastAPI + SQLAlchemy + Alembic (SQLite, batch alters), pytest; Next 16 + React 19 + Mantine + react-query, jest + testing-library, Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-11-10-penalties-design.md` (binding). Mockup: `.superpowers/mockups/penalties-v2.html` (binding look).

## Global Constraints

- Every file under 500 lines. Strict TDD: failing test first.
- Python: `cd backend && /home/user/code/tskfrce/.venv/bin/python -m pytest tests -q`; lint from repo root: `ruff format backend && ruff check backend` (use `/home/user/code/tskfrce/.venv/bin/ruff` if `ruff` missing; else `pip`-less: `uvx ruff`).
- Frontend (in `frontend/`): `npx jest <file>`, `npm run lint`, `npm run type-check`.
- Commits: semantic (`feat(penalties): …`, `test: …`), each ending with a blank line then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Single-family app: family row is `get_family(db)` (id=1); no `family_id` column needed.
- `penalties_enabled` default **off**. When off: no penalty button anywhere, and `POST /penalties` returns 409 "Penalties are off."
- A parent always taps. Nothing gives a penalty automatically.
- Siblings never see each other's penalties. Kid endpoints return only the caller's own.
- No negative balances: points stop at zero, bank stops at zero. Store `amount_taken` (what was actually taken).
- All points / bank / block writes inside `economy.SPEND_LOCK`.
- Make-up chores pay nothing: 0 points, no badge/streak credit.
- Parent UI uses existing `--p-*` tokens only (they match the mockup). Kid card keeps the fridge look, neutral tone, no red.
- Copy (exact): button "Give penalty", toast "Penalty given", sizes "Small · Medium · Big · Custom", repeat hint "2nd this week" (3rd+: "3rd this week"), reason placeholder line "+ Add a reason {Name} sees", line actions "change" (reason line when filled: "edit").

## Fixed values (builder's calls, use exactly)

- Kinds: `points` (amount = points, 1–1000), `screen` (amount = minutes, 5–600), `block` (amount = minutes, 60–20160 i.e. max 14 days).
- Default sizes (`DEFAULT_SIZES`):
  `{"small": {"kind": "points", "amount": 20, "earn_back": "all"}, "medium": {"kind": "block", "amount": 1440, "earn_back": "half"}, "big": {"kind": "block", "amount": 4320, "earn_back": "half"}}`. Size blocks target all of the kid's devices.
- Earn-back shares: `none`=0, `half`=1/2, `all`=1. `back_total = amount_taken * share` floored (`all` → `amount_taken`). Custom default `half`.
- Default make-up list (`DEFAULT_MAKEUP`): `["Wipe the kitchen counters", "Sweep the kitchen", "Fold a load of laundry", "Tidy the living room"]`. Default picks per penalty: first 2. 0 picks when `back_total == 0`.
- Slices: `n = makeup_count`; slice k (0-based, in approval order) = `back_total // n`, the last (k == n-1) adds `back_total % n`.
- Lifetime: block → `ends_at = created_at + amount min`. points/screen with make-up chores → `ends_at = created_at + 7 days`. points/screen with no make-up → status `ended` at creation (`ended_at = now`); kid card shows until seen.
- Repeat count = kid's penalties with `created_at >= now - 7 days` and `status != 'cancelled'`. Preselect: 0 → Small, 1 → Medium, ≥2 → Big. Hint shows when count ≥ 1.
- "All of {kid}'s" devices = devices the kid owns with `exempt == False`.
- Kid notification: kind `points_taken`, title `"{Parent name} gave you a penalty"`, body = summary text + (`" · " + reason` if reason).
- Shorten (blocks only) choices on the UI: "1 hour", "1 day", "Half" (half of remaining). API takes minutes.

## Review Focus

1. Family penalty when one kid has no devices (block): that kid still gets a record with `amount_taken = 0` and a card; others get blocked. Test in Task 4.
2. Points penalty when balance is 0 → `amount_taken = 0`, no make-up chores, record + card still created. Test in Task 4.
3. A parent's manual "Unlock" on a device does not delete the penalty override; a manual lock clear (`DELETE /devices/{id}/override`) leaves it too. Test in Task 2.
4. Make-up chore left undone overnight must not become `missed` or count against the chore lock / streak, and must still be finishable the next day. Test in Task 3.
5. Cancel after kid already spent refunded points: deleting the penalty ledger rows only raises the balance; never negative. Test in Task 5.

---

### Task 1: Data model + migration

**Files:**
- Create: `backend/app/models/penalty.py`, `backend/alembic/versions/g2a3b4c5d6e7_penalties.py`
- Modify: `backend/app/models/__init__.py`, `backend/app/models/lock.py` (Override), `backend/app/models/chores.py` (Chore, ChoreRun), `backend/app/models/points.py`, `backend/app/models/family.py`
- Test: `backend/tests/test_penalty_models.py`, add a round-trip test to `backend/tests/test_migrations.py`

**Interfaces — Produces:**
- `Penalty` (`__tablename__ = "penalties"`): `id`, `kid_id` (FK users, CASCADE, index), `group_id` String(32) null, `kind` String(6) CHECK in (`points`,`screen`,`block`), `amount` int, `amount_taken` int default 0, `amount_returned` int default 0, `back_total` int default 0, `makeup_count` int default 0, `earn_back` String(4) CHECK in (`none`,`half`,`all`), `device_ids` Text null (JSON list), `label` String(100) null (block target, e.g. "Nintendo" / "devices"), `reason` String(200) null, `chore_run_id` FK chore_runs SET NULL, `notification_id` FK notifications SET NULL, `given_by_id` FK users SET NULL, `created_at`, `ends_at` null, `ended_at` null, `status` String(9) CHECK in (`active`,`ended`,`forgiven`,`cancelled`) default `active`, `seen_by_kid` bool default false.
- `Override.source` CHECK becomes `('manual','bonus','penalty')`; new `Override.penalty_id` FK penalties CASCADE null.
- `ChoreRun.penalty_id` FK penalties SET NULL null, index. `Chore.makeup` bool default false.
- `Points.reason` CHECK adds `'penalty'`; new `Points.penalty_id` FK penalties SET NULL null.
- `FamilySettings.penalties_enabled` bool default false; `penalty_sizes` Text null; `makeup_chores` Text null (JSON; NULL = defaults).

- [ ] Step 1: Confirm head: `cd backend && /home/user/code/tskfrce/.venv/bin/alembic heads` → expect `f1a2b3c4d5e7 (head)`.
- [ ] Step 2: Write failing tests: `test_penalty_row_defaults` (add a Penalty for a kid, commit; assert status `active`, `amount_returned == 0`, `seen_by_kid is False`); `test_override_accepts_penalty_source` (Override(source="penalty", penalty_id=p.id) commits); `test_points_accepts_penalty_reason`; `test_family_penalties_off_by_default` (`get_family(db).penalties_enabled is False`). Migration: `test_penalties_migration_round_trips` following the existing pattern in `test_migrations.py` (upgrade head, downgrade `f1a2b3c4d5e7`, upgrade again; `penalties` table exists after upgrade).
- [ ] Step 3: Run, expect FAIL (import error).
- [ ] Step 4: Implement models and migration `g2a3b4c5d6e7` (down_revision `f1a2b3c4d5e7`) using `op.batch_alter_table` like `f1a2b3c4d5e7_less_parent_work.py`; downgrade drops everything and restores old CHECKs (delete `points` rows with reason `penalty` and overrides with source `penalty` first).
- [ ] Step 5: Run the new tests + `tests/test_migrations.py` → PASS. Run `alembic heads` → single head `g2a3b4c5d6e7`.
- [ ] Step 6: Commit `feat(penalties): penalty model and migration`.

### Task 2: Lock rules — penalty blocks

**Files:**
- Modify: `backend/app/lock/rules.py`, `backend/app/lock/state.py`, `backend/app/api/devices.py` (device payload)
- Test: `backend/tests/lock/test_penalty_lock.py` (create file; check `tests/lock/` for fixture style)

**Interfaces — Produces:** `DeviceFacts.penalty: bool = False`; `block_reason` may return `"penalty"`; device JSON gains `"penalty": {"id": int, "ends_at": str} | None` (newest live penalty override's penalty).

- [ ] Step 1: Failing tests (pure rules): `test_penalty_blocks_inside_hours_with_chores_done` (facts with `penalty=True`, all allowed → `block_reason == "penalty"`); `test_penalty_beats_bonus` (`bonus_active=True, points_unlock_early=True, bonus_any_hours=True` → `"penalty"`); `test_penalty_beats_exempt` (`exempt=True` → `"penalty"`); `test_manual_unlock_beats_penalty` (`override="unlock"` → `None`); `test_manual_lock_still_manual` (`override="lock", penalty=True` → `"manual"`).
- [ ] Step 2: DB tests: `test_device_facts_sees_penalty_override` (live `Override(source="penalty")` → `facts.penalty is True`; expired one → False); `test_clear_override_keeps_penalty` (`clear_override` and `set_override(...,"unlock",...)` leave the penalty row); API `test_device_payload_has_penalty` (`GET /api/v1/devices` row for that device has `penalty.id`).
- [ ] Step 3: Run → FAIL.
- [ ] Step 4: Implement. In `block_reason`, right after the `manual` lock check: `if f.penalty and f.override != "unlock": return "penalty"`. In `device_facts`: `penalty=any(o.source == "penalty" for o in live)`.
- [ ] Step 5: Run `tests/lock tests/test_e2e_lock.py` + new tests → PASS. Commit `feat(lock): penalty overrides block devices`.
- [ ] Step 6: Verify (report only, no code): blocker `firewall.py` only drops forwarded traffic and DNATs DNS/HTTP of blocked MACs to the box; the box itself (host network, INPUT path) and LAN stay reachable, so the kid app works while blocked. Note result in the task report.

### Task 3: Make-up runs stay out of daily counting

**Files:**
- Modify: `backend/app/services/chores.py` (`day_runs`, `day_or_waiting` day branch, `run_reset`), `backend/app/services/progression.py` (`chore_days_many`), `backend/app/services/boost.py`, `backend/app/services/badges.py` (done-run query ~line 89, `check_for_run`), `backend/app/services/recap.py` (~line 46), `backend/app/services/economy.py` (`award_chore`), `backend/app/api/chore_library.py` (`list_chores` filters `Chore.makeup.is_(False)`)
- Test: `backend/tests/test_makeup_runs.py`

**Interfaces — Consumes:** Task 1 columns. **Produces:** rule "a run with `penalty_id` is never in daily counts".

- [ ] Step 1: Failing tests (build a makeup run by hand: `make_chore(..., points=0, repeat="once", on_date=day)` then set `chore.makeup=True`, run `penalty_id=p.id`): `test_makeup_run_not_in_counts` (`chores.counts` excludes it); `test_makeup_run_rolls_forward_on_reset` (todo makeup run with `day < today`, `run_reset(db, today)` → status still `todo`, `day == today`; a normal todo run → `missed`); `test_makeup_run_pays_nothing` (approve via `chore_actions.approve` → no `Points` rows with that `run_id` and positive amount; returns 0); `test_makeup_not_in_streak_days` (`progression.chore_days_many` has no entry for that day when it's the only run); `test_makeup_chore_hidden_from_library` (`GET /api/v1/chores/` omits it).
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement: add `ChoreRun.penalty_id.is_(None)` to the listed queries. `run_reset`: before marking missed, `UPDATE` todo runs with `penalty_id IS NOT NULL AND day < day` → `day = day`, and exclude them from the missed update. `award_chore`: `if run.penalty_id: return 0` at top. `badges.check_for_run`: return early when `run.penalty_id`.
- [ ] Step 4: Run new tests + full `pytest tests -q` → PASS. Commit `feat(penalties): make-up runs skip points, streaks and chore lock`.

### Task 4: Penalty service — give

**Files:**
- Create: `backend/app/services/penalties.py` (give, settings helpers, `out`)
- Modify: `backend/app/services/economy.py` (`deduct` kwargs), `backend/app/services/screen_bank.py` (`take`, `put`)
- Test: `backend/tests/test_penalties_give.py`

**Interfaces — Produces:**
- `economy.deduct(db, kid_id, amount, note, by_id, run_id=None, *, reason="deduction", penalty_id=None, notify=True) -> int` (existing callers unchanged).
- `screen_bank.take(db, fam, kid_id, minutes) -> int` (takes `min(minutes, saved(...))`, sets row to `saved - take`; flushes) and `screen_bank.put(db, kid_id, minutes) -> None` (adds, creating the row).
- `penalties.DEFAULT_SIZES`, `penalties.DEFAULT_MAKEUP`, `penalties.sizes(fam) -> dict`, `penalties.makeup_list(fam) -> list[str]` (JSON or default).
- `penalties.Give` dataclass: `kind: str, amount: int, earn_back: str, reason: str | None = None, device_id: int | None = None, group_id: int | None = None, makeup: list[str] | None = None, chore_run_id: int | None = None, notification_id: int | None = None`.
- `penalties.give(db, kid_ids: list[int], g: Give, by: User, now: datetime) -> list[Penalty]` — one row per kid, shared `uuid4().hex` group_id when >1 kid; commits.
- `penalties.target_devices(db, kid: User, g: Give) -> tuple[list[Device], str]` — (devices, label): device → ([d], d.name); group → (group devices owned by kid, g.name); neither → (kid's non-exempt devices, "devices").
- `penalties.recent_count(db, kid_id, now) -> int`.
- `penalties.summary(p: Penalty) -> str` — "20 points" / "30 min of saved screen time" / "No {label}, {dur}" where dur = "1 day", "3 days", "2 hours", "1 day 3 hours".
- `penalties.out(db, p) -> dict` keys: `id, kid_id, group_id, kind, amount, amount_taken, amount_returned, back_total, label, earn_back, reason, given_by, created_at, ends_at, status, seen_by_kid, summary, makeup: [{run_id, title, status}]` (datetimes via `utc_z`).

- [ ] Step 1: Failing tests: `test_give_points_takes_and_records` (balance 50, small → `amount_taken 20`, ledger row reason `penalty`, `penalty_id` set, balance 30, 2 makeup runs for `back_total 20`); `test_give_points_zero_balance` (balance 0 → `amount_taken 0`, `back_total 0`, no makeup runs, status `ended`, kid notification exists); `test_give_screen_takes_bank_floor_zero` (bank 30, take 45 → `amount_taken 30`, bank 0); `test_give_block_all_devices` (kid owns 2 devices + 1 exempt → 2 `Override(source="penalty", action="lock", expires_at=now+1440m)`; `ends_at` set; `label == "devices"`); `test_give_block_group_only_kids_devices`; `test_family_penalty_one_row_per_kid_shared_group` (2 kids, one with no devices, block → 2 rows same `group_id`, deviceless kid `amount_taken 0`); `test_makeup_runs_created` (runs `kid_id`, `penalty_id`, `status todo`, chore `makeup True`, `points 0`, assignment `repeat once`); `test_custom_makeup_picks` (`makeup=["Rake leaves"]` → 1 run titled that); `test_recent_count_skips_cancelled`; `test_notification_to_kid_only` (kind `points_taken`, title "Mom gave you a penalty", sibling has none); `test_summary_texts` (table of 4 cases above).
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement. `amount_taken` for block = `amount` if devices else 0. Whole `give` under `SPEND_LOCK`. Make-up creation: `Chore(title, points=0, makeup=True, created_by_id=by.id, type_id=chore_types.other_id(db))`, `ChoreAssignment(mode="each", repeat="once", on_date=today, kids=[kid])`, `ChoreRun(day=today, kid_id=kid.id, penalty_id=p.id)`; `today = chores.today(db, now)`. Keep file < 500 lines.
- [ ] Step 4: Run → PASS. Commit `feat(penalties): give points, screen time and device-block penalties`.

### Task 5: Earn-back, shorten, forgive, cancel, expiry

**Files:**
- Create: `backend/app/services/penalty_earnback.py`
- Modify: `backend/app/services/chore_actions.py` (`approve` calls `penalty_earnback.on_approved(db, run)` when `run.penalty_id`), `backend/app/lock/state.py` (`tick`: call `penalty_earnback.expire(db, now)` before deleting expired overrides)
- Test: `backend/tests/test_penalties_earnback.py`

**Interfaces — Produces:**
- `on_approved(db, run) -> int` — returns slice given; points → `Points(+slice, points_type=TRANSFER, reason="penalty", penalty_id, description="Earned back: {title}")`; screen → `screen_bank.put`; block → `ends_at -= slice min`, every penalty override `expires_at = ends_at`; ends penalty (status `ended`) when block `ends_at <= now` or all make-up runs are done. No commit (caller commits).
- `shorten(db, p, minutes, now) -> None` (block only else `ValueError`); `forgive(db, p, now)`; `cancel(db, p, now)`; `expire(db, now) -> int`. `forgive/cancel/shorten` commit.
- Shared `_end(db, p, status, now)`: set status + `ended_at`, delete `Override` rows with that `penalty_id`, set open make-up runs (`todo`/`submitted`) to `cancelled`.

- [ ] Step 1: Failing tests: `test_points_slices_refund` (taken 20, half → back 10, n=2: first approve +5, second +5, status `ended`); `test_slice_remainder_on_last` (back 7, n=2 → 3 then 4); `test_screen_slice_rebanks`; `test_block_slice_pulls_end_earlier` (1440 half, n=2 → each approve `ends_at` −360, override `expires_at` matches); `test_block_all_back_ends_now` (share all, both done → status `ended`, no overrides); `test_makeup_via_trust_auto_still_earns` (kid in trust mode auto-approve path `approve(..., via="trust")` → slice applied); `test_shorten_block` and `test_shorten_points_rejected`; `test_forgive_keeps_taken_points_cancels_makeup`; `test_cancel_points_deletes_ledger_rows` (balance back to before; spent case: give 20, kid redeems some, cancel → balance never < 0); `test_cancel_screen_rebanks_unreturned`; `test_cancel_block_removes_overrides`; `test_expire_ends_due_penalties` (ends_at past → `ended`, make-up runs `cancelled`); `test_tick_expires_penalties` (via `lock.state.tick`).
- [ ] Step 2: Run → FAIL.
- [ ] Step 3: Implement (all money paths under `SPEND_LOCK`). Slice index k = count of that penalty's runs already `done` excluding this one.
- [ ] Step 4: Run new + full suite → PASS. Commit `feat(penalties): earn-back, shorten, forgive, cancel and expiry`.

### Task 6: API

**Files:**
- Create: `backend/app/api/penalties.py`, `backend/app/schemas/penalty.py`
- Modify: `backend/app/main.py` (include router — follow how `trust.router` is included), `backend/app/schemas/lock.py` (`FamilyPatch`: `penalties_enabled: bool | None`, `penalty_sizes: dict | None` validated by `PenaltySizes`, `makeup_chores: list[str 1–100 chars] | None` max 12), `backend/app/api/family.py` (`_fam_out` adds `penalties_enabled`, `penalty_sizes` (= `penalties.sizes(fam)`), `makeup_chores` (= `penalties.makeup_list(fam)`); patch stores dicts/lists as JSON), `backend/app/api/kids.py` (`_REASON_LABEL["penalty"] = "Penalty"`), `backend/app/api/kid.py` (`today` adds `"penalties"`; new `POST /kid/penalties/{id}/seen`)
- Test: `backend/tests/test_penalties_api.py`

**Interfaces — Produces (parent router `prefix="/api/v1"`, `dependencies=[Depends(require_parent)]`):**
- `GET /penalties/options` → `{"enabled": bool, "sizes": {...}, "makeup_chores": [str], "kids": [{"id", "name", "recent": int, "devices": [{"id","name"}], "groups": [{"id","name"}]}]}` (groups = groups containing ≥1 of the kid's non-exempt devices).
- `POST /penalties` body `PenaltyIn {kid_ids: list[int] (1–20), kind, amount, earn_back, reason?: str ≤200 (stripped, "" → None), device_id?, group_id?, makeup?: list[str] ≤5, chore_run_id?, notification_id?}` → `201 [penalty out]`. 409 when disabled; 422 when amount outside kind range or `device_id/group_id` given with >1 kid; 404 unknown kid.
- `GET /kids/{kid_id}/penalties` → active penalties, newest first.
- `POST /penalties/{id}/shorten {minutes: 15–20160}`, `POST /penalties/{id}/forgive`, `POST /penalties/{id}/cancel` → penalty out. 409 when not active (cancel also allowed on `ended`).
- Every write calls `trigger()` (same helper other lock-changing routes call) so the blocker updates now.
- Kid `today` → `"penalties": [out without chore_run_id/notification_id/given_by id, plus "by_name"]` for that kid only: status `active`, or status `ended` with `seen_by_kid False` and `back_total == 0`.

- [ ] Step 1: Failing tests: `test_give_requires_enabled` (409); `test_kid_cannot_give` (kid token → 401/403); `test_give_and_list`; `test_family_penalty_endpoint` (2 kids → 2 rows); `test_options_recent_and_targets`; `test_shorten_forgive_cancel_routes`; `test_kid_today_shows_only_own_penalty` (sibling's absent); `test_kid_seen_hides_points_card`; `test_kid_cannot_mark_siblings_seen` (404); `test_points_history_label_penalty`; `test_family_patch_penalty_settings` (round trip sizes + makeup list; bad kind → 422).
- [ ] Step 2: Run → FAIL. Step 3: Implement. Step 4: full suite + `ruff format backend && ruff check backend` → PASS.
- [ ] Step 5: Commit `feat(api): penalty endpoints, settings and kid payload`.

### Task 7: Frontend types, hooks and pure helpers

**Files:**
- Create: `frontend/src/v2/penaltyTypes.ts`, `frontend/src/v2/hooks/usePenalties.ts`
- Modify: `frontend/src/v2/types.ts` (Family gains `penalties_enabled`, `penalty_sizes`, `makeup_chores`; kid today payload gains `penalties: KidPenalty[]`)
- Test: `frontend/tests/v2/penaltyTypes.test.ts`

**Interfaces — Produces:**
- Types `PenaltyKind = 'points'|'screen'|'block'`, `EarnBack = 'none'|'half'|'all'`, `SizeKey = 'small'|'medium'|'big'`, `PenaltySize {kind, amount, earn_back}`, `Penalty` (mirrors Task 4 `out`), `KidPenalty` (Penalty + `by_name`), `PenaltyOptions` (Task 6 shape), `PenaltyDraft {kind, amount, earn_back, reason, device_id?, group_id?, makeup?}`.
- Helpers: `duration(min: number): string` ("1 day", "3 days", "2 hours", "1 day 3 hours"); `whatLine(d: PenaltyDraft, label: string): string` ("−20 points", "−30 min saved screen time", "No Nintendo, 1 day", all devices → "No devices, 1 day"); `earnLine(e: EarnBack): string` ("Earn back half" / "Earn back all" / "No earn-back"); `presetFor(recent: number): SizeKey` (0 small, 1 medium, ≥2 big); `repeatHint(recent): string | null` (1 → "2nd this week", 2 → "3rd this week", n → `${n+1}th this week`, 0 → null); `stepAmount(kind, amount, dir: 1|-1): number` (points ±5 within 5–1000; screen ±15 within 15–600; block: below 1 day ±1 hour within 60, else ±1 day max 20160); `kidTitle(p: KidPenalty, now: Date): string` (block: "No {label} until {Weekday}" when ends ≥ tomorrow, "No {label} until {h:mm a}" same day; points: "{amount_taken} points taken"; screen: "{amount_taken} min of saved screen time taken").
- Hooks: `usePenaltyOptions(enabled: boolean)`, `useKidPenalties(kidId)`, `useGivePenalty()` (toast "Penalty given"; invalidates `today`, `kids`, `kid-points`, `penalties`, `devices`), `usePenaltyAction()` (`{id, action: 'shorten'|'forgive'|'cancel', minutes?}`), `useSeenPenalty()` (kid).

- [ ] Steps: failing tests for each helper with the exact strings above → FAIL → implement (follow `hooks/useTrust.ts` style with `api()`) → PASS → `npm run type-check` → commit `feat(penalties): frontend types, hooks and copy helpers`.

### Task 8: PenaltySheet (the mockup)

**Files:**
- Create: `frontend/src/v2/today/PenaltySheet.tsx`, `frontend/src/v2/today/PenaltyLines.tsx` (the three summary lines + their open editors), `frontend/src/v2/parent/penalty.css` (import where other parent css is imported; check `cssCoverage.test.ts` rules)
- Test: `frontend/tests/v2/penaltySheet.test.tsx`

**Interfaces — Consumes:** Task 7. **Produces:** `<PenaltySheet kidIds={number[]} onClose={() => void} from?={{chore_run_id?: number; notification_id?: number}} reason?={string} inline?={boolean} />`. Title: one kid → "Give {Name} a penalty"; many → "Penalty for everyone". `inline` renders without the Modal (used inside WasntDoneSheet).

Layout = mockup v2 column 1/2: segmented bar (`SegmentedControl` from `parent/` if it matches `.seg`, else plain buttons styled like the mockup `.seg`), then `.sum` rows with "change", then full-width ink button "Give penalty". Changing line 1 shows chips: "Points", "Screen time", then one chip per device group, then "All devices"/each device, plus the stepper (− value +). Line 2 chips: none/half/all, and the make-up picks as toggle chips from `makeup_chores` (max picks 5). Custom selects Custom and opens line 1. Repeat hint shown at the bar's right in `--p-sub`. Family mode (`kidIds.length > 1`): line 1 offers Points, Screen time, "All devices" only; repeat preselect uses the max `recent` among kids.

- [ ] Step 1: Failing tests: renders Small/Medium/Big/Custom, "Give penalty"; `recent=1` preselects Medium and shows "2nd this week"; clicking "change" on line 1 opens only line 1 editor; Custom opens line 1; Give posts `{kid_ids, kind:'block', amount:1440, earn_back:'half'}` for Medium; reason typed → body has `reason`; family mode posts every kid id and hides device chips.
- [ ] Step 2: FAIL → implement → PASS. Keep each file < 250 lines. Commit `feat(penalties): compact penalty sheet`.

### Task 9: Entry points

**Files:**
- Modify: `today/KidFocus.tsx` (MoreMenu item "Give penalty", icon `gavel`), `today/TodayPage.tsx` (Today MoreMenu item "Penalty for everyone", icon `groups`), `today/WaitingActions.tsx` and `today/ChoreOpen.tsx` (a "Give penalty" menu item on a reviewed chore, passes `chore_run_id`), `today/WasntDoneSheet.tsx` (checkbox "Give penalty", unticked; ticked → `<PenaltySheet inline …/>` inside, and confirming "Wasn't done" also gives the penalty), `components/InboxRow.tsx` (bypass/resisting rows: "Give penalty" action with `notification_id`, kid = device owner if the notification carries one — if not derivable, open the sheet with kid picker of owners from `useDevices`; if still unknown, omit the action)
- Test: `frontend/tests/v2/penaltyEntry.test.tsx`

Every entry renders only when `useFamily().data?.penalties_enabled`.

- [ ] Steps: failing tests (each entry hidden when off, shown when on; WasntDone tick expands sheet) → implement → PASS → commit `feat(penalties): give a penalty from chores, alerts, kid and Today`.

### Task 10: Parent control after giving

**Files:**
- Create: `frontend/src/v2/manage/PenaltyList.tsx`
- Modify: `manage/KidDetail.tsx` (show `PenaltyList` when the kid has active penalties), `manage/DeviceRightNow.tsx` or `manage/DeviceDetail.tsx` (when `device.penalty`: text "Blocked by penalty" + "Forgive" button in place of Unlock), device reason label map (grep `'chores'` in `manage/deviceMeta.ts`/`activityText.ts`; add `penalty: 'Penalty'`), `types.ts` (Device gains `penalty`)
- Test: `frontend/tests/v2/penaltyList.test.tsx`

Compact row per penalty: icon + summary + "until {when}" / "{done} of {n} done"; tap expands to buttons: block → Shorten (chips "1 hour", "1 day", "Half"), Forgive, Cancel; points/screen → Forgive, Cancel. Cancel asks one confirm ("Undo this penalty? {Name} gets back what was taken.").

- [ ] Steps: failing tests (row renders, expand shows right buttons per kind, Shorten "1 day" posts minutes 1440, device page shows "Blocked by penalty" + Forgive) → implement → PASS → commit `feat(penalties): shorten, forgive and cancel from the kid page and device page`.

### Task 11: Kid card

**Files:**
- Create: `frontend/src/v2/kid/PenaltyCard.tsx`, `frontend/src/v2/kid/penalty-card.css`
- Modify: `kid/KidApp.tsx` (render cards right after `HappyHourBanner`)
- Test: `frontend/tests/v2/penaltyCard.test.tsx`

Mockup column 3 exactly: `kidTitle`, `“{reason}”, {by_name}` (no reason → `{by_name}`), meter `amount_returned / back_total` (hidden when `back_total == 0`), one line: make-up chores (`✓ title` done, `○ title` todo as a button that calls the existing kid done endpoint `POST /kid/chores/{run_id}/done`, `… title` submitted) and right "{done} of {n} done". Colors from mockup `.kid` (light `#fffaf0`/`#2b2416`/`#f0dfb8`, dark `#2a2418`/`#f6ead2`/`#4a3d22`, meter `#7cb518`). A card with `back_total == 0` calls `useSeenPenalty` on mount (shows once).

- [ ] Steps: failing tests (title/reason/meter; tapping ○ posts done; seen posted for no-earn-back card; nothing rendered for empty list) → implement → PASS → commit `feat(kid): penalty card with earn-back`.

### Task 12: Opt-in surfaces + settings

**Files:**
- Modify: `setup/StepExtras.tsx` (+ its parent wizard state; third card "Penalties": "Take something away, say why, and let them earn part back." switch), `today/tryCards.ts` (append `'try.penalties'` to `TRY_ORDER`), `today/TryCards.tsx` (text "Penalties: take points, saved time or a device away, with a way to earn it back." eligible when `!fam.penalties_enabled`; action turns it on), Settings Family pane (find the pane listing bedtime/recap via `settingsSections.ts` "Family"): a "Penalties" fold with the on switch, three size rows (each: kind + amount + earn-back, edited with the same Task 8 line editor), and the make-up list (add/remove, max 12)
- Test: `frontend/tests/v2/penaltySettings.test.tsx`; update existing StepExtras / TryCards tests if they assert counts

- [ ] Steps: failing tests → implement → PASS → commit `feat(penalties): opt-in from setup, Try card and Settings`.

### Task 13: E2E, docs, version

**Files:**
- Create: `frontend/e2e/penalties.spec.ts` (follow `kid-app.spec.ts` setup: enable penalties via API, give Medium from kid page, assert kid app card title starts with "No devices until", forgive from kid page, card gone)
- Modify: `docs/guide/` (add a short "Penalties" section where trust mode is documented), `docs/releases/` (2.9.0 notes, same format as existing), `backend/app/__init__.py` + `backend/tests/test_health.py` + `frontend/package.json` (+ `package-lock.json` top version) → `2.9.0`
- [ ] Steps: write spec, run `bash scripts/lab.sh up && bash scripts/lab.sh e2e` (or report if Docker lab can't run locally), bump, commit `chore(release): 2.9.0 penalties`.
