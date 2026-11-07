# Less parent work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-kid trust mode with spot checks, bedtime auto-approve, a weekly trend recap, and waiting chores that survive the daily reset.

**Architecture:**
- Backend: a new `services/trust.py` decides at submit and handles catches. `chore_actions.approve` stays the one approval path and records `approved_via`. Bedtime and recap jobs run from `notify_jobs.tick`. A new `services/recap.py` computes trends on request.
- Frontend: small additions to Needs, Today and the kid page; a new "Optional extras" setup step; a new `/recap` page.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, pytest; Next.js/React/TS, jest. No new dependencies. The sparkline is inline SVG.

**Spec:** `docs/superpowers/specs/2026-11-06-less-parent-work-design.md`. It wins any conflict with this plan.

## Global Constraints

- Rebase onto main after PR #66 merges. Target version 2.7.0, in the four version files (`frontend/package.json`, `frontend/package-lock.json`, `backend/tests/test_health.py`, `backend/app/__init__.py`).
- Default stays: a parent approves every chore. Everything here is opt-in except the recap (on by default) and waiting chores surviving the reset.
- Levels: 0 New (no self-approval), 1 Trusted (1 in 5 spot check), 2 Proven (1 in 20). Clean count: 10 from New to Trusted, 30 more from Trusted to Proven. It resets at every level change.
- Latest migration is `a0b1c2d3e4f5`. Add `b1c2d3e4f5a6`.
- Use existing theme tokens. UI tasks need mockups the owner approved (Task 7) and light and dark screenshots on phone (390×844 @2x) and desktop (1280×900), compared against them.
- CI: `cd backend && python -m pytest tests -q`, `ruff check .` and `ruff format --check .` on the whole backend, plus jest. Query budgets: `/kid/today` 20, `/today` 24; raise only with a written reason.
- Files under 500 lines. `frontend/src/v2/types.ts` is at 494, so new types go in `frontend/src/v2/trustTypes.ts`.
- Semantic commits, each ending:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011K7jrVbDK9XkJbLGVTb23M
  ```

## Review Focus

1. **Take back after spending:** a kid at balance 5 spent the 10 points a chore earned. Wasn't done leaves them at 0 and owing nothing. A kid already at -3 from `/undo` stays at -3; the floor never forgives older debt.
2. **Spot check left for days:** a spot-checked chore from Monday survives the Tuesday and Wednesday resets, shows in Needs labelled Monday, ignores bedtime, and pays with its Monday Happy Hour multiplier when approved.
3. **Double tap or race:** Wasn't done tapped twice, or a parent approving while bedtime runs, pays or removes points once. The second call gets a 409. The bedtime job running twice in one minute approves once.
4. **Trust switched off mid-flight:** turning trust mode off leaves chores already approved as they are, and the next chore waits for a parent. The stored level is kept, so turning it back on resumes there.
5. **Timezones and missed runs:** a DST-change Sunday sends one recap, and a box down over 19:30 for more than 2 hours skips that week rather than sending on Monday.

---

### Task 1: Data and trust rules

**Files:**
- Create: `backend/alembic/versions/b1c2d3e4f5a6_less_parent_work.py`, `backend/app/models/trust.py` (`TrustEvent`), `backend/app/services/trust.py`, `backend/tests/test_trust.py`
- Modify: `backend/app/models/user.py`, `models/chores.py`, `models/family.py`, `models/__init__.py`

**Columns:** exactly the spec's Data section, with server defaults, plus `family_settings.waiting_reset_days` (int, default 0; Task 10). `trust_events`: `id, kid_id (FK cascade), at, kind ('up'|'down'|'catch'), run_id (FK SET NULL), by_id (FK SET NULL)`.

**Produces (`services/trust.py`):**
- `SPOT = {1: 5, 2: 20}`, `UP_AT = {0: 10, 1: 30}`
- `payees(run) -> list[int]`: `economy._recipients` semantics.
- `decide(db, run, kid_ids, rng=random.random) -> Literal['auto','spot','wait']`: `wait` if the chore is `always_check`, or any payee has trust off, or the lowest level is 0. Otherwise one roll for the run: `spot` if `rng() < 1/SPOT[lowest]`, else `auto`.
- `count_clean(db, kid_ids) -> None`: for each kid with trust on, `trust_clean += 1`, promoting at `UP_AT`, resetting the count, writing an `up` event and sending messages.
- `catch(db, run, kid_ids, by_id, lower: bool) -> None`: writes one `catch` event per kid; when `lower`, drops a level (floor 0) and writes `down`. The count resets either way.
- `set_level(db, kid, level, by_id)`: hand set, resets count, writes `up` or `down`.

**Messages (new inbox kinds, kid kinds added to `KID_KINDS` and `push.GENERIC`):**
- Parent `trust_up`: "{Name} is now {Level}. Most chores will approve themselves, with spot checks."
- Kid `trust_up`: "You're now {Level}!"
- Kid `trust_down`: "Your trust level went back to {Level}. Keep going and you'll earn it back."

- [ ] **Step 1:** Write failing tests: `test_decide_wait_when_off`, `test_decide_wait_at_new`, `test_decide_always_check_waits`, `test_decide_rates` (rng 0.19 → spot at Trusted, 0.21 → auto; 0.04 and 0.06 at Proven), `test_team_uses_lowest_and_any_off_waits`, `test_clean_promotes_at_10_then_30`, `test_clean_ignored_when_off`, `test_catch_drops_one_and_floors_at_new`, `test_catch_without_lower_only_resets_count`, `test_set_level_resets_count`.
- [ ] **Step 2:** Run `cd backend && python -m pytest tests/test_trust.py -q`. Expected: fails on import.
- [ ] **Step 3:** Implement. Check the migration upgrades and downgrades on an empty SQLite database, using the same approach as `z9c0d1e2f3a4`.
- [ ] **Step 4:** Tests pass; the full suite and ruff are clean.
- [ ] **Step 5:** Commit `feat(trust): levels, spot-check rolls and catches`.

### Task 2: Approval flow

**Files:**
- Modify: `services/chore_actions.py`, `services/chores.py` (`state`, `counts`), `api/kid.py` (`done`), `api/chores.py` (`approve`, `done`, `send-back`), `integrations/apply.py`, `api/chore_library.py` (`always_check` in and out), `tests/test_trust_flow.py`

**Interfaces:**
- `chore_actions.approve(db, run, by_id, via='parent')`. It sets `approved_via` and, unless `via == 'integration'`, calls `trust.count_clean`.
- `state(run)` returns `done` when status is done and (approver is a parent, or `approved_via in ('trust','bedtime')`). Integration rows keep today's behavior.
- `POST /kid/chores/{id}/done` response: `status` becomes `"done"` on `auto`, otherwise `"submitted_for_approval"`.

**Rules:**
- Only the kid path calls `trust.decide`. `auto` calls `approve(..., None, via='trust')` and sends no `chore_submitted` and no `request.created`. `spot` sets `run.spot_check = True` and notifies as usual. `wait` is unchanged.
- `send_back`: if `run.spot_check`, call `trust.catch(..., lower=True)`, then clear `spot_check`. Submitter drops a level; other team payees only reset counts. If nobody is recorded as submitting, every payee drops.

- [ ] **Step 1:** Write failing tests: `test_off_kid_unchanged_and_notifies`, `test_auto_pays_once_no_parent_alert`, `test_auto_state_is_done_and_counts_toward_progress`, `test_spot_waits_and_is_flagged`, `test_always_check_waits_at_proven`, `test_parent_mark_done_not_rolled`, `test_integration_not_rolled_or_counted`, `test_send_back_spot_is_catch`, `test_send_back_normal_is_not_catch`, `test_trust_off_keeps_level_and_next_chore_waits` (Review Focus 4), `test_auto_keeps_happy_hour_multiplier`.
- [ ] **Step 2:** Run them. Expected: fail.
- [ ] **Step 3:** Implement. Read every caller of `state`, `counts` and `approved_by` and fix any that assume a parent approver, including `kid_view`, `kid_alerts` and `badges`.
- [ ] **Step 4:** Full suite and ruff clean. `/kid/today` budget still 20.
- [ ] **Step 5:** Commit `feat(trust): self-approving chores and spot checks`.

### Task 3: Waiting chores survive the reset

**Files:** `services/chores.py` (`run_reset`, new `waiting_runs(db)`), `api/family.py` (`_needs_you` input, `pending_approvals`), `services/notify_jobs.py` (`daily_summary` count), `tests/test_waiting_past_reset.py`

**Interfaces:** `waiting_runs(db) -> Query`: all `status == 'submitted'` runs, any day, oldest first, with detail loaded. Each Needs item gains `day` and `spot_check`.

**Rules:** `run_reset` cancels only `todo`. Approving a past-day run pays through the normal path; the kid `done` same-day check stays.

- [ ] **Step 1:** Write failing tests: `test_reset_keeps_submitted_cancels_todo`, `test_needs_lists_older_days_labelled`, `test_pending_count_includes_older`, `test_late_approval_keeps_multiplier_and_bonus`, `test_old_waiting_does_not_gate_todays_lock`, `test_summary_counts_older_waiting`, `test_kid_delete_handles_older_waiting` (see `api/kids.py:125`).
- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement. `/today` budget still 24 or raised with a reason.
- [ ] **Step 4:** Full suite clean. Update tests that pinned the old cancel behavior, naming each in the commit body.
- [ ] **Step 5:** Commit `feat(chores): waiting chores stay until a parent answers`.

### Task 4: Wasn't done, and trust API

**Files:** `api/chores.py` or new `api/trust.py` (keep `api/chores.py` under 500), `api/kids.py`, `services/economy.py` (`take_back`), `tests/test_take_back.py`

**Interfaces:**
- `economy.take_back(db, run) -> dict[int,int]`: deletes the run's positive rows under `SPEND_LOCK`. For each kid, if the new balance is below `min(0, balance_before)`, adds one correcting row to bring it to `min(0, balance_before)`, using the existing ledger type closest to an adjustment. Returns points removed per kid.
- `POST /api/v1/chores/{run_id}/take-back` body `{lower_trust: bool = true}`, parent-only. 409 unless `status == 'done'` and `approved_via in ('trust','bedtime')`. Today's run goes to `todo` and clears ticks, approval, `spot_check`, `hh_mult_x10`, submit fields. Older runs go to `cancelled`. Chat line. Kid kind `chore_sent_back` with "A parent checked {title} and it needs another go." Calls `trust.catch`.
- `GET /api/v1/kids/{id}/self-approved`: runs approved `trust` or `bedtime` in the last 7 days, newest first, with points and photo count.
- `PATCH /kids/{id}` accepts `trust_mode` and `trust_level`. Kid out gains `trust_mode`, `trust_level`, `trust_clean`. `/kid/today` gains `trust: {level, to_next} | null`, null when off.

- [ ] **Step 1:** Write failing tests: `test_take_back_removes_multiplied_and_bonus_rows`, `test_stops_at_zero_when_spent`, `test_older_debt_not_forgiven` (Review Focus 1), `test_second_tap_409` (Review Focus 3), `test_parent_approved_run_409`, `test_today_returns_to_todo_rerolls_on_resubmit`, `test_older_day_cancels`, `test_badges_stay`, `test_lower_false_keeps_level`, `test_team_all_lose_only_submitter_drops`, `test_self_approved_window_7_days`, `test_patch_trust_parent_only`.
- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full suite and ruff clean.
- [ ] **Step 5:** Commit `feat(trust): wasn't done and trust settings API`.

### Task 5: Bedtime auto-approve

**Files:** `services/bedtime.py`, `services/notify_jobs.py` (`tick`), `api/family.py` (fields and validation), `tests/test_bedtime.py`

**Interfaces:** `bedtime.run(db, now_utc) -> int`, run in `tick` before `boost.run`.

**Rules:**
- Off by default. Skipped during setup. Once per local day via `bedtime_date`.
- Approves `waiting_runs` where neither `spot_check` nor chore `always_check`, with `via='bedtime'`, each in its own savepoint so one bad run doesn't stop the rest.
- If 1 or more, adds parent inbox row kind `bedtime_done`, "Bedtime approved 3 chores." It's not in `KIND_EVENT` and sends no push, so nobody's woken and it's waiting in the morning. Singular: "Bedtime approved 1 chore."
- Validation: `bedtime_auto_at` between `18:00` and `23:30`, on a 15-minute step. If `reset_time` is in that range, latest is 15 minutes before it. Otherwise 422.

- [ ] **Step 1:** Write failing tests: `test_off_does_nothing`, `test_fires_once_at_time` (Review Focus 3), `test_skips_spot_and_always_check`, `test_clears_older_days_except_spot` (Review Focus 2), `test_counts_clean`, `test_take_back_works_on_bedtime_run`, `test_non_trust_kid_no_new_spot_checks`, `test_skipped_during_setup`, `test_inbox_line_plural_and_none`, `test_no_push`, `test_time_validation`, `test_tz_local_day`.
- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Full suite and ruff clean.
- [ ] **Step 5:** Commit `feat(bedtime): opt-in auto-approve at a set time`.

### Task 6: Weekly recap backend

**Files:** `services/recap.py`, `api/recap.py` (prefix `/api/v1/recap`, parent-only), `services/notify.py`, `services/inbox.py` (`path_for`), `services/notify_jobs.py`, a second migration step for the `recap` event in `b1c2d3e4f5a6`, `tests/test_recap.py`

**Interfaces:**
- `recap.week_of(db, week_start: date | None) -> dict`: `{week_start, week_end, prev, next, kids: [{id, name, flags: [{kind, text, action}], done, done_trend: [int x5], on_time_pct, on_time_avg, points_earned, points_spent, screen_minutes_bought, streak, enough_history}], family_line, all_good}`.
- `GET /api/v1/recap?week=YYYY-MM-DD` returns that. A week is Monday to Sunday local. Default is the latest week ending today or earlier, so Sunday's message shows the week just finishing.
- `recap.send(db, now_utc) -> None`, in `tick`: on Sunday at 19:30 local or later, once per `recap_date`, skipping if more than 2 hours late, when `recap_weekly` is on and setup is done. Uses `inbox.notify_parents(db, 'recap', f'Your week at {fam.name}', body)`. `KIND_EVENT['recap'] = 'recap'`, added to `DEFAULT_EVENTS`, labelled "Weekly recap", with a migration appending it to existing places' `events`.

**Flag rules, exact:**
| kind | Fires | action |
|---|---|---|
| `dropping` | Mean chores per assigned-week for last 2 weeks is 30%+ below the 4 before; baseline mean ≥ 5 | `happy_hour` |
| `later` | On-time rate down 20+ points, same windows; baseline has ≥ 5 chores with a deadline | `kid` |
| `catches` | ≥ 2 catch events this week | `trust` |
| `streak_ended` | A streak ≥ 7 ended this week | `kid` |

Order `catches, dropping, later, streak_ended`, at most 3 per kid. `enough_history` is false, and trend flags don't fire, until the kid has 2 full weeks of runs. A week with no assigned runs is left out of means. `family_line`: "Best week in a month." when total chores done beats each of the 4 before, else null.

- [ ] **Step 1:** Write failing tests: one per flag firing and one just under each threshold; `test_holiday_week_not_a_drop`, `test_new_kid_no_trends`, `test_all_good`, `test_cap_three_flags`, `test_on_time_excludes_no_deadline`, `test_send_once`, `test_send_skips_when_late` and `test_dst_sunday_once` (Review Focus 5), `test_off_switch`, `test_existing_place_gets_event_after_migration`, `test_parent_only`, `test_query_budget` (≤ 30).
- [ ] **Step 2:** Run. Expected: fail.
- [ ] **Step 3:** Implement. Use set-based queries for the 6-week window, not per-kid loops.
- [ ] **Step 4:** Full suite and ruff clean.
- [ ] **Step 5:** Commit `feat(recap): weekly trends and flags`.

### Task 7: Mockups (owner gate)

Controller task, no code. Restart the visual companion and show mockups matching the app's theme tokens, light and dark, phone and desktop:
1. `/recap`: flags, kid card, sparkline, all-good state.
2. Setup "Optional extras" step.
3. Kid page trust section and "Approved on their own" list.
4. Needs "Spot check" mark, Today "Approved on its own" mark, and the Wasn't done sheet.
5. Kid Me chip.

- [ ] Get owner approval. This is the one planned stop. Copy approved files to `.superpowers/mockups/` and pass the paths to Tasks 8 to 11.

### Task 8: Parent trust UI

**Files:** new `frontend/src/v2/manage/TrustSection.tsx`, `SelfApprovedList.tsx`, `today/WasntDoneSheet.tsx`, `hooks/useTrust.ts`, `v2/trustTypes.ts`; modify `manage/KidDetail.tsx`, `manage/ChoreDetail.tsx` (Always check switch), Needs list item, Today chore row.

**Rules:** The level picker is hidden until the switch is on. Needs shows "Spot check" and, for older chores, the day. Wasn't done confirm has "Also lower trust level" ticked.

- [ ] Write failing jest tests for: switch PATCH body; picker hidden when off; level PATCH; Spot check mark and day label; Wasn't done body with the box ticked and unticked; marks only on `approved_via` trust or bedtime; empty list state; Always check body.
- [ ] Implement, run jest, take screenshots, compare with mockups.
- [ ] Commit `feat(ui): trust mode for parents`.

### Task 9: Kid trust UI

**Files:** new `kid/TrustChip.tsx`; modify the Me page, the chore-done handler in `hooks/useKid.ts`, and `kid/celebrate/triggers.ts`.

**Rules:** When `/done` returns `done`, the tile goes straight to done with its points and the normal celebration. When `trust.level` rises since last seen, one celebration. No chip when `trust` is null. Copy suits Little, Kid and Teen modes; a spot check shows nothing different.

- [ ] Write failing jest tests: `done` response path; spot check looks like a normal wait; chip hidden when null; `to_next` line; level-up fires once, including when seen on next open; reduced motion.
- [ ] Implement, screenshot in all 3 modes, compare with mockups.
- [ ] Commit `feat(kid): trust chip and instant approval`.

### Task 10: Finding the opt-ins

**Files:** new `setup/StepExtras.tsx`; modify `setup/setupStep.ts` (`LAST = 8`), `setup/WizardFrame.tsx`, `setup/StepFinish.tsx`, the server guard and migration from `w6f7a8b9c0d1` (limit becomes 8), `today/TryCards.tsx`, `today/tryCards.ts`, Settings panes (bedtime switch and time, recap switch), `/today` payload (`try_trust_kid`, `waiting_at_reset_days`).

**Rules:** Extras is step 7, Finish is step 8. A family stored at step 7 lands on Extras; a stored step above 8 can't loop. Everything off, and one tap skips. Add `try.trust` and `try.bedtime` to `TRY_ORDER` after the existing four. Trust card: a kid with 10 approved chores and trust off. Bedtime card: chores waiting at reset on 3 days, counted by `family_settings.waiting_reset_days` (column from Task 1), incremented at `run_reset` when it finds any waiting chore. Bedtime's time stays hidden until its switch is on.

- [ ] Write failing tests: backend step guard at 8 with no redirect loop; `waiting_reset_days` count; jest for extras switches and bodies, skip, step save, card conditions, order and pacing, hidden time.
- [ ] Implement, screenshot, compare with mockups.
- [ ] Commit `feat(ui): optional extras step and try cards`.

### Task 11: Recap page

**Files:** new `frontend/pages/recap.tsx`, `v2/recap/RecapPage.tsx`, `RecapKidCard.tsx`, `Sparkline.tsx`, `hooks/useRecap.ts`. Link from More and from the inbox item.

**Rules:** Flags come first and act in one tap: `happy_hour` opens the existing `HappyHourButton` sheet for that kid, `kid` opens their page, `trust` opens their trust section. `all_good` shows "All good this week". `enough_history: false` shows "Trends start after 2 weeks." Prev and next week controls; next disabled at the latest week. The sparkline has an `aria-label` stating the numbers.

- [ ] Write failing jest tests: order; all-good state; new-kid line; each action's target; week navigation; sparkline label.
- [ ] Implement, screenshot, compare with mockups.
- [ ] Commit `feat(ui): weekly recap page`.

### Task 12: Docs, site, version

- [ ] Update guide 04 (trust mode, spot checks, Wasn't done, bedtime, recap, chores waiting past the reset) with screenshots; guide 03 (extras step); guide 05 (kid line on levels); Pages feature line; spec "As built"; 2.7.0 release notes naming the waiting-chores default change.
- [ ] Version 2.7.0 in the four version files.
- [ ] Run `python3 scripts/build_site.py && node site/check.mjs` and `python -m pytest tests/test_health.py -q`.
- [ ] Commit `chore(release): 2.7.0`.
