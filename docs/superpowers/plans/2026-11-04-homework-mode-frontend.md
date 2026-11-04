# Homework mode — implementation plan, part 2 (frontend)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Continues:** `docs/superpowers/plans/2026-11-04-homework-mode.md`. Part 1 covers tasks 1–11 (backend and blocker). Its Goal, Architecture, **Global Constraints** and **Review Focus** sections apply here unchanged. Read them first.

**Spec:** `docs/superpowers/specs/2026-11-04-homework-mode-design.md`

**Depends on:** part 1 tasks 3–6, which provide the API endpoints these tasks call.

---

### Task 12: Frontend — Homework mode control and status

**Files:**
- Modify:
  - `frontend/src/v2/types.ts:6,13`: add `'homework'` to `OverrideAction`
  - `frontend/src/v2/hooks/useOverride.ts`: `TOAST.homework`, and `minutes` passes through
  - `frontend/src/v2/manage/DeviceDetail.tsx:192-210`
  - `frontend/src/v2/manage/DevicesPage.tsx:64-71`
  - `frontend/src/v2/manage/GroupDetail.tsx`
- Create: `frontend/src/v2/manage/HomeworkButton.tsx` (≤ 120 lines)
- Test: `frontend/tests/v2/homeworkButton.test.tsx`, `frontend/tests/v2/useOverride.test.ts` (add)

**Interfaces:**
- `<HomeworkButton target={OverrideTarget} disabled={boolean} busy={boolean} onStart={(minutes:number)=>void} />`.
  - An `ActionButton` with icon `menu_book` and label "Homework mode".
  - It opens a small menu: 30 / **60** (default) / 90 / 120 min.
  - Shown only when the device is paused (`!device.online`). It is disabled
    while busy.
  - Hint under it: "Homework sites stay on. It may take up to a minute to start."
- `DevicesPage.handleRequestOverride` maps
  `{action:'homework', minutes}` → `choice {action:'homework', minutes}`.
- Toast: `"Homework mode on until {time}."` with undo, using the existing
  `undoChoice`.
- When `device.override?.action === 'homework'`, the status line reads
  "Homework mode until {time}", and "Back to schedule" ends it.

- [ ] **Step 1: Failing tests:**
  - button hidden when the device is online
  - picking 90 calls `onStart(90)`
  - default 60
  - `useOverride` sends `{action:'homework', minutes:60}` to `/devices/3/override`
  - toast copy
  - group detail shows the button
- [ ] **Step 2–4:** Run, implement, then run `npx tsc --noEmit && npm run lint && npx jest`.
- [ ] **Step 5: Commit** `feat(frontend): homework mode control`.

### Task 13: Frontend — Activity panel

**Files:**
- Create: `frontend/src/v2/manage/HomeworkActivity.tsx` (≤ 200 lines), `frontend/src/v2/hooks/useHomework.ts`
- Modify: `frontend/src/v2/manage/DeviceDetail.tsx` (render it when homework is
  active or a session ended within 24 h)
- Test: `frontend/tests/v2/homeworkActivity.test.tsx`

**Interfaces:**
- `useHomeworkActivity({deviceId?, kidId?})` → `GET /homework/activity?...`,
  refetching every 15 s while any session is active.
- `useHomeworkSite()` mutation: POST/DELETE `/homework/sites`. It invalidates
  `['homework-sites']` and `['homework-activity']`.
- Panel `<section className="pk-panel" aria-label="Homework activity">`:
  - rows of `domain · {n} min`, with "pulled in by {pulled_by}" for follow rows
  - buttons **Block** and **Add to allowed**
  - **Add to allowed** opens a choice: "Just for {kid}" / "For everyone". Only
    "For everyone" shows when the device has no kid.
  - Header button **End homework mode** (a DELETE override through
    `useOverride`)
  - Under Block, the one-line hint: "Sites that share servers with an allowed
    site may still load."

- [ ] **Step 1: Failing tests:**
  - rows sorted as returned
  - follow row shows "pulled in by"
  - Block posts `{domain, kind:'block'}`
  - Add → "Just for Sam" posts `{domain, kind:'allow', kid_id}`
  - End calls the override DELETE
  - an unassigned device shows only "For everyone"
- [ ] **Step 2–4:** Run, implement, then run `npx tsc --noEmit && npm run lint && npx jest`.
- [ ] **Step 5: Commit** `feat(frontend): homework activity panel`.

### Task 14: Frontend — lists (settings and per-kid) and docs

**Files:**
- Create: `frontend/src/v2/manage/HomeworkPane.tsx` (≤ 200 lines), `frontend/src/v2/manage/KidHomeworkSites.tsx` (≤ 120 lines)
- Modify:
  - `frontend/src/v2/manage/settingsSections.ts`: add section `'homework'`
  - `frontend/src/v2/manage/SettingsPage.tsx`
  - `frontend/src/v2/manage/KidDetail.tsx`: add a panel
  - `docs/guide/04-everyday-use.md`: a "Homework mode" section
  - `docs/guide/06-troubleshooting.md`: "Homework sites won't load", with the
    Private DNS tip
- Test: `frontend/tests/v2/homeworkPane.test.tsx`

**Interfaces:**
- `useHomeworkSites()` → `GET /homework/sites` (in `useHomework.ts`, Task 13).
- `HomeworkPane`:
  - "Built-in sites" (read-only, collapsed list with a count)
  - "Allowed for everyone" (add input plus remove)
  - "Never during homework" (block list: add plus remove)
  - Server error text is shown inline.
- `KidHomeworkSites` in KidDetail: "Extra homework sites for {kid}" (add plus
  remove). Hint: "Adds to the family list. Blocked sites stay blocked."

- [ ] **Step 1: Failing tests:**
  - pane renders 3 groups
  - adding a pasted URL posts it raw (the server normalises it) and shows the
    returned domain
  - a 400 message is shown inline
  - remove calls DELETE
  - kid panel posts with `kid_id`
- [ ] **Step 2–4:** Run, implement, then run `npx tsc --noEmit && npm run lint && npx jest`.
- [ ] **Step 5: Commit** `feat(frontend): homework site lists` and `docs(guide): homework mode`.

### Task 15: Frontend — kid request and "Needs you"

**Files:**
- Modify:
  - `frontend/src/v2/kid/modes/StatusBanner.tsx`: request button and homework status
  - `frontend/src/v2/types.ts`: `KidToday.homework`, `homework_pending`; `NeedsItem.type` adds `'homework'`
  - `frontend/src/v2/today/NeedsYouList.tsx:18-24,55`: homework branch with a minutes select
  - `frontend/src/v2/components/bellRules.ts`: `homework_request`
- Create: `frontend/src/v2/hooks/useHomeworkRequest.ts`
- Test: `frontend/tests/v2/homeworkRequest.test.tsx`

**Interfaces:**
- Kid side:
  - When `locked && !homework`: button "Ask for homework time" →
    `api('/kid/homework', {method:'POST', kid:true})`.
  - When pending: chip "Waiting for a parent".
  - When `homework`: banner "Homework mode is on until {time}."
- Parent side:
  - `KIND.homework = {label:'Homework time', icon:'menu_book', tone:'blue'}`.
  - The row has a minutes select (30/60/90/120, default 60) and
    Approve/Decline → `/homework/requests/{id}/approve {minutes}` or `/deny`.
  - "Approve all" includes homework items at 60 min.

- [ ] **Step 1: Failing tests:**
  - kid paused → button shown and posts
  - pending chip
  - homework banner text
  - parent row approve with 90 posts `{minutes:90}`
  - decline posts deny
  - approve-all includes homework
- [ ] **Step 2–4:** Run, implement, then run `npx tsc --noEmit && npm run lint && npx jest`.
- [ ] **Step 5: Commit** `feat(frontend): kid homework requests`.
