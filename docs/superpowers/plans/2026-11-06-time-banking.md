# Time banking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unused daily screen-time room carries over into a per-kid bank, capped by parents, so kids can save up for a bigger day.

**Architecture:** New family settings and a `screen_banks` table. A settle step runs in the lock tick just before the chore reset moves the day. `screen_time` limits add `min(bank, cap)`. The APIs expose `saved`, and two small UI additions show it.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, pytest; Next.js/React/TS, jest.

**Spec:** `docs/superpowers/specs/2026-11-06-time-banking-design.md`. Its "How it works" and "Settled after the code check" sections hold the exact rules and copy.

## Global Constraints

- Defaults: `screen_rollover` is true. `screen_bank_cap` is null, meaning the cap equals the kid's effective daily max.
- The cap is 15–480 in steps of 15. PATCH accepts null to clear it.
- Each request stays 15–120 minutes (`SCREEN_MINUTES` is unchanged).
- Bank is never < 0. The effective bank is never above the cap: `limit = daily_max + min(bank, cap)`.
- No daily max, or screen time off, means nothing banks and the banking UI is hidden.
- Turning rollover off zeroes every bank.
- Use existing theme tokens and components only. Take light and dark screenshots on phone (390×844 @2x) and desktop (1280×900).
- Keep files under 500 lines. Use semantic commits. Version 2.5.0.
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011K7jrVbDK9XkJbLGVTb23M
  ```

## Review Focus

1. **The tick runs twice in the same minute around the reset.** The bank is credited once (idempotent on `screen_banks.day`).
2. **The box was off for 3 days.** Only the old `last_reset_date` day settles, so there is no big credit.
3. **A parent lowers the daily max from 60 to 30 while the bank is at 60.** Today's limit is 30 + 30, not 30 + 60.
4. **A kid buys 120 minutes on a day with max 60 and bank 60.** The bank goes to 0 at settle, never negative.
5. **Fresh install (`last_reset_date` null).** There is no settle and no crash.

---

### Task 1: Bank model, settle, limits

**Files:**
- Migration after head `w6f7a8b9c0d1`.
- `backend/app/models/family.py`: add two columns.
- New model `backend/app/models/screen_bank.py`, registered in `models/__init__.py`.
- New `backend/app/services/screen_bank.py`, under 150 lines.
- `backend/app/services/screen_time.py`: `check` and `limit` use the bank.
- `backend/app/lock/state.py`: call settle before `run_reset`.
- Tests: new `backend/tests/test_screen_bank.py`.

**Interfaces:**
- Produces `screen_bank.saved(db, fam, kid_id) -> int`. This is the effective bank, `min(bank, cap)`, and returns 0 when banking is inactive.
- Produces `screen_bank.settle(db, fam, now_utc) -> None`. It is idempotent per old day.
- Produces `screen_bank.clear_all(db) -> None`.
- Produces `screen_bank.cap_for(db, fam, kid_id) -> int | None`.

- [ ] Write failing tests:
  - quiet day: max 60, bought 20 → bank 40
  - accumulate to cap: two quiet days at max 60, cap null → bank 60
  - spending beyond max: max 60, bank 60, bought 120 → bank 0
  - pending counts as used
  - idempotent double settle
  - missed resets settle only the old day
  - fresh install skips
  - lowered max caps at read time
  - max cleared → bank zeroed at next settle and saved = 0
  - screen time off → nothing banks
  - rollover off → nothing banks
  - `check()` lets the kid buy up to max + saved and blocks beyond it, with the existing error copy
- [ ] Implement. Settle computes bought minutes over the old day's window: the old `day_start_utc` up to the new day start, with an upper bound on `created_at`, and pending + approved counted the same way `bought_today` does. Reuse helpers rather than duplicating them.
- [ ] Run the new and existing screen-time and economy tests. Then run the full suite in the foreground (about 7 minutes). Keep ruff check and format clean across the whole backend.
- [ ] Commit `feat(screen-time): bank unused daily room`.

### Task 2: APIs

**Files:**
- `backend/app/api/screen_time.py`: GET/PATCH gain `rollover: bool` and `bank_cap: int | None` (null carve-out, 15–480 step 15). Turning rollover off calls `clear_all`. Each kid row gains `saved`.
- `backend/app/api/kid_rewards.py`: `screen.saved`, plus `max_today`/`left_today` including saved.
- Tests in the existing API test files.

- [ ] Write failing tests:
  - round-trip `rollover` and `bank_cap`
  - `bank_cap` of 10, 20 or 495 gives 422; null clears it
  - turning rollover off zeroes banks
  - kid rewards shows `saved` and a raised `left_today`
- [ ] Implement, then run the full suite.
- [ ] Commit `feat(api): rollover settings and saved minutes`.

### Task 3: Parent UI

**Files:**
- `frontend/src/v2/manage/ScreenTimePane.tsx` and its limits list.
- `frontend/src/v2/rewardTypes.ts`.
- Tests.

**Copy:** use the spec's "Save unused time" switch, hint, "Save up to" field with placeholder `Same as the daily max (${max})`, and "Saved: N min" text, exactly as written. All of it shows only when screen time is on and a daily max is set. The field shows only when the switch is on.

- [ ] Write failing jest tests:
  - the elements are hidden with no max
  - hidden when screen time is off
  - the field is hidden when rollover is off
  - clearing the field sends `bank_cap: null`
  - the Saved label renders
- [ ] Implement using the existing switch and number-field patterns in that pane.
- [ ] Run jest, tsc and eslint.
- [ ] Take screenshots in light and dark, phone and desktop: rollover on with the field, rollover off, and a kid row showing Saved.
- [ ] Commit `feat(ui): save unused time setting`.

### Task 4: Kid UI

**Files:**
- `frontend/src/v2/kid/RewardsSection.tsx`.
- Types and tests.

- [ ] Write a failing test: with `saved` 40, `max_today` 100 and `left_today` 80, the text "You saved 40 min — today you can buy up to 100 min." shows, and the picker steps are ≤ min(120, left). With `saved` 0 there is no saved line.
- [ ] Implement and take screenshots in light and dark, phone and desktop, in Kid mode. Also take one phone shot each in Little and Teen modes.
- [ ] Commit `feat(kid): show saved screen time`.

### Task 5: Docs, site, version

- [ ] Guide 04: a "Saving unused time" section. Guide 05: one line. A Pages feature line. Bump 2.4.0 → 2.5.0 in the four version files. Add an "As built" section to the spec.
- [ ] Add a guide image for the parent setting if it helps (follow SHOTS.md rules), and add its row to SHOTS.md.
- [ ] Run `python3 scripts/build_site.py && node site/check.mjs` and test_health.
- [ ] Commit `docs: time banking; 2.5.0`.
