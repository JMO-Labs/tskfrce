# Excitement pack: design

Engagement project 1 of 5. Status: **draft for owner approval**.

## Why

The market survey found that chore systems die in week one to three. Paper charts are "ignored by day three", gamified apps fade after 3–6 weeks, and parents report "reward fatigue". The owner wants kids to feel excitement every time and parents to have a lever when things go quiet. Every piece is optional and configurable, with sensible defaults. Parents must **learn that each feature exists without visiting Settings**.

## What the owner decided (2026-11-06)

- **Celebrations:** comic-book completion moments that mix the "card pop" with the "word + confetti" from the mockups. They should have **high variety and be fun and silly**. The approved ideas include a rubber stamp, blast off, coin fountain, balloon pop, disco, a confetti sneeze, and the **card exploding**.
- **Mascots:**
  - Silly animals pop up with a speech bubble ("WOW!", "AWESOME", "COOL!", "ROAR-SOME!").
  - The cast: a T-Rex (done, from the owner), a dog with sunglasses, a cat with a crown, a panda eating a taco, an alligator on a skateboard, a T-Rex eating ice cream, and a raccoon with its hands up.
  - The owner makes the AI art. We cut it out and bundle it.
  - Noto Animated Emoji (CC BY 4.0) fills in, with credit given in the app and the docs.
- **Mascot pop-up layout:** the mascot is centred, rises so its image's bottom edge stays below the screen, and the action words always fit narrow screens.
- **Variety ideas:** a random mix with no repeats, rare "legendary" moments, unlockable mascots, seasonal sets, tuning by kid mode, and bigger shows for bigger moments.
- **Happy Hour / Bonus Round:**
  - Point multipliers that parents start **or the system starts**, to stir excitement when engagement is low.
  - The banner is compact (about 70px), with chasing marquee lights, a strobing title, a countdown that shakes gently, and a call to action.
- **Streaks with a freeze**, so one missed day doesn't wipe out progress.

## Goals

1. Every chore moment a kid sees feels different and fun.
2. Parents can start a Happy Hour in one tap from where they already are.
3. A quiet household gets a nudge without the parent having to notice.
4. Each feature introduces itself to parents in context, with one tap to try it or turn it off.

## Non-goals

- Minigames and leaderboards (project 4).
- Kid choice and goals (project 3), and "contribute banked time to family goals".
- The setup presets screen (project 5).
- Sound, beyond a kid-side toggle that is off by default.

## Anti-goals

- Manipulative mechanics: loot boxes, paid boosts, or "you'll lose everything" pressure. Streak copy stays kind.
- Animations that block a kid from using the app, or that ignore "reduce motion".
- Notification spam. Happy Hour sends at most one kid alert when it starts. Auto-started Happy Hours are limited to one per kid per day.
- Anything that requires an internet download at runtime. All art is bundled on the box.

## How it works

### 1. Celebrations (kid screens)

- **Events:** chore submitted, chore approved, badge, level up, streak milestone (3, 7, 14, 30…), Happy Hour start, and reward bought. The existing `AwardOverlay` / `/kid/awards` celebration queue stays for badges and levels. The new celebrations layer on top of it rather than replacing it.
- **Building blocks, combined at random with no exact repeat of the last one:**
  - a card effect: pop, wiggle, stamp, blast off, or explode
  - a word, from 12 or more, sized to fit the screen width
  - a burst: confetti, coins to the counter, balloon, or disco beams
  - an optional mascot pop-up with a speech bubble, from the owner's cast plus Noto animals
- **Legendary:** about 1 in 25 celebrations is a full-screen parade or dance party.
- **Bigger moments get bigger shows:** level-ups, streak milestones and the first chore of a Happy Hour always get a mascot.
- **Kid modes:**
  - Little: always a mascot, bigger and sillier.
  - Kid: the default.
  - Teen: subtler. A teen can turn mascots off or cut celebrations to "small".
- **Reduce motion:** a static badge ("+20 ✓") and no movement.
- **Length:** at most about 1.5 seconds. Celebrations never block taps, and tapping anywhere dismisses them.
- **Unlockable mascots:** new mascots unlock with levels, using the existing Locker and levels. *(My call: a simple level → mascot table; no new currency.)*
- **Seasonal sets:** date-range sets for December, October and the kid's birthday. *(My call: ship the framework with one set, December. More sets are content work.)*

### 2. Happy Hour

- **Multiplier:** chores submitted during a Happy Hour earn ×N base points when approved. The bonus applies to base points only; the early bonus is unchanged. Choices are ×1.5, ×2 (the default) or ×3. Duration is 30, 60 (the default) or 90 minutes.
- **Who it covers:** all kids, or chosen kids.
- **How it starts:**
  - **Parent, one tap:** a "Start Happy Hour" button on the Today page (desktop header and phone), and in each kid's page. The parent can pick a length and multiplier, or accept the defaults.
  - **Scheduled (off by default):** "A surprise Happy Hour once a week". It picks a random hour inside the allowed hours on a random day.
  - **Auto boost (on by default):** when a kid has finished no chores for 2 days in a row, a Happy Hour of 60 minutes at ×2 starts for that kid the next afternoon, inside allowed hours. Parents get a calm notice: "Ana's had a quiet couple of days, so we started a Happy Hour for her." At most once per kid per day, and at most twice a week. *(Owner: "the system… can enable". My call on the rule and the default.)*
- **Kid side:**
  - The compact marquee banner on Today, with chore points shown doubled and the old value struck through.
  - One kid alert when it starts. A generic line "Happy Hour started!" is added to `GENERIC` in push.py, so it is safe to send through the public relay.
- **Data:**
  - A new `happy_hours` table: `id`, `starts_at`, `ends_at`, `multiplier`, `source` (parent | schedule | auto), `kid_ids` (null means all), and `created_by`.
  - The multiplier is fixed onto the chore run when it is submitted, so a late approval still pays it.
- **Settings:** under Kids & chores → Rewards → **Happy Hour**: the default multiplier and length, plus the "Surprise Happy Hour weekly" and "Auto boost when things go quiet" switches.

### 3. Streak freeze

- The existing derived streak (`progression.streak_of`) is kept as it is.
- **Earning freezes:** a kid earns one freeze for every 7-day run, holding up to 2.
- **Using freezes:** a missed day uses one up automatically, so the streak continues and shows a ❄ on that day.
- **Data:** a `streak_freezes` table with `kid_id`, `day`, and `earned` | `used`. `streak_of` treats a used freeze day as done.
- **Default:** on, with a switch in Settings under Points rules.
- **Copy:** kind and plain. "Freeze used: your streak is safe 🧊". There is no shaming.

### 4. Discovery (parents learn without visiting Settings)

- **"Try this" cards on the parent Today page:**
  - One card at a time, dismissible, at most one new card a day.
  - Each card has a picture, one sentence about what the feature does, and one-tap buttons: try it now, turn it off, or not now.
  - Cards: Celebrations ("Kids now get a comic-book cheer when they finish a chore. Preview it."), Happy Hour ("Double points for an hour gets chores moving. Start one now?"), Streak freeze, and Auto boost.
  - Seen and dismissed state is stored for each parent.
- **Contextual nudges:**
  - When a kid goes quiet and auto boost is off, a card offers to start a Happy Hour.
  - After the first week, a card points to the weekly recap (when that ships).
- **Setup Finish screen:** one line, "Celebrations, Happy Hour and streak freezes are on. Each one introduces itself on Today."
- **"Preview" buttons:** the Settings for celebrations has a preview that plays one on the parent's screen.

## Defaults (turnkey)

| Feature | Default |
|---|---|
| Celebrations | on, Kid style, sound off |
| Mascot pop-ups | on |
| Happy Hour (manual) | available |
| Surprise Happy Hour weekly | off |
| Auto boost when quiet | on |
| Streak freeze | on |
| "Try this" cards | on, max one per day |

## Assets and licensing

- Owner mascots go in `frontend/public/celebrate/mascots/*.svg` (WebP embedded). The cut-out script is committed as `scripts/art/cutout.py`, and its use is documented.
- Noto animated emoji go in `frontend/public/celebrate/noto/*.webp`, using the animated WebP form, so no Lottie player dependency is needed. Credit goes in the About page and `docs/CREDITS.md`, for example "Animated emoji by Google, Noto Emoji Animation, CC BY 4.0", with a link.
- Animations are CSS only, with no new JS animation library. *(My call: plain CSS keyframes, as in the mockups.)*
- Total added asset size is ≤ 3 MB.

## UI (existing tokens only)

- Use the approved kid and parent tokens. Light and dark screenshots on phone and desktop, for every surface.
- The new celebration moments are reviewed against the approved mockups in the brainstorm folder: the excitement-v2 and v3 screens and the trex-tryout v5 screen.

## Docs

- Guide 04: Happy Hour, Auto boost, Streak freeze, and "Try this" cards.
- Guide 05 (kids): Happy Hour and freezes.
- Credits.
- One line on the Pages feature list, with a short GIF or WebP of a celebration on the site.
- Version **2.6.0** (after time banking's 2.5.0).

## Settled after the code check (my calls)

1. **Celebration triggers.**
   - Badges and levels keep the existing `GET /kid/celebrations` queue (`seen_by_kid`) and `AwardOverlay`.
   - The new moments are client-side only: chore submitted (on the kid's own tap), chore approved (detected from `/kid/today`), Happy Hour start, and streak milestone.
   - An approval made while the kid was away plays the next time they open the app. Device-local "last seen approval" decides this.
2. **Alerts.**
   - Kid side: a `happy_hour` kind is added to both `inbox.KID_KINDS` and `push.GENERIC` ("Happy Hour started!").
   - Parent side: a new notify event `boost`, labelled "Auto Happy Hour started", added to `DEFAULT_EVENTS`, not SECURITY. It goes to the inbox with the calm copy.
3. **Where the settings go.**
   - Happy Hour settings sit in the same Rewards pane as Screen time.
   - The streak freeze switch goes in the existing "Points rules" fold (FamilyCards).
   - The builder confirms the exact nav labels in `SettingsPage`/`KidsPage`.
4. **Multiplier storage.**
   - `chore_runs.hh_mult_x10` is an int that is null or 15/20/30. `chore_actions.submit` sets it from the Happy Hour active at that moment.
   - `send_back` clears it, and a resubmit re-evaluates it.
   - It applies to the **base** row only, as `floor(base * mult)`. The early bonus is unchanged.
   - Eligibility comes from the submitting kid. With no submitter (a parent or integration marks it done), the multiplier applies only if the Happy Hour covers all kids.
5. **Scheduling.**
   - Auto boost and the weekly surprise run from `notify_jobs.tick`, with date-guard columns that follow the `summary_date` pattern.
   - **Quiet** means: the kid had assigned runs on each of the last 2 chore days and submitted or completed none of them. Days with nothing assigned don't count.
   - Auto boost starts at **16:00 local the next day** for 60 min. The weekly surprise picks a random weekday at 16:00, 17:00 or 18:00. *(Simple fixed windows; no allowed-hours maths.)*
   - Caps come from querying `happy_hours` where `source='auto'`.
6. **Cards.**
   - Dismissal reuses the existing `DismissedTip` (`api/tips.py`, `tips.ts`).
   - Order: Celebrations, Happy Hour, Auto boost, Streak freeze, then contextual nudges.
   - "One new card a day" is enforced on the device.
   - "Turn it off" PATCHes the feature's setting and dismisses the card.
7. **Streak freeze stays derived, so there is no table.**
   - `progression` already says "nothing stored", so a new pure `streak_with_freezes(days, today)` walks the days.
   - It earns a freeze each time the run reaches a multiple of 7 (holding 2 at most). A missed past day with a freeze held uses one and marks it frozen.
   - Today never breaks the streak, the same as now.
   - `progress_many` and the leaderboard call it only when the family setting is on.
   - A milestone celebration fires on the client when the streak reaches 3, 7, 14 or 30.
8. **Per-kid celebration level.**
   - New `users.celebrate` column: full / small / off. The default comes from mode: little and kid get full, teen gets small.
   - Both the kid (Me page) and the parent can change it.
   - The sound toggle is stored on the device.
9. **Mascot unlocks.** A static frontend catalogue (level → mascot), with no table. Unlocks are not shown in the Locker in v1.
10. **The `/kid/today` payload** gains `happy_hour: {ends_at, multiplier} | null`, plus `points_now` per run for the doubled display.
11. **Branch order.** Build after time banking merges (rebase onto 2.5.0).

## Left to the builder

- Exact keyframes and the word list. These must follow the mockups.
- Test shapes.
- How the server tells the kid client "this approval happened during a Happy Hour" (likely a field on the run).
- Which Noto animals and props to bundle (at most 20).

## As built

- Owner mascots (T-Rex, dog, cat and the rest of the owner's art) are always available. Noto animals unlock by level.
- Each celebration picks a random character, style, entry and burst, with fireworks as a burst.
- On phones the mascots sit behind the bottom nav.
- The real chore tile animates, not a copy.
- Team runs only get the bonus from an all-kids Happy Hour.
- The ledger label reads "(Happy Hour ×N)".
- "Quiet" means the last 2 run days (days with chores), and kids active today are skipped.
- Streak freezes don't add days. Badges use the freeze-protected streak.
- "Mode default" is the raw `null` in `users.celebrate`.
- The Happy Hour settings pane is a sibling of Screen time, under Rewards.
- Celebrations "Turn off for all kids" acts on the current kids one by one. New kids start on.
- The "Try this" nudge snooze is device-local.
- Query budgets: `/kid/today` is 20, `/today` is 24.

