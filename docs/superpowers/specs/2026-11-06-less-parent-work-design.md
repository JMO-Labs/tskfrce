# Less parent work: design

**Status:** builder check done; awaiting owner approval. **Target:** 2.7.0, on top of the excitement pack (2.6.0, PR #66).

## Why

The market survey found chore apps lose families after the first week. Part of that is that the app becomes one more chore for the parent. Parents differ: some check every chore, others trust their kids and tap OK without looking. This project lets each family pick how much it does, without changing anything for parents who want today's flow.

Success looks like this: a trusting parent spends seconds a day in the app and a minute on Sunday, and still notices early when a kid is slipping.

## Goals

1. **Trust mode:** a per-kid opt-in where chores approve themselves as the kid earns it, with random spot checks.
2. **Bedtime auto-approve:** a family opt-in so a busy evening doesn't leave chores unapproved.
3. **Weekly recap:** trends per kid, so a parent can act early.
4. Parents can find the opt-ins in setup and in Settings, and through a card on Today.

## Non-goals

- **Penalties.** Docking points, banked time or the family bank, and blocking a device for a set time, are a separate project built right after this one.
- **Chores that check themselves.** On hold; the owner has no clear picture yet.
- Changing how chores are created, or how points are priced.

## Anti-goals (failure even if it works)

- A family that opts into nothing sees approval behave differently. **The default stays: a parent approves every chore.**
- A chore approves itself for a kid whose parent didn't opt that kid in.
- A kid loses points because a parent was busy.
- Copy that shames a kid, or reads as surveillance.

## Trust mode

**Owner decisions:** opt-in per child, default off. Taking points back and lowering the level are the response to a false claim. A parent who wants full control simply leaves it off.

**Levels.** Each kid has a level. A kid's level only has an effect while trust mode is on for them.

| Level | What happens when the kid finishes a chore |
|---|---|
| New | Waits for a parent, same as today |
| Trusted | Approves itself; 1 in 5 stays waiting as a spot check |
| Proven | Approves itself; 1 in 20 stays waiting as a spot check |

**Moving up** (my call on the numbers). While trust mode is on, a clean count goes up for each chore approved, by a parent or by itself, including at New. It doesn't count while trust mode is off and there's no backfill, so opting in always starts at New with a count of 0. At 10 a New kid becomes Trusted. At 30 more a Trusted kid becomes Proven. The count resets at each level change. A parent can set any level by hand at any time, including Proven on day one. Both parent and kid get a message when a level changes on its own.

**Always check** (my call). Each chore has an "Always check this" switch, default off. Those chores always wait for a parent, at every level, and bedtime auto-approve skips them too.

**Who a shared chore follows** (my call). A chore done by one kid follows that kid. A team chore that pays several kids approves itself only if every one of them is in trust mode, using the lowest level among them, with one spot-check roll for the chore. On approval every payee in trust mode gets a clean count. On a catch every payee loses that chore's points and gets the message, and only the kid who submitted it drops a level (or every payee if nobody is recorded as submitting). `trust_events` gets one row per affected kid.

**Photo chores** (my call). They approve themselves like any other. The photo stays on the chore for the parent to look at later.

**Catches.** Either of these is a catch, and it drops the kid one level and resets the clean count (at New, it only resets the count):
- The parent taps **Wasn't done** on a chore that approved itself. This asks once, with "Also lower trust level" ticked by default.
- The parent sends back a spot-checked chore.

**Wasn't done.** Available on any chore that approved itself, on Today and in a new "Approved on their own" list on the kid's page covering the last 7 days. It removes the points that chore earned: every positive ledger row for that run, including any Happy Hour multiplier and early bonus. If the kid already spent them, the balance **stops at zero**: nothing is owed. The chore returns to the kid's list if it's still that chore's day, clearing its spot check, approval and multiplier; when resubmitted it always waits for a parent (owner, 2026-11-07); on an older day it becomes `cancelled`. The kid gets a gentle message, for example "A parent checked Clean room and it needs another go."

Not reversed (my call): badges already earned, and integration events already sent, matching today's `/undo`. A chat line records it. Streaks are derived from runs, so they correct themselves.

Existing `/chores/{id}/undo` can leave a balance below zero; this path must not. Leave `/undo` as is.

**Same path as a parent's OK** (my call). A chore that approves itself goes through `chore_actions.approve` with `approved_by_id=None` and `approved_via` set, so points, badges, the chat line, the kid's approved message, the celebration and `chore.completed` all behave as usual.

**Parent's view.** A chore that approved itself sends no "waiting for your OK" alert and doesn't appear in the Needs list. On Today it shows a small "Approved on its own" mark. A spot check appears in the Needs list marked "Spot check".

**Kid's view** (my call). A spot-checked chore looks like any chore waiting for a parent. The Me page shows the kid's level as a small chip when trust mode is on, with a friendly line about what's next. No chip when it's off. Reaching a new level uses the existing celebration engine.

## Bedtime auto-approve

**Owner decisions:** opt-in, default off; approval stays required otherwise; spot checks stay waiting. Kids not in trust mode get no spot checks at bedtime.

- A family switch with a time, default 21:00 local.
- At that time, chores still waiting approve themselves, except spot checks and "Always check" chores.
- They count as clean for trust mode and can be taken back with **Wasn't done**.
- Runs at most once per local day, and is skipped during setup.
- It runs in `notify_jobs.tick`, like the daily summary. The picker offers 18:00 to 23:30. The daily reset is `family_settings.reset_time` (default 06:00), so this normally falls well before it. If a family's reset falls in that range, the picker's latest time is 15 minutes before the reset, and the server validates the same rule.
- The next morning, one inbox line: "Bedtime approved 3 chores." No line if there were none.

## Weekly recap

**Owner decision:** it exists so a parent can see trends and deal with a kid early.

**Delivery** (my call on the time). On by default, Sundays at 19:30 local, in the inbox, plus push and other notification places. It uses a new notify event `recap`, on by default, and a migration adds it to existing places so current families get it too. One switch turns it off. Quiet hours hold it as they do any alert. If the box was down at that time for more than 2 hours, skip that week.

**The page.** `/recap` shows the latest full week and can step back through earlier weeks. Computed on request from existing data; nothing is stored except trust events below. If a chore or kid is later edited or deleted, past weeks may shift; that's acceptable (my call). The job runs from `notify_jobs.tick`, guarded by `recap_date`.

- **Flags first.** One "Worth a look" list for the whole family: at most 3 shown, most serious first, each with a one-tap action, "See all" if more (owner, 2026-11-07, simpler v2). Then one "This week" card with one line per kid; tap for the rest of the numbers.
- **No flags:** "All good this week", so the parent can stop there.
- **A trend card per kid**, this week against the average of the 4 weeks before:
  - chores done, with a small sparkline
  - on-time rate: chores submitted by their deadline, of those with a deadline
  - points earned and points spent
  - screen time bought (the app knows minutes bought, not minutes actually watched)
  - current streak
- **One family line** to end on, for example "Best week in a month."

**Flags** (my call on thresholds):

| Flag | Fires when | Action |
|---|---|---|
| Chores dropping | Last 2 weeks average 30% or more below the 4 weeks before, baseline of at least 5 chores a week | Start a Happy Hour |
| Finishing later | On-time rate down 20 points or more, same comparison | Open the kid's page |
| Catches | 2 or more this week | Open the trust setting |
| Streak ended | A streak of 7 or more ended this week | Open the kid's page |

Flags use only days the kid had chores assigned, so a holiday with nothing assigned doesn't read as a drop. Before a kid has 2 full weeks of history, the card shows the week's numbers and "Trends start after 2 weeks."

**Message text.** Title "Your week at {family}". Body: each flag on a line, or "All good this week", with a link to `/recap`.

## Finding the opt-ins

Follows the turnkey and discoverability rules.

- **Setup:** a new "Optional extras" step before Finish. A one-line description and switch for trust mode per kid, and for bedtime auto-approve. Everything off. Skippable with one tap.
- **Settings:** trust mode and level on each kid's page; a bedtime switch and time, and the recap switch, in family settings. Bedtime's time is hidden until its switch is on, per the turnkey rule.
- **Today cards**, using the existing Try cards and one-a-day pacing (my call on triggers):
  - Trust mode: once a kid has 10 approved chores and trust mode is off.
  - Bedtime: once a family has had chores waiting at reset on 3 days.
- **Recap:** the first recap introduces itself.

## Data (builder may adjust names)

- `users`: `trust_mode` (bool, default false), `trust_level` (0 New, 1 Trusted, 2 Proven; default 0), `trust_clean` (int, default 0).
- `chores`: `always_check` (bool, default false).
- `chore_runs`: `spot_check` (bool, default false), `approved_via` (`parent`, `trust`, `bedtime`, `integration`; null for older rows).
- `trust_events`: kid, time, kind (`up`, `down`, `catch`), run, by. Feeds recap catches.
- `family_settings`: `bedtime_auto` (default false), `bedtime_auto_at` (default `21:00`), `bedtime_date`, `recap_weekly` (default true), `recap_date`.

## Must-haves found in the code

- `services/chores.py` `state()` only reports `done` when the approver is a parent. A chore approved by the system would read as `todo`, so it must use `approved_via`. Check `progress` and the other callers that rely on a parent approver.
- `chore_actions.submit` is called from the kid path, the parent's mark-done path, and integrations. The trust decision belongs on the kid path only; parent mark-done is already parent-approved, and integrations keep their own approval rule.
- `api/kid.py` sends `chore_submitted` after submit; skip it when the chore approved itself.
- The setup step count changes from 7 to 8. Earlier work hit a redirect loop from a stored step above the last step, so update the frontend `LAST`, the server guard and tests together.
- Spot-check randomness takes an injected RNG so tests are deterministic.
- Query budgets on `/today` and `/kid/today` stay watched. The recap page needs its own budget.
- Files under 500 lines. `types.ts` is at 494: new types go in a new file.

## Docs

Guide 04 gets trust mode, bedtime and the recap. Guide 03 gets the extras step. Guide 05 gets a kid line about levels. Pages site gets a feature line. Screenshots in light and dark, phone and desktop, reviewed against approved mockups before building UI.

## Left to the builder

Layout of `/recap` beyond what's above (mockups come first and need owner approval), exact copy other than what's quoted, file structure, and sparkline drawing (no new chart library).

## Chores waiting at the reset (owner decision, applies to every family)

Today `run_reset` cancels any chore still waiting from an older day, so the kid gets nothing. From now on, **a submitted chore stays waiting until a parent answers**, even on later days. Unfinished `todo` chores are still cancelled.

- The Needs list and its count include waiting chores from older days, each labelled with its day.
- Approving one later pays as normal, keeping its Happy Hour multiplier and early bonus, because both come from when it was submitted.
- Bedtime auto-approve also clears waiting chores from older days, except spot checks and "Always check" chores.
- Older waiting chores don't hold the current day's chore lock. Confirm this in the lock code and test it.

This is the one change to default behavior in this project. It's in the 2.7.0 release notes.

## As built

- Trust mode, bedtime auto-approve and the recap work as specced. Where the build differs:
- **Redo after a catch.** When a chore is put back on the list after **Wasn't done**, it always waits for a parent when the kid does it again (owner).
- **Catches skip trust-off kids.** No opt-in means no level drop, even if a parent switched trust mode off after the chore approved itself.
- **Older-day Wasn't done.** The chore can't be redone, so the kid sees "A parent checked {title} and took its points back." The chat line reads "A parent checked this one again · points taken back".
- **Points taken back** are the real sum of that run's positive ledger rows. If the number isn't available, the message leaves it out.
- **Chores waiting past the reset.** The reset marks past-day chores that were never done as `missed` instead of `cancelled`, with no migration, so nobody's streak drops on upgrade. A missed day now breaks a streak (as designed, with freezes). The kid's own Today doesn't show older waiting chores yet; only the parent's Needs list does.
- **Recap delivery.** The migration adds `recap` only to notification places that already get `summary`, not to places with empty events, so nothing new reaches a third party against a parent's choice. Some places may need recap switched on by hand; the inbox always gets it. This differs from the spec line "adds it to existing places".
- **Recap text.** Kid names in flag text lose control characters and newlines and are cut at 40 characters. The message is cut by line. A bad `week` parameter is rejected. Quiet hours hold it.
- **Worth a look** is one list for the family, at most 3, most serious first, with **See all**. Catches stay first in the order. The flags carry structured fields; the page doesn't parse text.
- **Setup.** Optional extras is step 8 of 8 and Hours stays step 7. No new migration (the server never stored a step above 7). The plan said "step 7".
- **Settings.** One **Less tapping** card with two rows (bedtime auto-approve with its time, weekly recap), not two cards.
- **Kid header.** 3 buttons plus a **More** menu (Bonus, Deduct; on a phone also View as kid).
- **"Try this" for trust** is dismissed once for the whole family.
- **Proven** wording approved by the owner. The parent-app declutter is a separate later project.
