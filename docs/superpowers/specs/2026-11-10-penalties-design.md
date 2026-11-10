# Penalties — design

Date: 2026-11-10 · Branch: `docs/penalties` (stacked on `feat/declutter`, 2.8.0) · Ships as 2.9.0
Approved mockup: `.superpowers/mockups/penalties-v2.html` (owner "ok" 2026-11-10)

## Intent

Give parents a simple tool for **constructive discipline**: take something away, say why, and let the kid
earn part of it back. Parents have complete control. It pairs with trust mode (a caught false claim can
carry a penalty) and also covers things outside the app ("fighting with sister").

Owner's guiding rule: **very easy for parents to manage. Compact, low clutter, but nothing missing.**

## Goals

- Give a penalty to one kid or the whole family in two taps (pick size → Give).
- Three penalty kinds: dock points, take banked screen time, block the kid's device(s) for a period.
- Earn-back: make-up chores return a share of the penalty.
- Kid sees what was lost, why, and how to earn it back, in one card.

## Non-goals

- Automatic penalties. **A parent always taps.** The app only offers the button.
- Per-kid penalty settings (sizes are family-wide).
- Goal-based family penalties (take from family bank, raise the shared target) — added by Project 3 when
  shared goals exist. This design must leave room for them as extra "what" options on the same sheet.
- Negative balances.

## Anti-goals (failure even if it works)

- A cluttered sheet or a settings maze. Follow [feedback: simple parent UI] and the calm-then-focus pattern.
- Sibling contention or shame: **siblings never see each other's penalties.**
- Surprise: a penalty firing without a parent's tap.

## Decisions (owner's unless marked *builder's call*)

### Turning it on
- Family setting `penalties_enabled`, **default off** (turnkey rule: power features opt-in).
- Introduces itself outside Settings: onboarding "Optional extras" step (`setup/StepExtras.tsx`) and a
  Try-this card `try.penalties` (`today/tryCards.ts`, append to `TRY_ORDER`).
- When off, no penalty button appears anywhere.

### Where "Give penalty" appears (only when enabled)
1. **Every chore a parent reviews** — approve / send back / spot-check catch. Covers "done badly" too.
   - Today chore actions (`today/WaitingActions.tsx`, `today/ChoreOpen.tsx`).
   - The "Checked, wasn't done" sheet (`today/WasntDoneSheet.tsx`): a "Give penalty" option alongside
     "lower trust". *Builder's call:* unticked by default; ticking expands the compact sheet inline.
2. **Bypass alerts** — `device_bypass` / `device_resisting` inbox rows (`components/InboxRow.tsx`).
3. **Kid page, manual** — `today/KidFocus.tsx` MoreMenu item "Give penalty", for anything outside the app.
4. **Family, manual** — a "Penalty for everyone" entry on the family/Today level. *Builder's call:* MoreMenu
   on the Today header if one exists; otherwise the Kids list header.

Penalties started from a chore or alert store that link (`chore_run_id` / `notification_id`) so history
shows the cause.

### The sheet (approved mockup v2)
- Size bar: **Small · Medium · Big · Custom**.
- Below it, summary lines, each with "change" that opens **only that line**:
  1. What is taken + amount ("No Nintendo, 1 day")
  2. Earn-back ("Earn back half")
  3. "+ Add a reason [kid] sees" (optional free text)
- Custom opens line 1. Button: **Give penalty**. Toast: "Penalty given".
- **Repeat hint** (owner agreed): if the kid got a penalty in the last 7 days, pre-select one size bigger and
  show "2nd this week" next to the bar. Parent can change it. Big stays Big.

### What a penalty can take
| Kind | Amount | Mechanism |
|---|---|---|
| Points | N points | `economy.deduct()` — already floors at balance (**stop at zero**, owner) |
| Banked screen time | N minutes | reduce `ScreenBank.minutes`, floor 0 (new small helper in `services/screen_bank.py`) |
| Device block | device(s) or group, N hours/days | `Override(action=lock, source="penalty", expires_at)`; raise cap past 1440 min for this source (max 14 days, *builder's call*) |

- "A device" choices = that kid's own devices + groups, plus "All of [kid]'s".
- A penalty block must **not** be cleared by the existing manual override replace in `set_override`;
  manual unlock by a parent still wins (parent control). Builder must check how `lock/` evaluates sources.

### Sizes (family settings, defaults *builder's call*, editable)
- Small: −20 points, earn back all
- Medium: block kid's devices 1 day, earn back half
- Big: block kid's devices 3 days, earn back half
Default earn-back share for Custom: half.

### Earn-back
- Share options: none, half, all.
- **Make-up chores come from a family list in Settings**; parent can override the picks per penalty
  (owner). The app auto-picks enough chores to cover the share. *Builder's call:* one make-up chore =
  one equal slice of the earn-back amount; default 2 chores; seed list with 4 sensible chores.
- Make-up chores are created as one-off chore runs (`ChoreAssignment.repeat='once'`) linked to the penalty,
  go through the normal approval flow (never trust auto-approved: a parent always checks them), and on approval return their slice:
  points refunded / minutes re-banked / block `expires_at` pulled earlier.
- **Make-up chores pay nothing else (owner):** no points, no minigame tickets, no streak or badge credit. Their only effect is reducing the penalty.
- When the penalty ends (expires, forgiven, cancelled), unfinished make-up chores are cancelled.

### Whole-family penalty (owner: ship now, simple)
- Same sheet, target = every kid. Applies the **same penalty to each kid individually** (one record per
  kid, sharing a `group_id`), so earn-back stays per kid and no kid can be blamed for another's.
- Project 3 later adds goal options here.

### Parent control after giving
- Kid page shows active penalties (compact row, expands on tap) with **Shorten, Forgive, Cancel**.
  - Forgive = end now, keep record. Cancel = undo entirely (refund what was taken, remove record from kid view).
- Points history (`GET /kids/{id}/points`) shows penalty rows with reason.

### Kid view
- One card in the kid app (`kid/KidApp.tsx`, near the existing banner) while a penalty is active:
  title ("No Nintendo until Friday"), reason with parent name, earn-back meter, make-up chores in one line.
- Points-only penalty with no earn-back: card shows once, then dismisses (use `seen_by_kid`).
- Kid sees only their own penalties. Kid payload from `services/kid_view.py`.
- *Builder's call:* tone is neutral, no red alarm styling; kid app keeps its fridge look.

### Notifications
- Kid gets the existing kid-event push/alert ("points_taken" style) for a new penalty. No parent
  notifications (parent caused it).

## Settled after builder check (*my calls* unless marked)
- **One kind per penalty.** Each of Small, Medium and Big is one kind. Custom lets the parent pick any kind. No combos (keeps it simple; a parent can give two penalties).
- **Refunds use what was actually taken.** Store `amount_taken` (points or minutes after the zero floor). Earn-back slices and Cancel refund from it. A penalty that takes 0 still creates a record and a kid card, so the reason still lands.
- **Penalty lock beats schedules and time-limit grants.** On a blocked device, the device page shows "Blocked by penalty" with Forgive in place of the plain Unlock, so the parent ends the penalty on purpose. A manual override never silently clears a `source="penalty"` row.
- **Kids can still reach the kid app while blocked.** This is already true: chore lock blocks devices until chores are done, so the kid app on the home box stays reachable. No exemption needed. The builder verifies this in the lock evaluator.
- **Repeat hint counts** penalties to that kid in the last 7 days that are active, ended or forgiven (not cancelled). Family penalties count for each kid.
- **Shorten applies to blocks only.** Points and banked-minute penalties show Forgive or Cancel.

## Data (sketch, builder refines)
- `Penalty(id, family_id, kid_id, group_id?, kind, amount, unit, target_ids json, earn_back_share,
  reason?, chore_run_id?, notification_id?, given_by_id, created_at, ends_at?, status active|ended|forgiven|cancelled)`
- `ChoreRun.penalty_id` (nullable) for make-up chores.
- `FamilySettings`: `penalties_enabled`, `penalty_sizes` json, `makeup_chores` json (or table).
- Migrations: new table, columns, and `Points.reason` CHECK gets `penalty` (or reuse `deduction` with
  `penalty_id` — builder's call). Confirm head with `alembic heads`.

## Constraints
- Parent UI follows declutter calm-then-focus and approved theme tokens (`feedback-follow-approved-mockups`).
- Keep files under 500 lines.
- All money-like paths (points, bank, blocks) under existing `SPEND_LOCK` / transaction rules.
- Server-side authz: only parents of the family can give/change penalties; kids can't read siblings'.

## Left to the builder
Exact API shapes, component split, copy polish within the mockup, test layout, size defaults tuning.
