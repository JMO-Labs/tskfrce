# Turnkey defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the 12 owner-approved default and visibility changes so a new family gets a good experience with no extra setup.

**Architecture:** Backend default changes only apply when `/setup` creates the family or while `setup_step` is set. Existing families keep their saved values, so no data migration is needed. Frontend changes are conditional rendering and copy, using existing components and theme tokens.

**Tech Stack:** FastAPI, SQLAlchemy, pytest; Next.js/React/TS, jest.

**Spec:** `docs/superpowers/specs/2026-11-06-turnkey-defaults-design.md`. Its "Recommended changes" items 1–12 give the exact values and copy. Each task names the items it owns.

## Global Constraints

- Use the exact defaults and copy from the spec's items 1–12.
- Existing families must not change behaviour: no migration alters stored values.
- Use existing theme tokens and components only, with no new colours.
- Take light and dark screenshots on phone (390×844 @2x) and desktop (1280×900) for every visible UI change.
- Keep files under 500 lines. Use semantic commits. Version 2.4.0.
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011K7jrVbDK9XkJbLGVTb23M
  ```

## Review Focus

1. **A family that finishes setup mid-day:** no device is chore-locked today, hour rules still apply today, and tomorrow's chores are created at `reset_time`.
2. **An existing family upgrading:** `points_unlock_early`, notification places and hour rules stay as they are.
3. **Notification places created before this change** keep their saved events. Only new places get the new defaults.
4. **The wizard resumed at an old step 8** (remote access) after upgrade: it must land on Finish and not crash.
5. **Hidden settings keep their saved values** when hidden. Turning the parent switch back on shows them unchanged.

---

### Task 1: Backend defaults (items 1, 3, 5)

**Files:** `backend/app/api/chore_library.py`, `backend/app/api/setup.py`, `backend/app/services/notify.py`, `backend/app/api/internal.py`, plus tests in a new `backend/tests/test_turnkey_defaults.py`.

- [ ] Write failing tests:
  - `test_wizard_chores_start_tomorrow`: with `setup_step=5`, adding a starter chore creates no run for today, and the run for tomorrow appears after reset or the finish path.
  - `test_chores_after_setup_start_today`: with `setup_step=None`, there is a run today (behaviour unchanged).
  - `test_new_family_screen_time_on`: `/setup` family creation sets `points_unlock_early=True` and `screen_auto_approve=False`.
  - `test_default_events`: `DEFAULT_EVENTS` equals the spec's tuple, without `new_device` and with `summary`.
  - `test_no_new_device_bell_during_setup`: device-seen during setup creates no `new_device` inbox row.
  - `test_existing_place_events_unchanged`: a place created with the old defaults keeps them.
- [ ] Implement the changes per spec items 1, 3 and 5. If the daily summary needs a scheduled time, confirm how `summary` works today (grep `summary` in services). Use the spec's 19:00 only if a time setting exists; otherwise ledger it.
- [ ] Run the new tests, then the full backend suite (foreground, about 7 min). Keep ruff clean on touched files.
- [ ] Commit `feat(setup): turnkey backend defaults`.

### Task 2: Wizard (items 1 copy, 2, 9, 10)

**Files:** `frontend/src/v2/setup/StepHours.tsx`, `setup.tsx`, `StepFinish.tsx`, `starterChores.ts`, `setupStep.ts`, `WizardFrame.tsx`, `StepRemote.tsx` (its content moves to Finish as a tip), plus the matching tests.

- [ ] Write failing jest tests:
  - DEFAULT_DRAFTS has the spec's single windows.
  - The finish screen shows the spec copy and the Tailscale tip.
  - The wizard has 7 steps.
  - The Homework starter sends `repeat: {type:'weekly', days:[0,1,2,3,4]}`.
  - Resuming at stored step 8 opens Finish.
- [ ] Implement. If the backend clamps or validates `setup_step` at 8, adjust it so 7 is LAST, and add a backend test.
- [ ] Run jest, tsc and eslint.
- [ ] Take screenshots: Hours step, Finish step, light and dark × phone and desktop.
- [ ] Commit `feat(setup): friendlier default hours, 7-step wizard`.

### Task 3: Settings visibility (items 4, 6, 7, 8, 11)

**Files:** `frontend/src/v2/manage/ScreenTimePane.tsx`, `GroupDetail.tsx`, `NotificationsPane.tsx`, `FamilyCards.tsx`, `DeviceDetail.tsx`, plus tests.

- [ ] Write failing jest tests, one per item:
  - Hidden while off, shown when on.
  - The off-state hint copy appears as written in the spec.
  - Folds are closed by default.
  - Guest devices have no "Always allowed".
- [ ] Implement using existing Fold/switch components. Find the `Fold` component name in the codebase; do not add a new one.
- [ ] Run jest, tsc and eslint.
- [ ] Take screenshots of each pane in its off and on states, light and dark × phone and desktop. Pick the minimal set that shows every change.
- [ ] Commit `feat(ui): hide settings until their switch is on`.

### Task 4: Kid phone alerts copy (item 12)

**Files:** `frontend/src/v2/manage/KidPushPane.tsx`, plus its test.

- [ ] Write failing tests for the honest privacy line, the "not set up" copy and the fold. Controller-verified fact: generic nudges ("check t@sk4ce", no chore text) go to `NTFY_UPSTREAM_URL` (default ntfy.sh) for code-enrolled phones whenever it is set, regardless of the in-pane switch. The copy must say exactly that.
- [ ] Implement, then run tests and take screenshots.
- [ ] Commit `fix(ui): honest kid phone alert copy`.

### Task 5: Docs, site, version

- [ ] Update the guide so it matches every change:
  - `03-first-setup.md`: 7 steps, hours, chores start tomorrow, the remote access tip.
  - `04-everyday-use.md`: screen time on by default, notification defaults, hidden settings.
  - Kid phone alerts privacy wording wherever it appears.
  - Retake the wizard guide images listed in `docs/guide/img/SHOTS.md` that changed (`setup-hours.jpg` at minimum), following SHOTS.md sizes.
- [ ] Update the Pages feature list if any line is now wrong.
- [ ] Bump the version 2.3.0 → 2.4.0 in the four version files.
- [ ] Add an "As built" section to the spec.
- [ ] Run `python3 scripts/build_site.py && node site/check.mjs`, plus `test_health`.
- [ ] Commit `docs: turnkey defaults; 2.4.0`.
