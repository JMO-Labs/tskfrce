# Goals (Project 3: kid choice and goals) — design

Date: 2026-11-10 · Branch: `feat/goals` (from `feat/declutter`, 2.8.0) · Version: next minor after Penalties
Approved mockup: `.superpowers/mockups/goals-v1.html` (owner "good" 2026-11-10). Mascot images in the
mockup load from `/files/*.svg`; the real assets are `frontend/public/celebrate/mascots/*.svg`.

## Intent

Give kids something bigger to work toward, with points saved over days or weeks. Examples: a Disney
vacation, a new bike, a game system, or a smaller treat like pizza and movie night. Kids choose what to save
for. Parents stay in control of what's allowed and what it costs.

## Goals
- Parents create custom goals with a point price.
- Built-in goals tied to app features: **extra screen time** and **"Get out of jail free"** (cancels one
  active penalty). Each is off until a parent allows it.
- Kids save toward several goals at once and can suggest new ones.
- Family goals: one shared meter that kids and parents all add to.
- When a goal is fulfilled, there's a big mascot party.

## Non-goals
- Real money, purchasing, or wishlist links.
- Kid-to-kid transfers.
- Changing how instant rewards (the existing Rewards/redemptions) work. Goals sit next to them.

## Anti-goals
- Sibling contention: no rankings, and per-sibling amounts are shown only if a parent enables it.
- Pressure mechanics: no "you'll lose it" timers on goals.
- A cluttered parent screen. Follow calm-then-focus and the approved mockup.

## Decisions (owner's unless marked *builder's call*)

### Creating goals
- **Parent custom goal:** name, point price, optional emoji or image (*builder's call*), and scope
  (one kid, several kids, or family). A goal assigned to several kids gives each kid their own meter.
- **Kid suggestions:** a kid taps "+ Suggest a goal" and types a name. The parent sees it in "Waiting on
  you" and sets a price (approve) or declines. **Parents can turn suggestions off** (family setting).
- **Built-ins** (each off until allowed in Goal settings):
  - *Extra screen time:* the parent sets the price per N minutes. When fulfilled, the minutes are added to
    the kid's screen bank (`ScreenBank`). It goes through the same parent "fulfilled" tap as other goals.
  - *Get out of jail free:* fulfilling it gives the kid one card, which the kid can play on an active
    penalty. *Builder's call:* playing a card is instant and cancels the penalty via the Penalties
    cancel path, and the parent gets an inbox note. The card is unavailable if Penalties is off.

### Limits
- Maximum active goals per kid, set by the parent. The default depends on age mode: Little 1, Kid 2,
  Teen 3 (*builder's call* for Kid and Teen). The owner's wording was "younger kids 1 or 2".

### Moving points in
- **Both ways, and the parent picks the default** (family setting):
  - **By hand:** "+ Add" on a goal moves points from the kid's balance.
  - **Automatic:** a set percentage of each approved chore's points goes to a chosen goal. The kid picks
    the goal and the parent sets the default percentage (*builder's call*: 25%).
- Saved points leave the spendable balance. Use ledger rows (`Points`) with a new reason such as
  `goal_save` / `goal_return` so the balance stays `SUM(amount)`. The goal's progress is the sum of its
  contributions.
- **Banked screen time into family goals** (*my guess, not contradicted*): convert at a parent-set rate.
  *Builder's call* whether to ship this in v1 or defer it. Default: defer and note it.

### Withdrawals
- Kids can pull points back out of their own goals. **The parent can turn withdrawals off.**
- **No withdrawals once a goal is full** and waiting on a parent.
- *My call:* points in a family goal never come back out.

### Family goals
- Shared meter. Kids add points, and **parents can chip in** (a parent contribution doesn't take from any
  kid's balance).
- **Sibling contributions are visible only if a parent enables it** (default off). When off, a kid sees
  the family total and "You gave N".
- Penalties hook: a family penalty can **take from a family goal** or **raise its target**. These are extra
  "what" options on the Penalties sheet (spec `docs/superpowers/specs/2026-11-10-penalties-design.md`
  on branch `docs/penalties` / `feat/penalties`). Build this hook last, after rebasing onto
  `feat/penalties`. Taking from a goal never drops it below 0, and the take is recorded with the reason.

### Reaching and fulfilling
- When a meter fills, the parent gets a notification (new inbox kind; that needs a migration because of
  the CHECK constraint). The kid's card shows "Goal reached! Waiting on [parent]".
- The parent taps **Fulfilled**. The party then plays on the kid's next app open. For family goals it
  plays for every kid.
- **Party:** a full-screen overlay where all six mascots come in and dance, with confetti, the goal name,
  "[Parent] made it official", and a "Goal complete" badge. It respects reduce-motion (static pose and no
  confetti). It plays once (seen flag) and is dismissible with a tap. Reuse `kid/celebrate/`.
- Fulfilled goals move to a small "Done" history on the kid and parent screens (*builder's call*).

### Parent UI (mockup)
- A Goals screen in the parent nav (*builder's call* for placement, following declutter nav rules).
  Order: "Waiting on you" (full goals to fulfill, suggestions to price), Family goals with "Chip in",
  kids' goals as thin bars, "+ New goal (custom or built-in)", and a "Goal settings" link.
- Goal-related "Waiting on you" items also appear in Today's Needs-you list.
- Feature discoverability: add a Try-this card (`try.goals`) and an onboarding Optional-extras toggle.

### Kid UI (mockup)
- A "My goals" section in the kid app (*builder's call*: in the Rewards tab, or its own tab if the tab
  bar has room for the age mode). Each card shows a meter, an amount, an auto-share note or "+ Add", and a
  "Family" chip for family goals. "+ Suggest a goal" is shown only when suggestions are on.

### Settings (family-level, one "Goal settings" pane)
- Goals on/off (*builder's call*: **on by default**. It's turnkey, nothing happens until a parent
  creates a goal, and the Try card introduces it).
- Kid suggestions on/off (default on). Withdrawals on/off (default on). Show sibling contributions
  (default off). Default way points go in (by hand / automatic) plus the percentage. Max goals per kid per
  age mode. Built-ins: each one on/off plus its price.

## Constraints
- Parent UI uses the approved parent tokens. Kid UI uses the kid tokens (Space Grotesk/Inter, hard shadows).
- Money-like paths run under the existing `SPEND_LOCK` and are transactional. Server-side authz: kids act
  only on their own goals, and only parents fulfill, price, or chip in.
- Files under 500 lines. Semantic commits and semver.

## Left to the builder
API shapes, data model details (e.g. `Goal`, `GoalContribution`, `GoalSuggestion`), component split, copy
polish within the mockup, and tests.
