# Setup presets (Project 5): implementation plan

Spec: `docs/superpowers/specs/2026-11-10-setup-presets-design.md` (read "Builder's calls").
Mockup (binding look): `.superpowers/mockups/presets-v2.html`. Version 2.11.0.

## Rules for every task
- Work in `/home/user/code/tskfrce-presets` (branch `feat/presets`). Other agents work in the same
  folder at the same time. **Commit only your own files with explicit paths** (`git add path1 path2`).
  Never `git add -A`, `git stash`, `git reset`, `git checkout -- .` or a rebase.
- Strict TDD: write the failing test, see it fail, write the code, see it pass.
- Files stay under 500 lines. Plain words in UI copy. No new dependencies.
- Python: `/home/user/code/tskfrce/backend/.venv/bin/python -m pytest tests/<file> -q` from `backend/`.
  Then `ruff format backend && ruff check backend` (run from the repo root).
- Frontend (from `frontend/`): `npx jest <path>`, `npm run lint`, `npm run type-check`.
- Commit: semantic message, body ends with a blank line and
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Shared contract (all tasks code to this)

Styles: `'relaxed' | 'balanced' | 'strict'`. Age groups: `'little' | 'kid' | 'teen'`.

Kid plan (one kid, one style):
```json
{"chores": ["Make bed", "Feed the pet", "Tidy room"], "screen": 120, "bedtime": "20:30",
 "weekend": "22:00", "lock": true, "trust": false, "photo": false}
```
Family plan: `{"banked": true}` (Penalties/Goals keys are added in Task 9 only).

Keys tracked per kid: `chores, screen, bedtime, lock, trust, photo`. Family keys: `banked`.

`GET /api/v1/presets` (parent only):
```json
{"style": "balanced" | null,
 "kids": [{"id": 3, "name": "Ivy", "age_group": "kid", "style": null}],
 "plans": {"little": {"relaxed": KidPlan, "balanced": KidPlan, "strict": KidPlan}, "kid": {...}, "teen": {...}},
 "family": {"relaxed": FamilyPlan, "balanced": FamilyPlan, "strict": FamilyPlan}}
```
`POST /api/v1/presets/preview` and `POST /api/v1/presets/apply`, body:
```json
{"style": "strict", "kids": {"3": "relaxed", "4": null}, "skip": ["chores", "bedtime", "trust"]}
```
All three fields optional. With `style`: family keys and every kid are in scope. Without `style`: only kids
listed in `kids`. A kid's style: `kids[id]` if listed (null = follows family), else their saved style,
else the family style (`style` from the body, else saved, else `balanced`). `skip`: keys not written, but
their applied value is still recorded. Response for both:
```json
{"style": "strict",
 "kids": [{"id": 3, "name": "Ivy", "age_group": "kid", "style": "relaxed"}],
 "changes": [{"kid_id": 3, "who": "Ivy", "key": "screen", "now": 120, "next": 60}],
 "kept": [{"kid_id": 3, "who": "Ivy", "key": "bedtime", "now": "21:15", "next": "20:00"}]}
```
Family keys use `kid_id: null, who: null`. `changes` = keys that will be (preview) / were (apply) written.
`kept` = edited keys whose plan value differs from now. 404 for an unknown kid id, 422 for a bad style or
skip key. Apply saves the styles (family `preset_style`, each listed kid's `preset_style`).

Kid JSON (`GET /kids`, `PATCH /kids/{id}`) gains `chores_lock: bool` and `preset_style: string | null`.
`PATCH /kids/{id}` accepts `chores_lock`.

## Wave A (parallel)

### Task 1 (backend): columns, migrations, kid fields
Files: `backend/app/models/family.py`, `backend/app/models/user.py`, `backend/app/api/kids.py`,
`backend/app/schemas/user.py`, `backend/app/api/setup.py`, new migration(s) in `backend/alembic/versions/`,
new `backend/tests/test_presets_migration.py`, edit `backend/tests/test_kid_api.py` (or a new test file).
1. Test: migration adds the columns and moves saved steps (see `tests/test_finish_step8_migration.py` for
   how migration tests are written). Steps 4..8 become 4; 3 and NULL stay.
2. One migration `a1b2c3d4e5f6_presets.py`, `down_revision = "f1a2b3c4d5e7"`:
   `family_settings.preset_style String(8) NULL`, `family_settings.preset_base Text NULL`,
   `users.preset_style String(8) NULL`, `users.chores_lock Boolean NOT NULL server_default "1"`,
   then `UPDATE family_settings SET setup_step = 4 WHERE setup_step BETWEEN 4 AND 8`. Downgrade drops the
   columns (batch_alter_table for SQLite).
3. Add the columns to the models. `setup.py`: `LAST_STEP = 7`.
4. Test then code: kid `_out` returns `chores_lock` and `preset_style`; `KidPatch` takes
   `chores_lock: bool | None`; `patch_kid` sets it. Run `alembic heads`: exactly one head.

### Task 2 (backend): preset data
Files: new `backend/app/services/presets.py`, new `backend/tests/test_presets_data.py`.
1. `STYLES = ("relaxed", "balanced", "strict")`, `AGES = ("little", "kid", "teen")`.
2. `BASE` (Kid age): relaxed `chores 2, screen 180, bedtime "21:00", lock False, trust True, photo False`;
   balanced `3, 120, "20:30", True, False, False`; strict `4, 60, "20:00", True, False, True`.
3. `OFFSET`: little `chores -1, screen -30, bedtime -60`; kid all 0; teen `chores 0, screen +30, bedtime +60`.
   Weekend = bedtime + 90 minutes. Clamp chores >= 1, screen >= 30.
4. `PICKS` (order matters; take the first N): little `Make bed, Feed the pet, Tidy room, Water plants`;
   kid `Make bed, Feed the pet, Tidy room, Homework`; teen `Unload dishwasher, Take out trash, Homework,
   Tidy room, Practice instrument`.
5. `STARTERS`: dict title -> `(type_name, points, days_or_None)`, copied from
   `frontend/src/v2/setup/starterChores.ts` (days as a list of ints).
6. `FAMILY = {"relaxed": {"banked": True}, "balanced": {"banked": True}, "strict": {"banked": False}}`.
7. `def kid_plan(age: str, style: str) -> dict` returns the Kid plan JSON above.
   `def family_plan(style: str) -> dict`. `def catalog() -> dict` returns `{"plans": ..., "family": ...}`.
8. Tests: the spec table values for Kid age; mockup values (teen relaxed = 2 chores
   `["Unload dishwasher", "Take out trash"]`, 210 minutes, "22:00"; kid balanced = Make bed, Feed the pet,
   Tidy room, 120, "20:30"); little strict screen 30; every pick is in STARTERS; drift test: read
   `../frontend/src/v2/setup/starterChores.ts` (skip if missing) and assert every `{ title: '...', type:
   '...', ... points: N` matches STARTERS by regex.

### Task 3 (frontend): preset types, data hooks, formatting, small widgets
Files: new folder `frontend/src/v2/presets/`: `types.ts`, `usePresets.ts`, `format.ts`, `StylePicker.tsx`,
`StyleSeg.tsx`, `LimitsTable.tsx`, `presets.module.css`; edit `frontend/src/v2/types.ts` (Kid gains
`chores_lock?: boolean; preset_style?: Style | null`). Tests in `frontend/tests/v2/presets/`.
1. `types.ts`: `Style`, `KidPlan`, `FamilyPlan`, `PresetCatalog`, `PresetBody`, `PresetResult` (contract).
2. `usePresets.ts`: `usePresets()` (query `['presets']`, GET `/presets`), `usePreview(body, enabled)`
   (query `['presets-preview', body]`, POST `/presets/preview`), `useApplyPreset()` (mutation POST
   `/presets/apply`, invalidates `presets`, `kids`, `family`, `today`, `chore-lib`, `hours`,
   `screen-time`). Use `api()` from `@/v2/api`.
3. `format.ts`: `minutes(120) -> "2h"`, `minutes(210) -> "3h 30m"`, `minutes(30) -> "30m"`;
   `clock("20:30") -> "8:30"`, `clock("22:00") -> "10:00"`; `STYLE_LABEL`; `ROWS`: ordered rows for the
   table: Chores a day (count), Screen time, Bedtime, Internet locks till chores done (yes/no), You check
   every chore (`trust` -> "trust mode", `photo` -> "yes + photo", else "yes"); `keyLabel(key)` and
   `fmtValue(key, value)` for preview rows (chores -> count, banked -> on/off).
4. `StylePicker.tsx`: radio group of three cards (mockup `.style`): Relaxed "Light chores, more screen
   time, kids are trusted"; Balanced with a "Most families" pill, "Chores first, then internet"; Strict
   "More chores, less screen time, every chore checked". Props `value`, `onChange`. Use real radio inputs
   (keyboard and screen readers). Selected card has the 2px ink border.
5. `StyleSeg.tsx`: Mantine `SegmentedControl` with the three labels, props `value`, `onChange`, `label`
   (aria). Pill look as mockup `.seg` (ink fill on the active one).
6. `LimitsTable.tsx`: `<details>` with summary "See what this sets", a table with a column per kid
   ("Ivy · Balanced") and the ROWS, then a small note "Family-wide: goals and banked time on, penalties
   off (follows the family pick)" built from the family plan (only keys present). Collapsed by default.
7. Tokens only (`var(--p-card)`, `--p-line`, `--p-sub`, `--p-ink`, `--p-acc`, `--p-soft`). Look at
   `frontend/src/v2/setup/stepCards.module.css` and `wizard.module.css` for the wizard look.
8. Tests: format functions; StylePicker changes on click and arrow keys; LimitsTable shows a column per
   kid and is closed by default.

## Wave B (parallel, after Wave A)

### Task 4 (backend): read and write preset-managed settings
Files: new `backend/app/services/preset_state.py`, edit `backend/app/lock/state.py`, new
`backend/tests/test_preset_state.py`, new `backend/tests/test_kid_chores_lock.py`.
1. `current(db, kid) -> dict` with the six kid keys:
   - `chores`: sorted starter titles (`presets.STARTERS`) with an active assignment that includes the kid.
   - `screen`: `ScreenTimeLimit.max_minutes` for the kid, else None.
   - `bedtime` / `weekend` (read, not keys): last `end` of the `allowed`, dateless rule of category
     `school_night` / `weekend` covering the kid; a rule naming the kid wins over an Everyone rule; None if none.
   - `lock`: `kid.chores_lock`. `trust`: `kid.trust_mode`. `photo`: any of the kid's starter chores has `needs_photo`.
   `family_current(db) -> {"banked": fam.screen_rollover}`.
2. `DEFAULT = {chores: [], screen: None, bedtime: None, lock: True, trust: False, photo: False, banked: True}`.
3. Writers, one per key, `write(db, parent, kid, key, value, plans)`:
   - `chores`: add missing titles: find a Chore with that title or create it (type by name from
     ChoreType, points from STARTERS, `created_by_id=parent.id`); create a `ChoreAssignment(mode="each",
     repeat daily or weekly with days)` for this kid alone. If `family.setup_step is None`, also
     `svc.make_runs(db, a, svc.today(db))` and `kid_events.chore_new(db, a)` (copy
     `api/chore_library.py:add_assignment`). Remove extra titles: for each active assignment of that
     chore that includes the kid: if the kid is its only kid, retire it like `delete_assignment` does;
     else remove the kid from `a.kids` and cancel that kid's open runs of it.
   - `screen`: upsert `ScreenTimeLimit.max_minutes` (keep `min_points`); None deletes the row if
     `min_points` is None too.
   - `bedtime`: sets school-night end to `plan.bedtime` and weekend end to `plan.weekend`. Per category:
     if a dateless allowed rule names only this kid, set the end of its last time range. Else take the kid
     off any shared rule of that category (Everyone -> `everyone=False`, targets = all other active kids;
     a rule left with no targets is deleted), then create `"School nights · {name}"` days `01236` from
     `07:00`, or `"Weekends · {name}"` days `45` from `08:00` (use the start of the rule they left if any).
     Function `bedtime_all(db, kids_targets)` for the fresh case: if no allowed school_night/weekend rules
     exist and every active kid gets the same bedtime, create one Everyone rule per category named
     "School nights" / "Weekends".
   - `lock`: `kid.chores_lock = v`. `trust`: like `patch_kid` (reset `trust_clean` when turning on).
   - `photo`: True -> `needs_photo=True` on the kid's starter chores. False -> False on those chores
     unless another kid on that chore has `photo` True in `plans`.
   - family `banked`: `fam.screen_rollover = v` (if turning off, call `screen_bank.clear_all(db)`).
4. `edited(key, now, base)`: `base` has the key -> `now != base[key]`; else `now != DEFAULT[key]`.
5. `plan(db, body) -> (scope, targets)` and `run(db, parent, body, write: bool) -> PresetResult`
   following the contract. Saved base JSON shape: `{"family": {...}, "kids": {"3": {...}}}` in
   `fam.preset_base`. Apply writes changed keys (not edited, not skipped, `now != next`), records `next`
   as base for every in-scope key (also skipped and kept ones), saves styles, commits, calls
   `app.lock.loop.trigger()`.
   Kid style save rule: a listed kid whose style equals the family style is stored as NULL.
6. Lock (`app/lock/state.py`): an owner with `chores_lock` False counts as `OwnerChores(0, 0)`. Test in
   `test_kid_chores_lock.py` (copy the setup of an existing lock test such as `tests/test_e2e_lock.py`).
7. Tests (one per bullet): fresh kid gets everything; edited screen is kept and listed in `kept`;
   skip records base but does not write; family switch changes `banked`; kid with own style keeps it on a
   family switch; two kids with different bedtimes get own rules and a later switch updates only the
   unedited kid; existing Everyone rule is split; chores add and remove; photo shared rule.

### Task 5 (backend): presets API
Files: new `backend/app/api/presets.py`, edit `backend/app/main.py`, new `backend/tests/test_presets_api.py`.
Depends on Task 4 (start by writing the API tests; code once `preset_state.py` lands).
1. Router `prefix="/api/v1/presets"`, `dependencies=[Depends(require_parent)]`.
2. `GET ""` -> catalog + saved style + kids. `POST /preview` and `POST /apply` with a pydantic body
   (`style: Literal[...] | None`, `kids: dict[int, Literal[...] | None] = {}`, `skip: list[Literal[
   "chores","screen","bedtime","lock","trust","photo","banked"]] = []`).
3. Tests: kid token gets 403; bad style 422; unknown kid 404; preview writes nothing; apply returns the
   contract shape and a second identical apply has no changes.

### Task 6 (frontend): wizard flow
Files: `frontend/src/v2/setup/WizardFrame.tsx`, `setupStep.ts`, new `StepStyle.tsx`, new `StepPlan.tsx`,
new `setupJobs.ts`, `StepHours.tsx`, `frontend/pages/setup.tsx`, tests `frontend/tests/v2/setup*.test.tsx`
(update, never delete), `frontend/e2e/screens.spec.ts`.
1. STEPS: Welcome, Family, Kids, How strict (`short: 'Style'`), Your plan (`short: 'Plan'`), Kids' phones
   (`short: 'Phones'`, opt), Devices. `LAST = 7`.
2. `StepStyle`: heading/sub from the wizard ("How strict should it be?" / "You can change anything
   later."), `StylePicker`; with 2+ kids a card "Different for each kid" with a switch; when on, each kid
   (avatar initial, "Ivy (8)" style name + age label is fine: use `AGE_LABEL`) gets a `StyleSeg`; then
   `LimitsTable`. Default Balanced. Plans come from `usePresets()` catalog `plans[kid.age_group][style]`.
3. `StepPlan`: "Here's your plan" / "Set for each kid's age and style." Per kid: avatar + "Ivy ·
   Balanced", card rows "Chores" (titles joined) and "Screen time" ("2h · bed 8:30"). Buttons: primary
   "Looks good" (the frame Next with `nextLabel="Looks good"`) and a ghost "Tweak" button below.
   No kids: one line "No kids yet. Your family settings follow Balanced." etc.
4. Looks good: POST `/presets/apply` with `{style, kids}` (kids map only when "Different" is on, else
   every kid null) as a job key `preset`, then go to step 6.
5. Tweak: sub-steps of step 5 (state `tweak: 'chores' | 'hours' | 'extras' | null`), frame stays on step
   5, titles from the old steps. Chores pre-filled with the union of kid plans; Hours drafts built from
   the plans (one school-night and one weekend draft per distinct bedtime; Everyone when all equal, else
   `everyone:false, kid_ids` and names "School nights · Ivy"); lock pre-filled on if any plan locks;
   Extras trust pre-filled with kids whose plan trusts. Back from Chores returns to the plan. Next on Extras
   runs the old jobs, then `/presets/apply` with `skip: ['chores','bedtime','trust']`, then step 6.
   Chore assignment in Tweak: a title in some kid's plan goes to those kids only; a title the parent added
   goes to every kid.
6. Move the chore/hours/extras job builders out of `setup.tsx` into `setupJobs.ts` so `setup.tsx` stays
   well under 500 lines.
7. `StepHours`: one bedtime input per draft rule (label "Bedtime on school nights" for Everyone, else the
   rule name, e.g. "School nights · Ivy"); editing a rule keeps its `everyone`/`kid_ids`.
8. Update tests to the new numbering: Skip rules, finish screen, resume, saved steps, Tweak path posts,
   Looks good posts `/presets/apply`. Add: style step shows three choices with Balanced picked; the
   per-kid switch shows only with 2+ kids; the limits table is collapsed. `screens.spec.ts` 'setup wizard'
   stays and still passes.

### Task 7 (frontend): switch later in Settings and on kid pages
Files: new `frontend/src/v2/presets/PresetSwitch.tsx`, `frontend/src/v2/manage/FamilyCards.tsx`,
`frontend/src/v2/manage/KidRows.tsx`, tests `frontend/tests/v2/presets/presetSwitch.test.tsx`.
1. `PresetSwitch({ kidId? })`: title "Family style" (family) or "Style" (kid), sub "Sets defaults for
   chores, hours and extras. Each kid page has its own style switch too." (family only). A `StyleSeg` with
   the saved style. Picking another style shows (no request until picked) the amber preview box (mockup
   `.prev`, tokens `--p-amb`/`--p-ambink`): "**Switching to Strict** Changes N settings. Keeps your M edits
   (Ivy's bedtime, 2 chores you added)." with `usePreview`, a `<details>` "See what changes" table (Now /
   Strict columns, rows "Screen time (Ivy)"), and a "Switch to Strict" button (`useApplyPreset`), toast
   "Switched to Strict". Zero changes: "Nothing to change." and the button still saves the style.
2. Family: a new `SummaryRow id="style"` first in `FamilyCard`, icon `tune`, line "Balanced".
3. Kid page: in `SettingsRow`, a "Style" section (`p-sec-h`) with `PresetSwitch kidId` and a switch row
   "Internet locks until chores are done" (PATCH `/kids/{id}` `{chores_lock}` via the existing kid patch
   hook). Keep it compact.
4. Tests: preview text from a mocked preview; Switch posts apply with `{style}` (family) or
   `{kids: {id: style}}` (kid); lock switch PATCHes.

## Wave C
### Task 8: verification sweep, polish, CI
Full backend + frontend suites, lint, type-check, `alembic heads`, e2e screens. Five polish passes:
screenshots (phone 390px + desktop 1280px, light + dark) of the style step, plan, tweak steps and the
Settings switch against the mockup; walk the wizard with 1 kid and with 2 kids. Bump version to 2.11.0
(see how 2.8.0 was bumped: `git log -S"2.8.0" --oneline`), changelog/docs entry if the repo keeps one.

### Task 9: Penalties and Goals toggles (only when the feat/goals PR is open)
Rebase onto `feat/goals`; point this branch's migration `down_revision` at the goals head; one head.
Add family keys `penalties` (relaxed off, balanced off, strict on) and `goals` (on for all) to
`FAMILY`, `DEFAULT`, readers and writers using the flags those branches add; extend the note in
`LimitsTable`. Tests for both keys.
