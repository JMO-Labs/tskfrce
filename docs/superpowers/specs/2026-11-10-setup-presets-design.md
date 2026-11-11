# Setup presets (Project 5) — design

Date: 2026-11-10 · Branch: `feat/presets` (from `feat/declutter`, 2.8.0) · Version: next minor after Goals
Approved mockup: `.superpowers/mockups/presets-v2.html` (owner: "mostly good. keep it compact and
declutter but keep all the functionality").

## Intent
Parents finish setup in minutes. The app picks sensible defaults from **each kid's age plus a strictness
style**. Parents can see the limits if they want, switch later, and edit anything.

## Goals
- A new wizard question after Kids, **"How strict should it be?"**, with three choices: Relaxed, Balanced
  ("Most families"), Strict.
- A **"Your plan"** summary replaces walking through Chores, Hours and Extras. "Looks good" finishes and
  "Tweak" opens those existing steps, pre-filled.
- **Per-kid strictness** (owner): one family pick by default. With 2+ kids, a "Different for each kid"
  switch shows a style bar for each kid.
- **View the limits in setup if desired** (owner): a collapsed "See what this sets" table with one column
  per kid.
- **Switch later in Settings** (owner): a family style switch, plus a style switch on each kid's page.

## Non-goals
- Presets for anything besides chores, hours, screen time, checking, and extras on/off.
- Custom or saved presets made by parents.

## Anti-goals
- A clutter-heavy step. **Compact and decluttered, with all the functionality** (owner). The limits stay
  collapsed and the per-kid bars appear only behind the switch.
- **Overwriting a parent's edits** (owner). See "Switching" below.

## Decisions (owner's unless marked *my call* / *builder's call*)

### Wizard flow
Welcome → Family → Kids → **How strict** → **Your plan** → Kids' phones (optional) → Devices.
Chores, Hours and Optional extras stay as steps, reached through "Tweak" from Your plan. They still work
and are pre-filled from the preset. `setup/WizardFrame.tsx` STEPS and `setupStep.ts` are updated. Existing
families mid-setup must not break (*builder's call* on migrating the saved step number).

### Preset values (owner OK'd the table; ages shift them)
| | Relaxed | Balanced | Strict |
|---|---|---|---|
| Chores per day (Kid age) | 2 | 3 | 4 |
| Internet locks until chores done | off | on | on |
| Daily screen time (Kid age) | 3h | 2h | 1h |
| School-night bedtime (Kid age) | 9:00 | 8:30 | 8:00 |
| Parent checks every chore | no (trust mode on) | yes | yes + photo proof |
| Penalties | off | off | on |
| Goals | on | on | on |
| Banked screen time | on | on | off |

- Age mode shifts each preset. Little kids get fewer and simpler chores, less screen time and an earlier
  bedtime. Teens get more freedom and later hours. *Builder's call* for exact offsets. Keep them in one
  data file (e.g. `presets.ts` or backend `presets.py`) that a parent never sees.
- Chores come from the existing `starterChores.ts`, picked by age.
- **Per-kid vs family-wide** (*my call*). Per-kid fields follow the kid's style: chores, screen time,
  bedtime, the chores-before-internet lock, and checking/trust/photo proof. Family-wide fields follow the
  family pick: Penalties, Goals and banked time on/off.
- Penalties and Goals toggles are family keys (both now on this branch).

### Switching later
- Settings shows a Family style segmented switch. Each kid page has its own (compact, in the kid's
  settings area per declutter).
- **Only change what the parent never touched** (owner). Each preset-managed setting tracks whether a
  parent edited it (*builder's call* how: e.g. an `edited` flag, or comparing against the last applied
  preset value).
- **Preview before applying**: "Changes N settings. Keeps your M edits (…)", with an expandable "See what
  changes" table. A "Switch to X" button applies it.
- A kid on "Different" keeps their own pick when the family style changes (*my call*).

### Visibility
- The style step shows the three choices. The per-kid switch shows only with 2+ kids. "See what this
  sets" is collapsed by default.

## Constraints
- Approved parent tokens and the mockup layout. Phone first. Files under 500 lines.
- Turnkey rule: choosing nothing (Next on the default Balanced) gives a fully working setup.
- Server-side validation of preset application (parents only).

## Left to the builder
Age offsets, data model for edit tracking, API shapes, copy polish within the mockup, and tests.

## Builder's calls (2026-11-10)
- **Data file**: `backend/app/services/presets.py` holds the table, age offsets and per-age chore picks.
  The frontend reads it through `GET /api/v1/presets`. Starter metadata stays in `starterChores.ts`
  (glyphs) and is mirrored in `presets.py` (type, points, days). A backend test fails if they drift.
- **Age offsets**: Little: chores −1, screen −30m, bedtime −1h. Kid: as the table. Teen: chores ±0,
  screen +30m, bedtime +1h. Weekend bedtime is school-night bedtime +1h30.
- **Chore picks by age** (first N): Little: Make bed, Feed the pet, Tidy room, Water plants. Kid: Make bed,
  Feed the pet, Tidy room, Homework. Teen: Unload dishwasher, Take out trash, Homework, Tidy room,
  Practice instrument.
- **Per-kid internet lock**: new `users.chores_lock` (default on). The family switch stays the master
  switch; a device only waits for the chores of owners whose lock is on.
- **Photo proof** (Strict): the kid's starter chores need a photo. A starter shared by several kids needs
  one if any of them is Strict.
- **Per-kid bedtime** (lead decision 2026-11-10): hour rules. A fresh family gets Everyone rules at the
  most common bedtime (ties: the first kid's), so kids added later stay covered. A kid whose bedtime differs
  gets their own "School nights · Name" / "Weekends · Name" rule flagged `replaces_everyone`: for that kid
  it replaces the Everyone rule of the same day type. Everyone rules are never turned into lists. Other
  kid, group and Everyone rules still all apply together.
- **Skip** (lead decision): Skip on How strict or Your plan applies Balanced for everyone and goes on to
  Kids' phones, so doing nothing still gives a working setup.
- **Edit tracking**: `family_settings.preset_base` (JSON) stores the last applied value per key. A key is
  an edit when it differs from that value. A key with no stored value counts as an edit unless it still
  has the app default (no screen limit, trust off, no photo, lock on, no starter chores, no bedtime
  rule, banked on, penalties off). This keeps families that set things up before presets safe.
- **Styles**: `family_settings.preset_style`, `users.preset_style` (NULL = follows the family). On a kid
  page, picking the family's own style sets the kid back to following the family.
- **Tweak**: Your plan → Chores → Hours → Extras, pre-filled from the plan, then the preset applies with
  chores, bedtime and trust skipped (the parent's tweaks win). The three steps run as sub-steps of step 5.
- **Saved step**: a data migration moves saved steps 4–8 to 4 (How strict). Anything already made counts
  as an edit and is kept. `LAST_STEP` becomes 7.
- **API**: `GET /api/v1/presets` (catalog), `POST /api/v1/presets/preview` and `POST /api/v1/presets/apply`
  with `{style?, kids?: {id: style|null}, skip?: [keys]}`. Parents only. With `style`, family keys and all
  kids are in scope. Without it, only the listed kids are.
- **Goals and Penalties** (2026-11-10): Goals (2.10.0) merged into `feat/declutter`, so `goals` is a family
  key (`family_settings.goals_on`, on for every style; the Tweak Extras switch wins). Penalties (#92)
  merged too, so `penalties` is a family key (`family_settings.penalties_enabled`; Strict on, Relaxed and
  Balanced off). It has edit tracking like the others (`preset_base`), shows in the preview and the "See
  what this sets" note, and the Tweak Extras Penalties switch wins. No stored value counts as an
  edit unless penalties is still off (the app default).
