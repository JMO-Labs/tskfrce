# Excitement pack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add comic celebrations with mascots, Happy Hour point multipliers (started by parents, on a schedule, or by auto boost), streak freezes, and "Try this" cards so parents discover each feature.

**Architecture:**
- Backend: a `happy_hours` table, a multiplier fixed on chore runs when they are submitted, jobs in `notify_jobs.tick`, a derived streak-freeze function, and a per-kid `celebrate` column.
- Frontend: a CSS-only celebration engine with bundled art, a Happy Hour banner, parent controls, and discovery cards built on `DismissedTip`.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, pytest; Next.js/React/TS, jest; CSS keyframes. No new JS animation library.

**Spec:** `docs/superpowers/specs/2026-11-06-excitement-pack-design.md`. Its "Settled after the code check" section is binding.

## Global Constraints

- Rebase onto main after time banking (2.5.0) merges. Target version 2.6.0.
- Defaults:
  - Celebrations on; per-kid `celebrate` is `full`, or `small` for teens.
  - Mascots on.
  - Weekly surprise Happy Hour off.
  - Auto boost on.
  - Streak freeze on.
  - Cards on, with at most one new card per day.
- Happy Hour multipliers are ×1.5, ×2 (default) or ×3. Durations are 30, 60 (default) or 90 minutes. The multiplier applies to the base points row only, as `floor(base*mult)`.
- Auto boost:
  - Starts at 16:00 local the next day and runs for 60 minutes at ×2.
  - A kid gets at most 1 a day and 2 a week.
  - "Quiet" means the kid had assigned runs on each of the last 2 chore days and submitted none.
- Celebrations:
  - Run for at most about 1.5 s, never block taps, and dismiss on tap.
  - Respect `prefers-reduced-motion` by showing a static badge instead.
  - Word text fits narrow screens.
  - The mascot is centred and its image bottom stays below the screen edge.
- All art is bundled locally, with no runtime downloads, and adds 3 MB at most. Noto credit goes in About and in `docs/CREDITS.md`.
- Use existing theme tokens only. Mockup-matched light and dark screenshots on phone (390×844 @2x) and desktop (1280×900). The approved mockups are in `/home/user/code/tskfrce-bank/.superpowers/brainstorm/1783461-1793987804/content/` (`excitement-v2.html`, `excitement-v3.html`, `trex-tryout-v5.html`).
- Files under 500 lines. Semantic commits, each with this trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_011K7jrVbDK9XkJbLGVTb23M
  ```

## Review Focus

1. **A chore submitted at 16:59 in a Happy Hour that ends at 17:00, then approved at 19:00:** it is paid ×2.
2. **A chore sent back during a Happy Hour and resubmitted after it ends:** it is paid ×1.
3. **The `notify_jobs.tick` job runs twice in one minute:** at most one auto Happy Hour is created.
4. **A kid with nothing assigned for 2 days:** no auto boost.
5. **A streak of 7 days, then 2 missed days, then a done day, with freeze on:** the streak continues (one freeze earned, one used) or breaks, exactly per the derived rules, and the leaderboard agrees.

---

### Task 1: Happy Hour core (backend)
**Files:**
- Migration with `happy_hours`, `chore_runs.hh_mult_x10`, and family settings (`hh_default_mult_x10` =20, `hh_default_minutes` =60, `hh_weekly_surprise` =false, `hh_auto_boost` =true, plus date-guard columns for the jobs).
- New `models/happy_hour.py` and `services/happy_hour.py`, each under 200 lines.
- Changes to `chore_actions.submit` and `send_back`, `economy.award_chore`, and the parent API (new `api/happy_hour.py`: POST start, POST stop, GET active and recent).
- `/kid/today` gains `happy_hour` and `points_now` per run.
- `inbox.KID_KINDS` and `push.GENERIC` gain `happy_hour`.
- Tests: `tests/test_happy_hour.py`.

**Produces:**
- `happy_hour.active_for(db, kid_id, now) -> HappyHour | None`
- `happy_hour.start(db, *, kid_ids: list[int] | None, minutes, mult_x10, source, by) -> HappyHour`

- [ ] Write failing tests:
  - Review Focus 1 and 2.
  - Base points only: the early bonus is unchanged.
  - Shared run with no submitter: the multiplier applies only when the Happy Hour covers all kids.
  - `kid_ids` scoping.
  - Start sends one kid alert per covered kid.
  - Stop ends it early.
  - Parent-only routes.
- [ ] Implement, run the full suite, and keep ruff clean on the whole backend.
- [ ] Commit `feat(happy-hour): multiplier on runs submitted in the window`.

### Task 2: Auto boost and weekly surprise
**Files:** `services/notify_jobs.py` (or a new `services/boost.py` called from it), a parent notify event `boost` (label "Auto Happy Hour started", in `DEFAULT_EVENTS`, not SECURITY), and the inbox kind. Tests in `tests/test_boost.py`.
- [ ] Write failing tests:
  - Quiet detection, Review Focus 3 and 4.
  - Daily and weekly caps.
  - It starts at 16:00 local the next day.
  - The parent inbox gets the calm copy: "{Name}'s had a quiet couple of days, so we started a Happy Hour for them."
  - The weekly surprise picks a weekday at 16:00, 17:00 or 18:00, at most once a week, and only when the switch is on.
  - Both features respect their switches.
- [ ] Implement, then run the full suite.
- [ ] Commit `feat(happy-hour): auto boost and weekly surprise`.

### Task 3: Streak freeze, plus per-kid celebration level
**Files:**
- `services/progression.py` gets the pure function `streak_with_freezes(days, today) -> Streak`, which adds `frozen: list[date]` and `freezes_held: int`.
- `progress_many` and the community leaderboard use it when `fam.streak_freeze` is on.
- Migration adds `family_settings.streak_freeze` (default true) and `users.celebrate` (nullable; null means the mode default).
- Kid and parent APIs to read and set `celebrate`.
- Tests.
- [ ] Write failing tests:
  - Review Focus 5.
  - At most 2 freezes held.
  - Today never breaks the streak.
  - Off means identical to `streak_of`.
  - `celebrate` round-trips, and its default comes from `age_group`.
- [ ] Implement, then run the full suite.
- [ ] Commit `feat(streaks): freezes; per-kid celebration level`.

### Task 4: Celebration engine and art
**Files:**
- New `frontend/src/v2/kid/celebrate/`: an engine hook, effect components, word list, mascot catalogue, legendary and seasonal sets, and a CSS module.
- Hook into the kid app for client-side triggers (spec Settled item 1).
- `scripts/art/cutout.py`, a committed copy of the cut-out pipeline. It needs a short README covering rembg isnet-general-use, dropping small parts, cropping, and wrapping WebP in SVG.
- `frontend/public/celebrate/mascots/trex.svg`, from the owner's art: copy `/home/user/Downloads/trex-embedded.svg`.
- Noto animated WebPs in `frontend/public/celebrate/noto/`, 20 at most: animals and props. Fetch them once at dev time from Google's Noto animation CDN and commit the files.
- `docs/CREDITS.md` and an About credit line.
- [ ] Write failing jest tests:
  - The no-repeat picker.
  - Legendary odds use an injected RNG.
  - Reduced motion renders the static badge.
  - The `small` and `off` levels.
  - Tap dismisses.
  - Each trigger fires once per event, including an approval seen on the next open.
- [ ] Implement effects that match the mockups:
  - pop
  - wiggle
  - word with confetti
  - stamp
  - blast off
  - coins to the counter
  - balloon
  - disco
  - sneeze
  - explode
  - mascot pop-up with a bubble
- [ ] Take screenshots: a filmstrip of key frames (pause animations with a CSS var or a test hook) for 6 effects. Light and dark, phone and desktop, Kid mode, plus Little and Teen. Compare against the mockups.
- [ ] Commit `feat(kid): comic celebrations with mascots`.

### Task 5: Kid Happy Hour banner and settings
**Files:**
- The kid Today banner, matching the compact v3 bar: chasing lights, strobe, shaking countdown, "Go →" scrolls to chores.
- Doubled points shown on chore tiles.
- The kid's "Celebrations" level control on the Me page.
- The sound toggle, stored on the device.
- [ ] Write failing tests:
  - The banner shows only while a Happy Hour is active and the countdown ticks.
  - Reduced motion turns off strobe and shake.
  - The points display.
- [ ] Implement, take screenshots (light and dark × phone and desktop, all 3 modes), and commit `feat(kid): Happy Hour banner`.

### Task 6: Parent controls
**Files:**
- A "Start Happy Hour" button on Today (header and phone) and on each kid's page. It opens a quick sheet (length, multiplier, which kids) with a one-tap default.
- A Happy Hour settings section in the Rewards pane.
- A streak freeze switch in the "Points rules" fold.
- A per-kid celebration level on the kid's page.
- A "Preview a celebration" button.
- [ ] Write failing tests for each control and its PATCH or POST body. While a Happy Hour is active, the button shows a running state and a Stop button.
- [ ] Implement, take screenshots, and commit `feat(ui): Happy Hour controls and fun settings`.

### Task 7: Discovery cards
**Files:**
- A Today card stack that reuses `DismissedTip`. Priority: Celebrations, Happy Hour, Auto boost, Streak freeze, then the contextual "quiet kid" nudge when auto boost is off.
- A device-local limit of one new card per day.
- "Turn it off" PATCHes the setting.
- The setup Finish screen line.
- [ ] Write failing tests:
  - Order.
  - One per day.
  - Dismissal persists.
  - Try and turn-off actions.
  - The nudge appears only when its condition holds.
- [ ] Implement, take screenshots, and commit `feat(ui): try-this cards`.

### Task 8: Docs, site, version
- [ ] Update:
  - Guide 04: Happy Hour, auto boost, streak freeze, cards.
  - Guide 05: one kid line.
  - Credits.
  - Pages: a feature line plus a small celebration WebP.
  - Version 2.6.0 in a `chore(release)` commit.
  - The spec's "As built" section.
- [ ] Run `python3 scripts/build_site.py && node site/check.mjs` and test_health.
- [ ] Commit.
