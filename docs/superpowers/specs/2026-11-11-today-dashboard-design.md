# Today dashboard + Suggestions: design

Date: 2026-11-11 · Status: draft for owner review · Mockup: `docs/mockups/today/today-dashboard.html`
(published: https://claude.ai/artifact/9aTToz6tLg7fPusKZb31tL, version 2)

## Intent

Today is the parent's home screen and it is nearly empty: kid chips reading "0 of 0 · 0 pts", a
getting-started strip, and a Devices row. The owner wants a **calm parent dashboard**: what needs
them now, how every kid's day is going, what's coming (goals), and a place where the box tells
them useful, *real* things: trends, unused features that fit the family, updates and system
problems. It must stay clean and pleasant. The owner rejected a busier first draft ("far too
busy/distracting", too many colors) and picked the calmer kid-card layout.

The parent's main job here is answering **chore approvals and reward requests, usually within the
hour**.

## Goals

1. Pending approvals (chores and reward requests) are the first thing on the screen and are actionable in one tap.
2. One card per kid shows today at a glance: chores done/total, screen time used of allowed, points, lock state, and a day timeline.
3. A themed lower band adds context without noise: **Suggestions**, **Goals** (closest first), **This week**.
4. Suggestions are computed on the box from the app's real state, are relevant, have a one-tap action, and are never annoying.
5. Serious system problems get a separate warning that cannot be hidden until resolved.
6. Kids get an optional birth month/year so age-group moves and birthdays are accurate.

## Non-goals

- No push notifications from suggestions; they appear only when Today is opened.
- No cloud/LLM generation. Rules run on the box over local data.
- No redesign of the kid-facing screens.
- Devices-page redesign is a separate spec (mockup `docs/mockups/devices/devices-unknown-table.html`).

## Anti-goals (failure even if it works)

- Canned or pre-loaded tips that don't come from this family's data.
- Suggestions that nag: repeating after dismissal with nothing changed, more than 3 at once, or no way to turn them off.
- A rainbow screen. Kid colors appear **only** in the kid's name bubble.
- Anything that sends family data off the box.

## Layout (owner-approved direction: mockup v2)

Top to bottom; phone stacks the same order in one column.

1. **System warning** (only when present): full-width, not dismissable, see *System warnings*.
2. **Waiting banner**: "N waiting on you · X chores · Y rewards · oldest Zm" plus a **Review** button that opens the existing needs list (`NeedsYouList`). Hidden when N = 0. The oldest-item age turns amber after 30 min.
3. **Kid cards**: 4 per row on desktop, 2 on tablet, 1 on phone. Each card has:
   - name bubble (family-unique label + kid color, from `KidAv`/`kidBadges`), name, and a lock pill (Open / lock icon + reason: hours, chores, manual);
   - a two-arc ring: outer = chores done / due today, inner = **online minutes** / allowed minutes today (owner choice, see *Online time*);
   - text facts: Chores x/y, Online Nm of Mm allowed, Points p;
   - a day timeline from 7am to 9pm. Locked time is hatched gray, allowed windows solid gray, each completed chore is an accent dot, and the current time is a line. Every mark has a hover/tap tooltip;
   - tapping a card opens that kid's existing focus view (`KidFocus`).
4. **Lower band** (three cards; stacked on phone):
   - **Suggestions** (see below).
   - **Goals**: every active goal across kids sorted by closeness to completion. Each row shows the bubble, goal name, % and ETA ("~2 days", from the last 7 days' earn rate), and an accent progress bar.
   - **This week**:
     - a hero number: % of chores done on time over the last 7 days, with the change vs the previous 7 days;
     - a 14-day trend line of that rate with a dashed goal line at 75%;
     - a "When chores get done" grid: weekday × (AM / PM / Evening), single-hue accent opacity steps.

### Visual theme (binding)

- One accent (the family's Appearance accent, `--p-acc`) plus neutrals for every chart mark. Use an accent mark variant with ≥3:1 contrast on the light surface.
- Kid identity colors come from the validated categorical palette already in `frontend/src/v2/KidAv.tsx` (`KID_COLORS`), used only in the name bubble.
- Glyphs only (Material Symbols), never bare emoji. Compact.
- Charts must have a tooltip on every mark. A sequential scale uses a single hue. No dual axes.

## Suggestions

### Principles

- **Real state only.** Every suggestion is produced by a rule over current DB/system state and names the concrete kid, chore, goal or device.
- **One-tap action.** Each has a primary action that does the thing (or deep-links to the exact screen) and a dismiss.
- **Max 3 shown**, ranked by severity (system > kid-impacting > growth), then recency.
- **Dismiss = quiet until the facts change.** Each suggestion has a `key` (rule + subject) and a `fingerprint` (the data that triggered it). Dismissing stores `(key, fingerprint)`. The suggestion reappears only when a new fingerprint is computed: for example a chore skipped again after dismissal, or a new update version.
- **"Not for us"** on growth/feature suggestions mutes that rule for the family permanently. It can be reset in Settings.
- **Hide section**: the section menu has "Hide suggestions". Settings → Family (or Notifications) has a toggle to bring them back. System *warnings* are not affected by this.
- Dismiss/mute state is stored **server-side per family** (not localStorage) so it holds across parents and devices.

### Rule catalog (first set)

| Rule key | Triggers when (real data) | Action |
|---|---|---|
| `chore.skipped` | Same chore not done/skipped ≥3 consecutive due days for a kid | Move time / add photo step / open chore |
| `chore.stale` | A chore assigned but not done by anyone for 7 days | Edit or archive |
| `kid.cruising` | A kid at 100% on-time for ≥5 days | Offer harder chores or +points (open chore list for that kid) |
| `goal.close` | Goal ETA ≤3 days | Send cheer |
| `goal.missing` | Kid has no active goal for ≥7 days since setup, or the goal had no progress for 14 days | Add goal (prefilled for that kid) |
| `feature.homework` | Kid has homework/schoolwork chores on school nights and homework mode never used | Turn on for tonight |
| `feature.*` | Other opt-in features with a data-backed fit (reuse/replace `tryCards.ts` TRY_ORDER) | Open that feature |
| `family.parent` | Only one parent account and family active ≥7 days | Invite parent |
| `kid.age_up` | Kid likely outgrew their age group (see *Age*) | Move to next group (applies that group's preset defaults on confirm) |
| `devices.unknown` | New unknown devices since last visit | Open Devices → Who's this? |
| `update.ready` | Newer version available on the channel / pending major | Open Settings → Updates |
| `update.failed` | Last nightly update failed and rolled back | Open Updates (shows log summary) |
| `box.power` | Box booted after an unclean shutdown | Explains outage window and effects; UPS tip if ≥2 in 30 days |
| `cert.expiring` | Edge TLS cert < 14 days to expiry | Open help |

**Power-outage copy** says what it meant in plain words: "The box was off 7:10–7:52 PM. Kid timers paused; locks resumed when power came back." Include any effect the box can actually determine. The outage window is the last-alive heartbeat to boot time.

### System warnings (separate, not hideable)

Shown above everything until the condition clears:

- the blocker is not protecting any network;
- the blocker failed to bind a network the parent marked "Enforce here";
- Wi-Fi is disconnected with no wired route;
- an update rollback was itself unhealthy;
- storage is nearly full.

Each warning has a plain-language explanation and the fix action.

## Online time (owner decision)

The app has no screen-time allowance; it locks by hour windows. The card shows **online time**, labelled honestly as "Online", never "screen time":

- **used:** the kid's devices' online minutes during today's allowed windows, from the existing 10-minute activity slots (`device_activity.py`, `online_minutes = 10 × online slots`). A slot counts once even if several of the kid's devices were online.
- **allowed:** the total minutes of today's allowed windows (from the kid's hour rules), clipped to the timeline day.

A real minutes-per-day allowance is out of scope (a separate future project).

## Age and birthdays

- Add optional `birth_month` (1–12) and `birth_year` to kids: asked in setup (StepKids) and the kid editor, labelled optional.
- **If birth month/year is set:** age group follows the age bands. `kid.age_up` fires within 30 days of crossing a band. Birthday celebrations are allowed (only when the date is known).
- **If not set:** infer from time in group. `kid.age_up` fires once the kid has been in their group longer than that band's span (e.g. 3 years), using the date the group was set. No birthday features.
- Band boundaries come from `frontend/src/v2/manage/ageGroups.ts`: little 5–8, kid 9–12, teen 13+. Time-in-group inference uses 4 years for little and kid; teens never age up.
- Fields: nullable integers `birth_month` (1–12, check constraint) and `birth_year` (sane range) on the kid user. Both or neither are set. Edited in StepKids and KidEditor as one optional "Birthday (month/year)" field.

## Data sources (existing, to confirm in plan)

- Waiting: the existing needs/inbox data behind `NeedsYouList` / `WaitingActions`.
- Kid cards: `GET /api/v1/family/today` (`backend/app/api/family.py`) is extended with:
  - screen minutes used/allowed;
  - allowed windows and lock reason for today;
  - completion timestamps.
- Goals: existing goals models/API (`kid_goals`).
- This week: chore runs/assignments history (on-time = approved/done before its due time).
- System: netd status (`network_wifi.status`), updater state (`/internal/update-state`, `update-result`), blocker health, edge cert expiry, boot and heartbeat times (needs a persisted last-alive timestamp; the box writes one periodically).

## Decided by the owner

- Option B (kid cards) layout, calmer; option A rejected as busy.
- One common accent theme; goal chart kept and themed; colorful stacked chore bars replaced by a different data point.
- Suggestions: dismissable individually, whole section hideable, relevant, built from real state, not canned. They also surface updates and system issues.
- Serious system problems are a separate non-hideable warning.
- Include power-outage explanations, invite-another-parent, add/refresh-goal, and age-group move-up.
- Birth month/year is optional. Age group is inferred from time-in-group when absent. Birthdays are celebrated only when the date is known.

## Calls made by the designer (owner may override)

- Dismiss/mute storage: one table `suggestion_state(family_id, key, fingerprint NULL, muted BOOL, at)`. A dismiss stores the fingerprint; "Not for us" sets `muted` for the rule key. Settings → Family has "Reset muted suggestions" and the show/hide toggle.
- Power outage: the backend writes a last-alive timestamp every 60 s (DB or data-dir file) and a clean-shutdown marker on graceful stop. On boot, a missing marker means an unclean shutdown, with outage = last-alive → boot. Effects text only states what the box can confirm (timers paused or resumed, locks re-applied).
- System warnings whose data source doesn't exist yet are stubbed off (not faked) and listed in the plan as follow-ups: storage reads the data dir disk usage; cert expiry reads the edge cert file if mounted, else is skipped.
- Phase order: (1) Today layout + kid cards + waiting banner, (2) Goals + This week, (3) suggestion engine + first rules, (4) system warnings + power outage, (5) birth fields + age-up.

## Left to the builder

- Exact thresholds beyond those listed, ranking ties, and copy polish (keep it short, plain).
- Whether suggestion rules live in one service module or one file per rule (keep each file <500 lines).
- Migration shape for the dismiss/mute table and the kid birth fields (alembic, single head).
- Whether `TryCards`/`TipSlot` are absorbed into Suggestions or retired (no duplicate nudges on Today).
