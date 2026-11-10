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
- Penalties and Goals toggles only apply when those features exist on the branch. Build them last, after
  rebasing onto `feat/goals` (which stacks on `feat/penalties`). If those aren't ready yet, ship without
  them and list them as a follow-up.

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
