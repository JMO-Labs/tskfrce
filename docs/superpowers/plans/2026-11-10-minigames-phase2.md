# Minigames Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add the three remaining phase-2 launch thinking games (Math Dash, Pack the Box, Shelf Memory), permanent upgrades from stars, wheel-bonus power-ups, and the results upgrade bar and wheel-bonus card from mockup section 5.

**Architecture:** Upgrades are derived, not stored: `GameProgress.stars_total` (thinking games, quick-fire) or `GameProgress.clears` (`qf:<key>` microgames) against fixed thresholds. Power-ups are stored in one new table. Start returns the game's unlocked upgrades and held power-ups; finish takes the power-up used, consumes it, and may award a new one. Upgrades only soften the start of a round.

**Spec:** `docs/superpowers/specs/2026-11-07-minigames-design.md` (Progression, Builder's calls). Phase 1 plan: `2026-11-10-minigames.md` (Global Constraints apply unchanged). Branch `feat/minigames-p2`, stacked on `feat/minigames`.

## Builder's calls for phase 2

- Thresholds: upgrade 1/2/3 at 6/15/30 stars (thinking games and quick-fire) or 5/15/30 clears (each microgame).
- Shared upgrades: `extra_time` (+15% time) and `slow_start` (first 20% of the round slower). Every game has 3 upgrades: 1 shared plus 2 of its own (table below).
- Power-ups belong to the thinking games and the quick-fire run, not to single microgames. Wheel bonus: 1 in 3 after a valid round, if the kid holds fewer than 2 power-ups in total. One power-up is used per round.
- Upgrades never raise the top-end difficulty or the score caps.

| game | upgrades (in order) | power-ups |
|---|---|---|
| quickfire | extra_time "Extra time", spare_heart "Spare heart" (+1 heart at start, max 4), calm_start "Calm start" (first 4 games at level −1) | heart_plus "Heart+" ❤️ (one extra heart), slow_mo "Slow-mo" 🐢 (first 6 windows ×1.5) |
| hungry-cat | slow_start "Slower food", big_bowl "Bigger bowl" (catch width 0.12→0.16), extra_time "Extra time" (+9 s) | magnet "Magnet" 🧲 (food within 0.25 curves to the cat), multiply "Multiply" ✖️2 (a second cat mirrors the first) |
| math-dash | extra_time, hint "Hint" (one wrong answer greyed for the first 5 questions), streak_saver "Streak saver" (first miss doesn't break the streak) | freeze "Freeze" ❄️ (clock stops 10 s), fifty "50/50" ✂️ (two wrong answers hidden for 3 questions) |
| pack-the-box | extra_time, preview "Peek" (next piece shown), rotate_free "Free spin" (first level gets an extra box cell) | undo "Undo" ↩️ (take back 3 moves), shrink "Shrink" 🔽 (one piece becomes 1 cell smaller) |
| shelf-memory | extra_time, longer_look "Longer look" (+1 s viewing), fewer_items "Tidy shelf" (first round has one item fewer) | peek "Peek" 👀 (see the shelf again for 2 s once), lock "Lock" 🔒 (one placed item locks in as correct) |
| each microgame `qf:<key>` | extra_time (+15% window), slow_start (−1 level for its first appearance), steady "Steady" (+10% tolerance, or −1 tap/item where tolerance doesn't apply) | none |

Catalog values: math-dash (`🧮`, all ages, 60 s, max 120, min 3 s, rate 1.5, stars 10/20/30; Little adding within 10, Kid times tables 2–10, Teen fractions/percent). pack-the-box (`📦`, all ages, 120 s, score = boxes packed, max 30, min 5 s, rate 0.3, stars 2/4/7; Little 3×3 boxes with 2-cell pieces, harder boxes for Kid+). shelf-memory (`🧠`, all ages, 120 s, score = items put back right, max 80, min 5 s, rate 1, stars 8/16/28).

## API additions

- Start response adds `"upgrades": ["extra_time", ...]` (unlocked for this game), `"micro_upgrades": {"sock-snatch": ["extra_time"]}` (quick-fire only, only microgames with any) and `"power_ups": [{"key": "magnet", "name": "Magnet", "icon": "🧲"}]` (held for this game).
- Finish body adds `"power_up": "magnet" | null`. The server rejects with 422 one not held, and consumes it otherwise.
- Finish response adds:
  - `"upgrade": {"name": "Bigger bowl", "have": 5, "need": 6} | null` (the next upgrade; `have` and `need` are cumulative stars);
  - `"unlocked": "Bigger bowl" | null` (unlocked by this round);
  - `"bonus": {"key","name","icon"} | null` (the wheel-bonus power-up won).
- Shelf `games[]` items add `"upgrades": int` (number unlocked).

### Task A (backend): catalog, upgrades, power-ups

Files: `backend/app/services/games_catalog.py` (3 games, `UPGRADES`, `POWER_UPS`, `upgrades_for(game, n) -> list[str]`, `next_upgrade(game, have) -> dict|None`), new `backend/app/services/minigames_power.py` (`held`, `use`, `maybe_award(db, kid_id, game, rng)`), `backend/app/models/game.py` (`GamePowerUp`: id, kid_id FK CASCADE index, game String(32), key String(16), won_at), migration `b3n4o5p6q7r8` (down `a2m3n4o5p6q7`), `minigames_play.py` (start, finish and shelf fields; keep file < 500 lines — move shelf/board to `minigames_shelf.py` if needed), `api/kid_games.py` (`power_up` field), tests `tests/test_games_p2.py`. TDD: thresholds, unlocked lists, power-up not held → 422, consumed once, award odds with a stub rng (0.2 → award, 0.5 → none), max 2 held, new games picked by the wheel for each age, single alembic head.

### Task B: Math Dash · Task C: Pack the Box · Task D: Shelf Memory (frontend, parallel)

Each in `frontend/src/v2/games/<name>/` with a pure `logic.ts` and a view component, `({ level, seed, age, upgrades, powerUp, onEnd(score) })`. Each has a `*.module.css` in the kid look and a power-up slot row like Hungry Cat (mockup section 4 `.pups`). Tests cover logic and view (right answer → score, clock end → `onEnd` once, each upgrade and power-up effect).

### Task E (frontend): upgrades and power-ups in existing games + screens

- Hungry Cat: the upgrades and power-ups from the table; slots show the held power-up and are tappable to arm it before the round starts.
- QuickFire: run upgrades and power-ups, plus per-microgame `extra_time` (window ×1.15) and `slow_start`. `steady` is passed to the microgame as the optional prop `MicroProps.easier?: boolean`; each microgame widens its tolerance or reduces taps when set.
- GamesPage: routes `game` to the new components, passes `upgrades` and `power_ups`, and sends `power_up`.
- Results (mockup s5): the upgrade card (name, bar, "5 of 6 ⭐"), "🎉 Unlocked: {name}", and "🎡 Wheel bonus: {icon} {name} saved for next time".
- `catalog.ts`/`scoring.ts`: the new games.
- Shelf tiles: new games show "New".

### Task F: verification

Full CI, a single alembic head, screenshots vs mockup s4/s5 (phone, tablet, desktop; light, dark, reduced), and each new game played once via a dev hook `/kid?game=<key>` (extend `devMicro.ts`).
