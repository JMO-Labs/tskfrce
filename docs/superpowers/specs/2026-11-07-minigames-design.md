# Minigames design

Status: draft for owner approval, 2026-11-07. Roadmap: last on the work list, after setup presets (owner). Mockup: `.superpowers/mockups/minigames-v1.html` (owner said "good").

## Why

Chores pay off later: points, screen time. Kids also need a reward that lands right away. A short, fun game right after a chore gives that quick hit. Unlocks and power-ups that make the next round a little easier bring kids back, and coming back means doing another chore. The owner expects this to carry a lot of value.

## Goals

- Fun yet challenging: easy to start, hard to master.
- A mix of learning games and pure-fun games. Most work for every age; a few are for older kids.
- Rounds stay short: a quick-fire run is about 1 minute, a thinking game is up to about 2.
- The game is picked at random, with fun mascot entry and exit animations.
- Games unlock upgrades, power-ups, flair and badges.
- Like arcade tickets, games pay a little toward screen time.
- On by default, and easy to switch off.

## Non-goals

- Ads, purchases, chat, or any text written by other users.
- Online multiplayer. Leaderboards are family-only, on the home box.
- Recreations of existing games. Every game, name and drawing is our own. Familiar genres are fine (reaction "microgames", catch-the-falling-thing, sliding puzzles).
- Self-checking chores (deferred by owner).

## Anti-goals (the owner would switch it off if...)

- **Anything offensive.** All content ships in the app and is reviewed before release. Fridge Words has a blocked-word list. Teen Trivia is the riskiest, so its packs are reviewed by hand and avoid politics, violence and upsetting news. Parents can switch Trivia off on its own.
- **Contention between parents or siblings.** Leaderboards compare within an age band and show personal bests first. A shared family total turns siblings into teammates. No kid can affect another kid's stars, power-ups or plays. Being on top grants nothing extra (my call). Parents can hide the leaderboard.
- **Games replacing chores.** A game can only be earned by doing a chore. Ticket points are capped.

## Earning plays (owner)

- **Family switch and per-kid switch.** On by default (owner).
- **How plays are earned**, set by the parent:
  - **every chore** (default, my call)
  - **once a day** (first chore of the day)
  - **random** (each approved chore has a chance; my call: 1 in 2)
  - **custom** (the parent marks which chores give a game)
- A play is earned when a chore is **approved**, by a parent, by trust mode, or at bedtime. This project builds on top of the less-parent-work release (trust mode, bedtime auto-approve), so it starts from main after that merges (my call). Undoing a chore or "Wasn't done" removes one unplayed earned play if any are left (my call).
- **Saved plays:** a kid can hold up to 5 unplayed plays. They never expire (my call).
- **Locked devices:** earned games stay playable when the kid's device time is up or the device is locked (owner). The kid app is always reachable.
- **Bedtime and quiet hours:** games wait until morning (owner). The shelf shows "Games are asleep. They wake up at {time}."

## Tickets → points (owner)

- Each round pays tickets based on score. Tickets become points right away (1 ticket = 1 point, my call).
- **Daily cap:** game points are capped at a tenth of the kid's chore points (owner). The cap belongs to the day the play was **earned**, so a play saved overnight still pays in the morning (my call). Each play records its earned day; game points from plays earned on a day may not exceed 10% of that day's chore points, rounded up, minimum 1 (my call). "Chore points" means every positive row tied to a chore that day, including early bonus and Happy Hour (my call). The parent can change the cap percentage (owner), from 0% to 50% (my call).
- Game points are a separate ledger type so recaps and history can tell them apart (my call: new `PointsType.GAME`). They count toward XP and levels like any earned points; the cap keeps that small (my call).

## Two kinds of play (owner)

1. **Quick-fire run**, about 60 s: tiny games back to back, each with a one-word command and about 3 s to act, speeding up. 3 hearts. Being good never ends the run early. A strong player clears more games and scores higher in the same minute. Losing all hearts ends it.
2. **Thinking game:** one game with its own clock (up to about 2 min). Never stacked.

**Selection:** after earning a play, the kid taps Play. A mascot bounces in and spins the wheel, which lands on a quick-fire run or one thinking game. The wheel is weighted toward games suited to the kid's age group (Little 5–8, Kid 9–12, Teen 13+). Older-kid games never appear for younger groups.

## The games

All original, set in a cartoon house so the games feel like chores. Art is our own; mascots are the owner's existing mascot art.

### Quick-fire (20, owner asked for at least 20)

| # | Name | Action |
|---|------|--------|
| 1 | Sock Snatch | tap the matching pair of socks |
| 2 | Plate Tower | tap to drop a plate onto a swaying stack |
| 3 | Bubble Pop | pop only the called colour |
| 4 | Quick Draw | tap on "Now!", ignore fake-outs |
| 5 | Sweep Swipe | swipe the arrow's direction |
| 6 | Flip! | flip the pancake at the sizzle |
| 7 | Plug! | drag the plug to the right socket |
| 8 | Zip! | swipe up to zip the backpack |
| 9 | Squeeze! | tap fast to fill the moving toothbrush |
| 10 | Dodge! | steer the robot vacuum around a sleeping mascot |
| 11 | Water! | hold to water, release before it floods |
| 12 | Hang! | drop the shirt onto the swinging hanger |
| 13 | Shh! | tap the alarm before it wakes the baby |
| 14 | Catch! | tap to catch tossed keys at the peak |
| 15 | Match! | tap the lid that fits the pot |
| 16 | Fold! | swipe the arrows in order to fold a towel |
| 17 | Feed! | tap the fish bowl exactly once |
| 18 | Spot! | find the muddy footprint |
| 19 | Count! | how many cookies flashed? |
| 20 | Hungry Cat (dash) | a 3 s version: catch one falling treat |

### Thinking and skill games (12)

| Name | Kind | Ages |
|------|------|------|
| Hungry Cat | skill: slide the cat, food falls faster, dodge socks (owner's daughter's favourite) | all |
| Pack the Box | puzzle: fit shapes, tighter each level | all; harder levels Kid+ |
| One-Line Mop | puzzle: mop every tile in one stroke | all |
| Shelf Memory | memory: put items back where they were | all |
| Sort Slide | puzzle: slide tiles into order | all |
| Math Dash | learning: tap the right answer; adding (Little), times (Kid), fractions (Teen) | all |
| Fridge Words | learning: make words from magnet letters | Kid+ |
| Clock Catch | learning: set the clock to the called time | Little, Kid |
| Coin Count | learning: pay with exact change | Little, Kid |
| Logic Grid | puzzle | Teen |
| Type Rush | typing speed | Teen |
| Teen Trivia | quick current-events questions | Teen; separate switch |

The owner's "roughly 10–15 to start" applies to the thinking games; the launch set below starts with 4 and grows.

### Launch set and phases (my call)

- **Phase 1 (this project):** the whole framework, all 20 quick-fire games, and 4 thinking games: Hungry Cat, Math Dash, Pack the Box, Shelf Memory.
- **Phase 2:** the remaining thinking games except Trivia.
- **Phase 3:** Teen Trivia. It needs a content pipeline: the home box downloads a weekly reviewed pack from our update service. It is the only game that needs the internet.

### Difficulty

- Each game has its own difficulty curve. The kid's age group sets the starting point, and doing well raises it during a round.
- Upgrades soften the **start** only, never the top end, so mastery still matters and the leaderboard stays fair.

## Progression (owner)

- **Stars → upgrades.** Each round earns 0–3 stars in that game, and stars fill that game's next upgrade. Each game has about 3 upgrades (owner's examples for Hungry Cat: bigger bowl, slower food at the start). Upgrades are permanent.
- **Every game has its own upgrades, quick-fire games included** (owner). Each of the 20 quick-fire games keeps its own stars, upgrades and power-ups. Some upgrades are shared ideas that recur across games, like **extra time** and **slow time** (owner). Build them once as a shared library that a game opts into, plus a few game-specific ones (my call: about 1 shared and 2 specific per game).
- **Wheel → power-ups.** After a round the mascot's wheel sometimes gives a power-up for that game (my call: 1 in 3). A kid holds at most 2 (my call). Each game has about 2 power-ups (owner's examples for Hungry Cat: Magnet curves food to the mouth; Multiply gives two cats and two mouths). Each is used up in one round.
- **Flair and badges.** Game milestones award badges through the existing badge system (`BadgeAward.badge_key`), for example first 3-star round, 10 rounds of a game, every quick-fire game tried, or a family best. Some milestones unlock flair items in the existing flair slots.
- Upgrades and power-ups are earned only by playing, never bought with points (my call), so chores remain the only source of plays.

## Leaderboard and family total

- Weekly board per age band, ranked by **stars earned this week** (my call: stars reward playing well across games and can't be farmed past the play limit). Above it, the kid's own personal best per game. It can be hidden by a parent setting.
- Rounds that used a power-up count normally (my call): power-ups are part of the game and family-only boards don't need stricter fairness.
- A family total of all rounds this week, shown as a shared number to cheer (my call: it feeds Project 3's family goal meter once that exists).

## Screens (mockup)

1. Chore approved → mascot toast "You earned a game!", with Play now or Save it.
2. Mascot wheel with entry animation.
3. Quick-fire run: command word, hearts, timer, "Faster!".
4. Hungry Cat, with power-up slots. Food falls in front of the cat and into the bowl (owner).
5. Results: stars pop in, tickets → points, upgrade bar, wheel bonus, badge, then the mascot waves goodbye.
6. Games shelf: saved plays, game tiles with stars, family board; bedtime "asleep" state.
7. Parent: one simple Minigames card (frequency, cap, leaderboard switch, per-kid on/off), per the owner's simplicity rule. The Trivia switch arrives with Trivia in Phase 3 (my call).

Plus the turnkey introductions (owner: "highlight everything to show value"): a Try card for parents, a setup-wizard line, a recap line ("Maya played 6 games and earned 2 badges"), and a first-time mascot welcome for kids.

**Motion:** all animations honour reduced motion and the kid's Celebrations setting (Full, Small, Off).

## Constraints

- Games run in the existing kid web app (React, Next.js) on the kid's device, offline from the internet (LAN to the home box). No game engine dependency (my call): canvas or DOM plus `requestAnimationFrame`, and pointer and touch input. Each game is its own module behind one small interface so games can be added without touching the framework.
- The server is the authority on plays, tickets, stars, upgrades, power-ups and the cap. The client reports a finished round (`game`, `score`, `stars`, `power_up_used`). The server validates it against a per-game maximum score and a minimum duration, and rejects impossible results (my call).
- Each play is a single-use token, so a round can't be replayed for tickets.
- Works on phone 390 px and up, in light and dark, and in Little, Kid and Teen modes.
- Files under 500 lines. Semantic versioning: this ships as a minor version.

## Left to the builder

- Exact scoring, star thresholds and ticket tables per game.
- Exact upgrade and power-up names beyond the owner's examples (one theme each).
- Art and sound for each game, in the existing celebration style.

## Addendum 2026-11-10 (owner)
- Spec approved: "ship to swarm".
- **Make-up chores (Penalties feature) earn no game plays and no tickets.** They only reduce a penalty.
- Built on `feat/declutter` (2.8.0); the parent UI follows declutter calm-then-focus. Ships after Presets (2.12.0).
