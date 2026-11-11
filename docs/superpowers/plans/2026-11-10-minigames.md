# Minigames Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kids earn a minigame play when a chore is approved, spin a mascot wheel, play a 60 s quick-fire run (20 microgames) or Hungry Cat, and get stars, tickets → capped points and badges, with the server as the authority.

**Architecture:** Backend: two new tables (`game_plays`, `game_progress`), family/kid/chore switches, a pure catalog (`games_catalog.py`), an earning service (`minigames.py`) hooked into approve/undo, a play service (`minigames_play.py`) and a kid router (`kid_games.py`). Frontend: `src/v2/games/` holds the framework (types, catalog, scoring, hooks), 20 microgame components behind one `Micro` interface, a quick-fire runner, Hungry Cat, and the kid screens. The parent side gets one Minigames summary row in Settings › Family.

**Tech Stack:** FastAPI, SQLAlchemy, Alembic, pytest; Next.js 16, React 19, TanStack Query, Mantine 9, Jest + Testing Library. No game engine.

**Spec:** `docs/superpowers/specs/2026-11-07-minigames-design.md` (read it first, including "Builder's calls" at the end). **Mockup (binding look):** `.superpowers/mockups/minigames-v1.html` (open in a browser; base64 fonts make it long).

## Global Constraints

- Worktree `/home/user/code/tskfrce-minigames`, branch `feat/minigames`. Never `git checkout`, `stash`, `reset`, `rebase` or `add -A`. Stage only your own files by path. If `index.lock` exists, wait 2 s and retry.
- Backend venv: `/home/user/code/tskfrce/backend/.venv/bin/` (python, pytest, alembic, ruff). Run from `backend/`.
- Frontend: run from `frontend/`: `npx jest <path>`, `npm run lint`, `npm run type-check`.
- Every file stays under 500 lines. Strict TDD: failing test first.
- Semantic commits, each ending with a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Original games only: no names, characters, art or levels from existing titles. Art is emoji + CSS shapes in the kid style + the owner's mascots (`/celebrate/mascots/*.svg`, listed in `src/v2/kid/celebrate/catalog.ts` `MASCOTS`, `art: 'cutout'`).
- Kid look: use the kid tokens from `src/v2/kid/kid-app.css` (`--k-bg --k-card --k-ink --k-sub --k-line --k-soft --k-sun --k-green --k-coral --k-shadow`) and `.k-disp` for display type. They match the mockup values exactly, light and dark.
- Copy: plain, short, sentence case, no em dashes in UI text.
- Phone 390 px and up, light + dark, Little/Kid/Teen modes. Buttons at least 44 px tall.
- Motion: gameplay always runs. Decorative motion (mascot entry, wheel spin, star pop, wave) is skipped when `prefers-reduced-motion: reduce` or the kid's Celebrations is `off`, and shortened when `small`.
- Server is authoritative; client values are only reports.

## Review Focus

1. **Replay / double finish:** posting the same finish token twice (or two tabs racing) must pay once; the second gets 404. Test in Task 4.
2. **Cap across midnight:** a play earned yesterday and finished today pays against yesterday's cap. Test in Task 3/4.
3. **Undo after play started:** undo removes only a `saved` play; a `started` play stays playable. Test in Task 3.
4. **Asleep window crossing midnight** (21:00 → 06:00) and quiet hours 22:00 → 07:00 both handled; start returns 409 while asleep. Test in Task 3.
5. **Microgame double callbacks:** a microgame calling `onDone` twice, or after the runner timed it out, must not double-count a part. Test in Task 12.

---

## API contract (all tasks rely on this)

`GET /api/v1/kid/games` (`view_kid`) →
```json
{"on": true, "saved": 3, "fresh": 1,
 "started": {"play_id": 7, "token": "…", "game": "hungry-cat", "kind": "think", "level": 2, "slots": ["quickfire", "hungry-cat", "quickfire", "hungry-cat", "quickfire", "hungry-cat"], "slot": 1} ,
 "asleep_until": "2026-11-11T12:00:00Z",
 "games": [{"key": "quickfire", "name": "Quick-fire", "kind": "quick", "icon": "⚡", "stars": 2, "rounds": 5, "best": 1240},
           {"key": "hungry-cat", "name": "Hungry Cat", "kind": "think", "icon": "🐱", "stars": 0, "rounds": 0, "best": 0}],
 "board": {"band": "kid", "rows": [{"kid_id": 3, "name": "Maya", "avatar": "🦊", "stars": 12, "me": true}]},
 "family_rounds": 14,
 "cap": {"left": 3, "max": 5}}
```
`started` and `asleep_until` may be `null`; `board` is `null` when the parent hid it. `stars` per game = best stars in one round.

`POST /api/v1/kid/games/start` (`require_kid`, body `{}`) → the `started` object above. 403 `"Games are off."`; 409 `"Games are asleep until 7:00 AM."`; 409 `"No saved games. Finish a chore to earn one."`. Returns the existing started play when there is one.

`POST /api/v1/kid/games/finish` (`require_kid`) body `{"token": str, "score": int, "parts": [{"game": "sock-snatch", "ok": true, "ms": 1200}] | null}` →
```json
{"stars": 2, "tickets": 6, "points": 3, "capped": true, "score": 1240, "best": 1240, "new_best": true,
 "badges": [{"key": "arcade_ace", "name": "Arcade Ace", "icon": "🕹️", "tier": 1}], "saved": 2}
```
404 `"That game already ended."` for an unknown/used token; 422 `"That score isn't possible."` for an impossible result (the play is then closed with 0 points so it can't be retried).

`POST /api/v1/kid/games/seen` (`require_kid`) → 204; marks all saved plays seen.

`GET /api/v1/kid/today` gains `"games": {"on": bool, "saved": int, "fresh": int}`.

Parent: `GET/PATCH /api/v1/family` gain `games_on: bool`, `games_earn: "every"|"daily"|"random"|"custom"`, `games_cap_pct: int (0..50)`, `games_board: bool`; GET also `games_rounds: int` (finished plays, all kids, all time). `GET /kids` rows and `PATCH /kids/{id}` gain `games_on: bool`. Chore out/create/update gain `gives_game: bool`.

---

### Task 1: Models and migration

**Files:**
- Create: `backend/app/models/game.py`, `backend/alembic/versions/a2m3n4o5p6q7_minigames.py`
- Modify: `backend/app/models/family.py`, `backend/app/models/user.py`, `backend/app/models/chores.py` (Chore), `backend/app/models/points.py`, `backend/app/models/__init__.py`
- Test: `backend/tests/test_games_models.py`

**Interfaces — Produces:**
- `FamilySettings.games_on` Bool default True, `games_earn` String(6) default `"every"` (check `IN ('every','daily','random','custom')`, name `ck_family_games_earn`), `games_cap_pct` Integer default 10 (check `0..50`, `ck_family_games_cap`), `games_board` Bool default True. All with `server_default`.
- `User.games_on` Bool default True; `Chore.gives_game` Bool default False.
- `PointsType.GAME = "game"`; `ck_points_reason` adds `'game'`.
- `GamePlay` (`game_plays`): `id`, `kid_id` FK users CASCADE index, `run_id` FK chore_runs SET NULL nullable, `earned_day` Date, `earned_at` DateTime, `status` String(8) check `IN ('saved','started','done','revoked')` default saved, `seen` Bool default False, `token` String(43) unique nullable, `game` String(24) nullable, `level` Integer nullable, `slot` Integer nullable, `started_at`, `finished_at` DateTime nullable, `score`, `stars`, `tickets`, `points` Integer nullable.
- `GameProgress` (`game_progress`): PK (`kid_id`, `game` String(32)), `rounds`, `best`, `best_stars`, `stars_total`, `clears` Integer default 0.

- [ ] **Step 1:** Test `test_games_models.py`: create a family, kid, a `GamePlay(status="saved")` and a `GameProgress`; assert defaults (`games_earn == "every"`, `games_cap_pct == 10`, `kid.games_on is True`, `play.seen is False`); assert a `Points(reason="game", points_type=PointsType.GAME)` row commits; assert `GamePlay(status="bogus")` raises `IntegrityError`.
- [ ] **Step 2:** Run `pytest tests/test_games_models.py -q` → FAIL (import error).
- [ ] **Step 3:** Add the models. Migration `a2m3n4o5p6q7`, `down_revision = "f1a2b3c4d5e7"`: batch-alter the four tables (copy the `ck_points_reason` drop/recreate pattern from `c9d0e1f2a3b4_integrity.py`), create both tables. Downgrade reverses it.
- [ ] **Step 4:** `pytest tests/test_games_models.py tests/test_migrations.py -q` → PASS; `alembic heads` shows one head `a2m3n4o5p6q7`.
- [ ] **Step 5:** Commit `feat(games): play and progress models, family and kid switches`.

### Task 2: Game catalog and scoring (pure)

**Files:** Create `backend/app/services/games_catalog.py`; Test `backend/tests/test_games_catalog.py`

**Interfaces — Produces:**
```python
@dataclass(frozen=True)
class GameDef: key: str; name: str; kind: str  # "quick" | "think"
    icon: str; ages: tuple[str, ...]; max_score: int; min_secs: int; max_rate: float; stars_at: tuple[int, int, int]
GAMES: dict[str, GameDef]   # "quickfire", "hungry-cat"
MICRO: tuple[str, ...]      # the 20 microgame keys, in spec order:
# sock-snatch plate-tower bubble-pop quick-draw sweep-swipe flip plug zip squeeze dodge
# water hang shh catch match fold feed spot count cat-dash
TICKETS = (1, 3, 6, 10)
START_LEVEL = {"little": 1, "kid": 2, "teen": 3}
def part_score(ms: int) -> int            # 100 + max(0, 50 - ms // 60)
def quick_score(parts: list[dict]) -> int # sum of part_score for ok parts
def stars_for(game: str, score: int) -> int  # count of thresholds reached
def check_quick(parts, elapsed_s: float) -> bool  # spec builder's-call rules
def check_score(game: str, score: int, elapsed_s: float) -> bool  # 0<=score<=max, elapsed>=min_secs, score<=max_rate*elapsed+1
def eligible_think(age: str) -> list[str]
def pick(age: str, rng: random.Random) -> tuple[str, list[str], int]  # (game, 6 slots, slot index)
```
Values: quickfire `max_score=45*150, min_secs=3, max_rate=150, stars_at=(500,1100,1800)`, icon ⚡, ages all. hungry-cat `max_score=300, min_secs=3, max_rate=4, stars_at=(10,25,40)`, icon 🐱, ages all. `pick`: 50% quickfire else uniform over `eligible_think(age)`; slots alternate `quickfire` and thinking games (cycled) to length 6; `slot` = a random index holding the result.

- [ ] **Step 1:** Tests: `part_score(0)==150`, `part_score(3000)==100`, `quick_score([{ok:True,ms:600},{ok:False,ms:900}])==140`; `stars_for("hungry-cat", 24)==1`, `(…, 40)==3`; `check_quick` rejects 46 parts, a part with `ms=100`, 4 misses, unknown key, and total ms > elapsed*1000+2000; accepts a normal run; `check_score("hungry-cat", 50, 5.0)` False (rate), `(…, 20, 30.0)` True, `(…, 5, 2.0)` False (min_secs); `pick("kid", Random(1))` returns slots of len 6 with `slots[slot]==game`; over 1000 seeds quickfire share is 0.4–0.6.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(games): catalog, scoring and wheel pick`.

### Task 3: Earning, revoking, cap, asleep

**Files:** Create `backend/app/services/minigames.py`; Modify `backend/app/services/chore_actions.py` (`approve`), `backend/app/api/chores.py` (`mark_not_done`), `backend/app/api/trust.py` (take-back); Test `backend/tests/test_games_earn.py`

**Interfaces — Produces:**
```python
MAX_SAVED = 5
def earn(db, run, fam, rng=random) -> list[int]   # kid ids that got a play; flushes only
def revoke(db, run) -> None                       # flush only
def saved_count(db, kid_id) -> int
def cap_for(db, fam, kid_id, day: date) -> tuple[int, int]   # (left, max)
def asleep_until(fam, now_utc: datetime) -> datetime | None   # naive UTC end of window, or None
def enabled(fam, kid) -> bool                     # fam.games_on and kid.games_on
```
Rules: `earn` returns `[]` when `getattr(run, "penalty_id", None) is not None` (make-up chore), or `not enabled`. Per recipient (`economy._recipients(run)`): skip if `saved_count >= 5`; mode `daily` skips if a non-revoked play with `earned_day == run.day` exists; `random` needs `rng.random() < 0.5`; `custom` needs `chore.gives_game`. New play: `earned_day=run.day`, `run_id=run.id`. `revoke`: per recipient, the `saved` play with this `run_id`, else (only if this run earned a play that is no longer saved) the newest `saved` play; set `status="revoked"`. `cap_for`: chore pts = sum of positive `Points.amount` for the kid where `Points.run_id` joins a `ChoreRun` with `day == day`; `max = 0 if pct == 0 else max(1, ceil(pts*pct/100))`; `left = max(0, max - sum(points of done plays with that earned_day))`. `asleep_until`: windows `[bedtime_auto_at, reset_time)` and `[quiet_start, quiet_end)` in `fam.timezone`, each may cross midnight; return the window end as naive UTC.

Hooks: in `chore_actions.approve` call `minigames.earn(db, run, fam)` right after `award_chore`. In `mark_not_done` (before `db.commit()`) and the trust take-back (after `economy.take_back`) call `minigames.revoke(db, r)`.

- [ ] **Step 1:** Tests (use `tests/factories.py` `make_chore`/`make_run` and the parent client): approving a chore creates one saved play; 6th approval with 5 saved creates none; `daily` gives one per chore day; `random` with a stub rng `random()→0.7` gives none; `custom` honours `gives_game`; kid `games_on=False` gives none; a run with `penalty_id` attribute set (use `setattr` on an instance, `pytest.skip` not needed) gives none; `/chores/{id}/undo` revokes its saved play; undo when that play is `started` revokes the newest other saved play and leaves the started one; `cap_for` with chore 30 pts, 10% → `(3,3)`, 0 chore pts → `(1,1)`, pct 0 → `(0,0)`; `asleep_until` at 22:30 local with bedtime 21:00/reset 06:00 → 06:00 next day UTC; at 12:00 → None; quiet 13:00–14:00 at 13:30 → 14:00.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** `pytest tests/test_games_earn.py tests/test_chore_actions.py tests/test_trust*.py -q` → PASS.
- [ ] **Step 5:** Commit `feat(games): earn plays on approval, revoke on undo, daily cap, asleep window`.

### Task 4: Play service

**Files:** Create `backend/app/services/minigames_play.py`; Test `backend/tests/test_games_play.py`

**Interfaces — Consumes:** Tasks 2–3. **Produces:**
```python
def start(db, fam, kid, now_utc, rng=random) -> dict    # the "started" object; raises HTTPException per contract
def finish(db, fam, kid, token: str, score: int, parts: list[dict] | None, now_utc) -> dict  # result object
def shelf(db, fam, kid, now_utc) -> dict               # GET /kid/games body
def started_out(play) -> dict
```
`start`: existing `started` play → return it. Else oldest `saved` play → `pick(kid.age_group)`, `token=secrets.token_urlsafe(32)`, `level=START_LEVEL[age]`, `status="started"`, `started_at=now`, `seen=True`. `finish`: compare-and-set `status started→done` by token and kid (`query.update`, 0 rows → 404). elapsed = now − started_at. Quick: `check_quick` then score = `quick_score(parts)`; think: `check_score`. Invalid → points 0, stars 0, tickets 0, commit, then 422. Valid → stars, `tickets = TICKETS[stars]`, `points = min(tickets, cap_for(... play.earned_day)[0])`; if points > 0 add `Points(points_type=GAME, reason="game", amount=points, description=f"Game: {name}")`; upsert `GameProgress` for the game (rounds+1, best, best_stars, stars_total+=stars) and, for quick parts, a `qf:<key>` row per part (rounds+1, clears+=ok); `economy.level_check`; `badges.check_badges(db, kid, fam)` → returned badge list (new awards whose key starts with a game badge key). `shelf`: per contract; board = kids with same `age_group` and `games_on`, stars = sum `stars` of plays with `finished_at` in the current local week (Monday start, `fam.timezone`), sorted desc, me first on ties; `family_rounds` = done plays this week, all kids; `cap` for the current chore day (`svc.today(db)`).

- [ ] **Step 1:** Tests: start with no saved → 409; start twice returns same token; start while asleep → 409 with "asleep until"; finish quick run with 10 ok parts at 600 ms after 30 s elapsed → score 1400, stars 2, tickets 6, points = cap left; second finish with same token → 404; finish with score 500 Hungry Cat after 10 s → 422 and the play is done with 0 points; play earned yesterday finished today uses yesterday's cap; `GameProgress` rows for `quickfire` and `qf:sock-snatch` exist; shelf board hides when `games_board=False`; board ranks two kids in the same band and excludes a teen.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5:** Commit `feat(games): start and finish rounds with single-use tokens, shelf and board`.

### Task 5: APIs and switches

**Files:** Create `backend/app/api/kid_games.py`; Modify `backend/app/main.py` (include router), `backend/app/api/kid.py` (`today` adds `games`), `backend/app/api/family.py` (`_fam_out` + `games_rounds`), `backend/app/schemas/lock.py` (`FamilyPatch` fields with `Literal`/`Field(ge=0, le=50)`; kid patch `games_on: bool | None`), `backend/app/api/kids.py` (out + patch), chore schema/out (`gives_game`) in `backend/app/schemas/chore.py` and wherever chore out dicts are built (`grep -rn '"always_check"' app`); Test `backend/tests/test_games_api.py`

- [ ] **Step 1:** Tests via client: GET `/kid/games` as kid and as parent with `X-View-As`; POST start as parent preview → 403; full start→finish→today shows `saved` dropped; `/kid/games/seen` → 204 and `fresh` 0; PATCH `/family` `games_cap_pct=60` → 422, `games_earn="custom"` saves; PATCH `/kids/{id}` `games_on=false` then today `games.on` false; chore create with `gives_game=true` round-trips.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement (thin routes calling Task 4). **Step 4:** `pytest tests -q` → all PASS.
- [ ] **Step 5:** Commit `feat(games): kid games API and parent switches`.

### Task 6: Badges and recap line

**Files:** Modify `backend/app/services/badges.py` (CATALOG + `metrics`), `backend/app/services/recap.py`; Test `backend/tests/test_games_badges.py`

Badges (add to CATALOG): `arcade_ace` "Arcade Ace" 🕹️ "Games played." `games_played` 10,25,50,100,250; `triple_star` "Triple Star" 🌟 "3-star game rounds." `three_star` 1,5,10,25,50; `try_it_all` "Try It All" 🧩 "Quick-fire games tried." `micro_tried` 5,10,15,20; `house_record` "House Record" 🏠 "Family bests held." `family_bests` 1,2; `cat_snack_champ` "Cat Snack Champ" 🐱 "3-star Hungry Cat rounds." `hc_three` 1,5,10,25,50. Metrics from `game_plays` (done) and `game_progress` (`qf:` rows with rounds > 0; family best = kid's `best` equals the max `best` for that game over all kids and is > 0, games `quickfire`/`hungry-cat`). Recap: per-kid `games` (done plays this recap week) and `game_badges` (game badge awards earned that week); the text line `"{name} played {n} game(s) and earned {b} badge(s)"` (singular for 1) only when n > 0; `b == 0` → `"{name} played {n} game(s)"`. Add the same two fields to the recap API per-kid dict.

- [ ] **Step 1:** Tests: after one 3-star Hungry Cat finish the kid has `triple_star`, `cat_snack_champ`, `house_record`; recap week text is "Maya played 1 game and earned 2 badges" (singular "game" for 1); no line when 0.
- [ ] **Step 2–4:** FAIL → implement → `pytest tests -q` PASS; `ruff format --check . && ruff check .` clean.
- [ ] **Step 5:** Commit `feat(games): game badges and recap line`.

### Task 7: Frontend core

**Files:** Create `frontend/src/v2/games/types.ts`, `catalog.ts`, `scoring.ts`, `useElapsed.ts`, `useGames.ts`, `rng.ts`; Test `frontend/tests/v2/games/core.test.ts(x)`

**Interfaces — Produces:**
```ts
// types.ts — API shapes from the contract: GamesShelf, StartedPlay, FinishBody, FinishResult, GamePart
export interface MicroProps { level: number /*1..5*/; rng: () => number; onDone: (ok: boolean) => void }
export interface Micro { key: string; name: string; cmd: string /*one word, caps, e.g. 'FLIP!'*/; Component: (p: MicroProps) => JSX.Element }
// catalog.ts
export const GAME_INFO: Record<string, { name: string; icon: string; kind: 'quick' | 'think' }>
// scoring.ts (mirror of Task 2)
export const partScore = (ms: number) => 100 + Math.max(0, 50 - Math.floor(ms / 60))
export const windowMs = (age: AgeGroup, i: number) => number // max(1500, 3200 - i*90) + (little 600 | kid 0 | teen -200)
export const microLevel = (start: number, i: number) => Math.min(5, start + Math.floor(i / 4))
export const RUN_MS = 60_000; export const HEARTS = 3
// rng.ts
export const seeded = (seed: number) => () => number   // mulberry32
// useElapsed.ts — ms since mount, ticking via setInterval(16) + Date.now(); works with jest fake timers
export function useElapsed(running = true): number  // remount with a React key to restart
// useGames.ts
export const useGamesShelf = (enabled = true) // useQuery ['kid','games', as] → api<GamesShelf>('/kid/games', kidInit(as)), refetchInterval 15_000
export const useStartGame = () // mutation POST /kid/games/start → StartedPlay; invalidates ['kid','games']
export const useFinishGame = () // mutation POST /kid/games/finish → FinishResult; invalidates ['kid','games'] and ['kid','today']
export const useGamesSeen = () // POST /kid/games/seen
export const reduceDecor = (celebrate: 'full' | 'small' | 'off') => boolean // true if off or prefers-reduced-motion
```
Also add `games?: { on: boolean; saved: number; fresh: number }` to `KidToday` in `src/v2/types.ts`.

- [ ] Steps: tests for `partScore`, `windowMs('teen', 100) === 1300` (`max(1500, …) - 200`), `microLevel(2, 9) === 4`, `seeded(1)` deterministic, `useElapsed` advances with `jest.advanceTimersByTime(500)`; FAIL → implement → PASS → commit `feat(games): frontend game core`.

### Tasks 8–11: Microgames (5 each, parallel)

**Files:** `frontend/src/v2/games/quick/<Name>.tsx` (one per game), shared `frontend/src/v2/games/quick/quick.css` (Task 8 creates it; others append their own section headed `/* <key> */`), tests `frontend/tests/v2/games/quick/<key>.test.tsx`. Each file exports `export const <name>: Micro`. Task 12 builds `quick/index.ts`.

Stage: each microgame renders inside a 330 px tall `.mg-stage` (runner provides it), centred, emoji art at 64–96 px, tap targets ≥ 56 px, kid tokens. All controls are `<button>`s with accessible names; swipe games also accept arrow keys and pointer swipes (≥ 40 px). Each must call `onDone` at most once (guard with a ref). Difficulty grows with `level`. The runner owns the countdown and kills the component on timeout; timing games read `useElapsed()`.

Per game (key — cmd — rule; level effect):
- **Task 8:** `sock-snatch` PAIR! target sock (coloured CSS sock) shown; tap its match among 3+level; `plate-tower` DROP! a plate slides left↔right over a stack (x = sin(t·(1.5+level·0.4))); tap: ok if |x| < 0.25 − level·0.03; `bubble-pop` POP! a colour word + swatch; 6+level bubbles, 2–3 of that colour; pop all of them, a wrong one fails; `quick-draw` WAIT… shows "Wait…", after `rng`-delay 500–1400 ms shows "NOW!"; level ≥3 adds a fake-out "NOT YET" flash; tap before NOW fails, after NOW ok; `sweep-swipe` SWEEP! a big arrow (↑↓←→); matching swipe/arrow key ok, other fails; level ≥4 shows "opposite!" and wants the reverse.
- **Task 9:** `flip` FLIP! pancake on a pan; a "sizzle" glow lasts 500 − level·50 ms starting at 600–1300 ms; tap in it ok, before fails; `plug` PLUG! plug with a shape (▲●■◆); 3 sockets; drag to or tap the matching socket; `zip` ZIP! backpack; swipe up (or ArrowUp) 1 + floor(level/2) times; any down/side swipe fails; `squeeze` SQUEEZE! tap 6+level·2 times to fill the paste bar; the brush slides as decoration; `dodge` DODGE! 3 lanes, robot vacuum at the bottom, a sleeping mascot (owner mascot img) in one lane near the top; Left/Right buttons or keys move the vacuum; after 1200 − level·100 ms the vacuum arrives: ok if not in the mascot's lane.
- **Task 10:** `water` WATER! hold a can (pointer down / Space): fill rises 0→100 over 1400 − level·120 ms; release in the green band (60–80, narrowing by level) ok, outside fails, over 100 floods (fail); `hang` HANG! hanger swings like plate-tower, shirt drops on tap; `shh` SHH! 3 alarm clocks, one rings with a shrinking fuse (900 − level·80 ms… then onDone(false)); tap the ringing one ok, a silent one fails; `catch` CATCH! keys arc up and down over 1200 − level·100 ms; tap within ±(180 − level·20) ms of the peak ok; `match` LID! a pot of size s; 3 lids of different sizes; tap the one of size s.
- **Task 11:** `fold` FOLD! 2 + floor(level/2) arrows in a row; enter them in order (swipe/keys/buttons); a wrong one fails; `feed` FEED! fish bowl; tap once: ok 700 ms after the first tap unless a second tap comes; `spot` SPOT! grid (3×3, 4×4 at level ≥3) of clean 👣 tiles, one muddy (brown filter); tap muddy ok, others fail; `count` COUNT! 3–(4+level) cookies flash for 1100 − level·120 ms then hide; 3 number buttons; right count ok; `cat-dash` CATCH! 3 lanes, a treat falls in one over 1500 − level·100 ms; Left/Right moves the cat (princess-cat mascot img); ok if the cat is in the treat's lane at landing.

Per game, the test (fake timers, `seeded(42)`): renders the cmd-independent stage; the right action → `onDone(true)` exactly once; a wrong action → `onDone(false)`; a second action after done → no extra call. Commit per task: `feat(games): microgames <keys>`.

### Task 12: Quick-fire runner

**Files:** Create `frontend/src/v2/games/quick/index.ts` (`MICROS: Micro[]` in spec order, 20 entries), `frontend/src/v2/games/QuickFire.tsx`, `frontend/src/v2/games/quickfire.css`; Test `frontend/tests/v2/games/quickfire.test.tsx`

**Interfaces — Produces:** `QuickFire({ age, startLevel, seed, onEnd }: { age: AgeGroup; startLevel: number; seed: number; onEnd: (parts: GamePart[]) => void })`.
Behaviour: order = shuffled `MICROS` (seeded), repeating; per game i: show HUD (hearts ❤️×3 with lost ones `.lost` faded, right "Game {i+1} · ⭐ {score}"), the `cmd` word big (mockup `.cmd`: 64 px display, `text-shadow: 4px 4px 0 var(--k-sun)`), a "FASTER!" pill (coral, mockup `.speed`) for 1.2 s whenever `microLevel` rises, the stage, and a draining timer bar (mockup `.timer`, green) over `windowMs(age, i)`. On `onDone` or timeout record `{game, ok, ms}` once (ignore later calls), flash ✓/✗ 400 ms, next. Miss → heart lost. End at `RUN_MS` total or 0 hearts → `onEnd(parts)` once. Keyed remount per game (`key={i}`).
- [ ] Tests: `MICROS.length === 20` with unique keys matching backend `MICRO`; with a stub micro list injected via an optional `micros` prop: 3 failures end the run with 3 parts; timeout records `ok:false`; double `onDone` records one part; run ends at 60 s; FASTER! appears at game 5. Commit `feat(games): quick-fire runner`.

### Task 13: Hungry Cat

**Files:** Create `frontend/src/v2/games/hungryCat/logic.ts`, `HungryCat.tsx`, `hungry-cat.css`; Tests `frontend/tests/v2/games/hungryCat.test.ts(x)`

**Interfaces — Produces:**
```ts
export interface CatState { t: number; catX: number /*0..1*/; items: { id: number; x: number; y: number /*0..1*/; kind: 'food' | 'sock'; emoji: string }[]; score: number; hearts: number; over: boolean; nextId: number; spawnIn: number }
export const initCat = (level: number, rng: () => number): CatState
export const stepCat = (s: CatState, dtMs: number, catX: number, level: number, rng: () => number): CatState
export function HungryCat({ level, seed, onEnd }: { level: number; seed: number; onEnd: (score: number) => void })
```
Rules: 60 s clock; fall speed `0.35 + level·0.06 + t/60000·0.35` field heights/s; spawn every `max(380, 900 − t/100)` ms; 1 in 5 items a sock 🧦 (food 🐟🍗🧀); an item reaching y ≥ 0.9 within 0.12 of `catX` is caught: food +1, sock −1 heart; 0 hearts or 60 s → over. UI per mockup screen 4: HUD "🍽️ {score}" left, "⏱ 0:41" right; `.field` 540 px (shrinks to fit viewport), `--k-soft` background, princess-cat mascot 120 px at the bottom with the 🥣 bowl in front, food drawn above the cat (z-index) falling into the bowl; drag/pointer move sets catX, ←/→ keys step 0.08; rAF loop calling `stepCat`. Below: power-up slots row (mockup `.pups`) showing empty dashed "+" slots (power-ups arrive in PR 2).
- [ ] Tests: catching food raises score; a sock costs a heart; 3 socks → over; t ≥ 60000 → over; spawn deterministic with `seeded(1)`; component calls `onEnd` once (drive with fake timers + a mocked rAF). Commit `feat(games): Hungry Cat`.

### Task 14: Kid screens and nav

**Files:** Create `frontend/src/v2/games/GamesPage.tsx` (state machine), `Shelf.tsx`, `Wheel.tsx`, `Results.tsx`, `EarnedToast.tsx`, `GamesWelcome.tsx`, `games.css`; Modify `frontend/src/v2/kid/KidNav.tsx` (tab `'games'`, label "Games", icon `sports_esports`, after Chores in all modes, badge = saved), `frontend/src/v2/kid/KidApp.tsx` (render `GamesPage` for the tab; render `EarnedToast` on the Chores tab when `d.games?.fresh > 0`; hide the tab when `!d.games?.on`); Tests `frontend/tests/v2/games/screens.test.tsx` and update existing KidNav tests.

**Interfaces — Consumes:** Task 7 hooks, Task 12 `QuickFire`, Task 13 `HungryCat`. **Produces:** `GamesPage({ mode, celebrate, preview, autoStart }: { mode: AgeGroup; celebrate: CelebrateLevel; preview: boolean; autoStart?: boolean })`; `EarnedToast({ saved, onPlay, onSave })`.

Screens (match the mockup sections 1, 2, 5, 6 exactly in layout, sizes and colours):
- **EarnedToast** (s1): mascot 84 px, "You earned a game!" (20 px display), small "{saved} saved · play now or later"; buttons "▶ Play now" (sun) and "Save it". Pop-in animations `.pop/.pop2` unless decor reduced. Play now → `useGamesSeen`, switch to Games tab with `autoStart`; Save it → `useGamesSeen`.
- **Shelf** (s6): h2 "Games"; saved card "🎟️ {n} games saved" + "Play" (sun, small) — disabled in preview with hint "Only {name} can play"; 2-column tiles (icon 34 px, name, stars ⭐ × best stars or "New"); board card "This week, {Band} group" rows "🥇 You · 12 ⭐" (medals for top 3), and the family total "Family: {n} games this week" line; empty saved → "Finish a chore to earn a game." Asleep: mascot 150 px, desaturated, bobbing; "Games are asleep"; "They wake up at {h:mm AM}. Your {n} saved games will be waiting."
- **Wheel** (s2): mascot slides in with bubble "Spin to pick your game!"; 300 px conic wheel (6 slots, colours from mockup) with labels from `slots` (via `GAME_INFO` names), coral ▼ pointer, "SPIN!" button; spin ~4 s ease-out to land `slot` under the pointer (rotation = 1440 + (360 − (slot·60 + 30))); reduced decor → no spin, shows the result 600 ms, then plays.
- **Play:** `QuickFire` or `HungryCat`; on end → `useFinishGame` with token, score, parts.
- **Results** (s5): waving mascot 130 px, title by stars ("Keep practising!", "Nice!", "Nice catching!"/"Great run!", "Amazing!"), stars pop one by one (grey `.off` for missing), "🎟️ +{tickets} tickets" + small "→ +{points} pts toward screen time" (or "Today's game points are full" when `capped && points === 0`, "→ +{points} pts (today's cap)" when capped), "New best!" chip when `new_best`, each badge as the sun `.badge` card "🏅 New badge: {name}", "Done" (wide sun) → shelf.
- **GamesWelcome:** first Games-tab visit per kid (localStorage `tskfrce.games.welcome.{kidId}`, try/catch): mascot + "Finish chores, earn games! Each game pays a few points." + "Got it".
- **Errors:** 409/403 messages from the server show as a kid-style hint on the shelf.
- [ ] Tests (mock `api`): shelf renders saved count, tiles and board; asleep state text; Play → start → wheel → SPIN → (reduced motion) → mounts QuickFire (stub micros) → finish posts token+parts → Results shows tickets/points/badge → Done returns to shelf; EarnedToast buttons call seen; nav shows Games after Chores with badge count and hides when off; preview disables Play. Commit `feat(games): kid games shelf, wheel, results and toast`.

### Task 15: Parent side and introductions

**Files:** Create `frontend/src/v2/manage/GamesRow.tsx`; Modify `frontend/src/v2/manage/FamilyCards.tsx` (4th `SummaryRow` id `games`, icon `sports_esports`, title "Minigames", line2 via `gamesLine`), `frontend/src/v2/types.ts` (`Family` games fields + `games_rounds`; `Kid.games_on`; chore `gives_game`), chore editor switch "Earns a game" shown only when `family.games_earn === 'custom'` (find the `always_check` switch in `src/v2/manage/` and add beside it), `frontend/src/v2/today/tryCards.ts` + `TryCards.tsx` (`try.games` after `try.celebrate`: eligible when `games_on && games_rounds === 0`; title "Kids earn quick games", body "Each approved chore earns a short game that pays a few points.", button "See settings" → `/settings?section=family&open=games`), setup wizard finish step (`src/v2/setup/StepFinish.tsx` list line "Minigames are on. Kids earn a quick game for each chore."), recap kid line (`src/v2/recap/RecapKids.tsx`, `recapTypes.ts`: show "Played {n} games · {b} badges" when n > 0); Tests `frontend/tests/v2/gamesSettings.test.tsx` + updates.

`gamesLine(f)`: off → "Off"; on → `"${EARN_LABEL[f.games_earn]} · Cap ${f.games_cap_pct}% · Board ${f.games_board ? 'on' : 'off'}"`. EARN_LABEL: every "Every chore", daily "Once a day", random "Random", custom "Custom".
`GamesBody({ fam, save })` (mockup s7, as a calm-then-focus row body): switch "Minigames" (help "Kids earn a quick game for doing chores."); when on: `SegmentedControl` Every chore / Once a day / Random / Custom (Custom help "Pick chores in the chore editor: Earns a game."); "Game points cap" select 0–50 step 5 shown as "10% of chore points"; "Family leaderboard" switch; "Per kid" list with one switch per kid (`usePatchKid`, `{ games_on }`). Uses `Setr`, `Sw`, `Info` from `FamilyRows.tsx`.
- [ ] Tests: row summary text; flipping each control PATCHes the right field; kid switch PATCHes `/kids/{id}`; chore editor shows "Earns a game" only in custom; Try card eligibility. Commit `feat(games): parent Minigames row, chore switch, try card, setup and recap lines`.

### Task 16: Release

**Files:** `backend/app/__init__.py`, `frontend/package.json` + lock (version 2.12.0), `docs/releases/2.12.0.md` (format of `2.8.0.md`: "New for every family" Minigames bullets, "Settings", "Coming next" PR 2 list), `backend/tests/test_health.py` version.
- [ ] Bump, run `pytest tests/test_health.py -q`, commit `chore(release): 2.12.0 minigames`.

## Verification (after all tasks)

`cd backend && ruff format --check . && ruff check . && pytest tests -q && alembic heads` (one head) · `cd frontend && npm run lint && npm run type-check && npx jest --ci` · `npm run test:standalone` · screenshots vs mockup (phone 390, tablet 820, desktop 1280; light, dark, reduced motion) of every screen; play every microgame and Hungry Cat once.
