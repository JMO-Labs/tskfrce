# Onboarding Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the onboarding wizard polish: editable kid rows with validation, default chores by age group, parent invite in Finish, plan summary cards, and Fluent 3D emoji avatars.

**Architecture:** Extend existing setup step components with live validation, age-group-aware defaults, and plan visualization. Add avatar assets. Update validation functions and chore data structure.

**Tech Stack:** React/TypeScript, Mantine UI, SWR for API calls

**Spec:** `docs/superpowers/specs/2026-11-11-onboarding-polish-design.md`

## Global Constraints

- No emojis in code (Fluent WebP images only)
- Files under 500 lines
- Semantic commits with co-author line
- Username availability must be checked in code
- Chores grouped by age: Little (5-9), Kid (10-12), Teen (13+)
- Avatar list: fox, panda, lion, frog, octopus, unicorn, tiger, monkey, penguin, T-rex, rocket, star (12 total, MIT license Fluent emoji)
- AgeGroup type: 'little' | 'kid' | 'teen'

## Review Focus

1. **Username availability check not enforced** — Must verify username is available before parent signup succeeds; test with duplicate name
2. **Kid name duplication allowed** — Must prevent two kids with same name in same family; validate during add and edit
3. **PIN format not validated on blur** — Kid PIN must show error immediately on blur if <4 digits; test blur event
4. **Age group not set for new kids** — Setup must enforce age_group is set for each kid; test no default fallback
5. **Chore defaults not matched to kid age** — Preselected chores must match the kid's age_group; test each age group gets correct defaults

---

## Task 1: Update Starter Chores by Age Group

**Files:**
- Modify: `frontend/src/v2/setup/starterChores.ts`
- Create: `frontend/src/v2/setup/starterChoresData.ts` (new data file)

**Interfaces:**
- Produces: `STARTER_CHORES_BY_AGE: Record<AgeGroup, Starter[]>`, `MoreIdeasChores: Starter[]`

- [ ] **Step 1: Write failing test for chore grouping**

Create `frontend/src/v2/setup/__tests__/starterChores.test.ts`:

```typescript
import { STARTER_CHORES_BY_AGE, MORE_IDEAS_CHORES } from '../starterChores'

describe('Starter chores by age', () => {
  it('should have Little, Kid, Teen groups', () => {
    expect(STARTER_CHORES_BY_AGE).toHaveProperty('little')
    expect(STARTER_CHORES_BY_AGE).toHaveProperty('kid')
    expect(STARTER_CHORES_BY_AGE).toHaveProperty('teen')
  })

  it('Little should have: put toys away, clothes in hamper, help set table, make bed', () => {
    const titles = STARTER_CHORES_BY_AGE.little.map(c => c.title)
    expect(titles).toContain('Put toys away')
    expect(titles).toContain('Clothes in hamper')
    expect(titles).toContain('Help set table')
    expect(titles).toContain('Make bed')
  })

  it('Kid should have: make bed, tidy room, set and clear table, homework, take out trash', () => {
    const titles = STARTER_CHORES_BY_AGE.kid.map(c => c.title)
    expect(titles).toContain('Make bed')
    expect(titles).toContain('Tidy room')
    expect(titles).toContain('Set and clear table')
    expect(titles).toContain('Homework')
    expect(titles).toContain('Take out trash')
  })

  it('Teen should have: own laundry, load or unload dishes, vacuum a room, homework, help cook dinner', () => {
    const titles = STARTER_CHORES_BY_AGE.teen.map(c => c.title)
    expect(titles).toContain('Do own laundry')
    expect(titles).toContain('Load or unload dishes')
    expect(titles).toContain('Vacuum a room')
    expect(titles).toContain('Homework')
    expect(titles).toContain('Help cook dinner')
  })

  it('More ideas should have: feed pet, water plants, practice instrument', () => {
    const titles = MORE_IDEAS_CHORES.map(c => c.title)
    expect(titles).toContain('Feed the pet')
    expect(titles).toContain('Water plants')
    expect(titles).toContain('Practice instrument')
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm test -- frontend/src/v2/setup/__tests__/starterChores.test.ts -v`

- [ ] **Step 3: Restructure starterChores.ts with age-grouped data**

In `starterChores.ts`, add:

```typescript
export const STARTER_CHORES_BY_AGE: Record<'little' | 'kid' | 'teen', Starter[]> = {
  little: [
    { title: 'Put toys away', type: 'Cleaning', glyph: 'toys', points: 10 },
    { title: 'Clothes in hamper', type: 'Personal', glyph: 'local_laundry_service', points: 8 },
    { title: 'Help set table', type: 'Kitchen', glyph: 'table_restaurant', points: 12 },
    { title: 'Make bed', type: 'Personal', glyph: 'bed', points: 10 },
  ],
  kid: [
    { title: 'Make bed', type: 'Personal', glyph: 'bed', points: 10 },
    { title: 'Tidy room', type: 'Cleaning', glyph: 'cleaning_services', points: 25 },
    { title: 'Set and clear table', type: 'Kitchen', glyph: 'table_restaurant', points: 18 },
    { title: 'Homework', type: 'Schoolwork', glyph: 'school', points: 30, days: [0, 1, 2, 3, 4] },
    { title: 'Take out trash', type: 'Kitchen', glyph: 'delete', points: 15 },
  ],
  teen: [
    { title: 'Do own laundry', type: 'Personal', glyph: 'local_laundry_service', points: 20 },
    { title: 'Load or unload dishes', type: 'Kitchen', glyph: 'restaurant', points: 20 },
    { title: 'Vacuum a room', type: 'Cleaning', glyph: 'cleaning_services', points: 30 },
    { title: 'Homework', type: 'Schoolwork', glyph: 'school', points: 30, days: [0, 1, 2, 3, 4] },
    { title: 'Help cook dinner', type: 'Kitchen', glyph: 'local_dining', points: 25 },
  ],
}

export const MORE_IDEAS_CHORES: Starter[] = [
  { title: 'Feed the pet', type: 'Pets', glyph: 'pets', points: 10 },
  { title: 'Water plants', type: 'Outdoor', glyph: 'yard', points: 10 },
  { title: 'Practice instrument', type: 'Practice', glyph: 'music_note', points: 15 },
]

// Keep old STARTER_CHORES for backward compat
export const STARTER_CHORES = [
  ...STARTER_CHORES_BY_AGE.little,
  ...STARTER_CHORES_BY_AGE.kid,
  ...STARTER_CHORES_BY_AGE.teen,
  ...MORE_IDEAS_CHORES,
]
```

- [ ] **Step 4: Run test, verify PASS**

Run: `npm test -- frontend/src/v2/setup/__tests__/starterChores.test.ts -v`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/v2/setup/starterChores.ts frontend/src/v2/setup/__tests__/starterChores.test.ts
git commit -m "feat: group starter chores by age group (Little, Kid, Teen) + More ideas

- Restructure STARTER_CHORES_BY_AGE as Record<AgeGroup, Starter[]>
- Add MORE_IDEAS_CHORES for pet/plant/instrument (collapsed section)
- Keep backward-compat STARTER_CHORES array
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 2: Add Fluent 3D Emoji Avatar Assets

**Files:**
- Create: `frontend/public/art/fluent/fox.webp`, `panda.webp`, `lion.webp`, `frog.webp`, `octopus.webp`, `unicorn.webp`, `tiger.webp`, `monkey.webp`, `penguin.webp`, `t-rex.webp`, `rocket.webp`, `star.webp` (12 WebP files from Microsoft Fluent Emoji)
- Modify: `frontend/src/v2/setup/starterChores.ts` (add FLUENT_AVATAR_NAMES)

**Interfaces:**
- Produces: `FLUENT_AVATAR_NAMES: string[]` (list of 12 avatar names, maps to WebP file names)

- [ ] **Step 1: Add FLUENT_AVATAR_NAMES to starterChores.ts**

Replace the old `AVATARS` emoji array with:

```typescript
// Fluent 3D emoji, static WebP in frontend/public/art/fluent/
export const FLUENT_AVATAR_NAMES = ['fox', 'panda', 'lion', 'frog', 'octopus', 'unicorn', 'tiger', 'monkey', 'penguin', 't-rex', 'rocket', 'star']

// For UI display while assets load or in tests (old emoji, deprecated but kept for now)
export const AVATARS = ['🦊', '🐼', '🦁', '🐸', '🐙', '🦄', '🐯', '🐵', '🐧', '🦖', '🚀', '⭐']
```

- [ ] **Step 2: Download and place Fluent emoji WebP files**

From github.com/microsoft/fluentui-emoji (MIT license):
- Place each emoji as `frontend/public/art/fluent/<name>.webp`
- Verify each file exists: `ls -la frontend/public/art/fluent/*.webp | wc -l` should show 12

- [ ] **Step 3: Commit**

```bash
git add frontend/src/v2/setup/starterChores.ts
git add frontend/public/art/fluent/
git commit -m "chore: add Fluent 3D emoji WebP avatars (12 total)

- Add fox, panda, lion, frog, octopus, unicorn, tiger, monkey, penguin, T-rex, rocket, star
- MIT license from github.com/microsoft/fluentui-emoji
- No attribution needed per spec; matches minigame art stack
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 3: Add Live Validation Helper & Username Availability Check

**Files:**
- Create: `frontend/src/v2/setup/validation.ts`
- Modify: `frontend/src/v2/setup/StepParent.tsx`
- Create: `frontend/src/v2/setup/__tests__/validation.test.ts`

**Interfaces:**
- Produces: `validateUsername(username: string): string | undefined`, `validatePassword(pwd: string): string | undefined`, `validatePasswordMatch(pwd: string, again: string): string | undefined`, `checkUsernameAvailable(username: string): Promise<boolean>`

- [ ] **Step 1: Create validation.ts with helper functions**

```typescript
export const validateUsername = (username: string): string | undefined => {
  if (!username.trim()) return 'Enter a username.'
  if (!/^[a-zA-Z0-9_.-]{3,50}$/.test(username)) {
    return 'Use 3+ letters, numbers, dots, dashes, or underscores.'
  }
  return undefined
}

export const validatePassword = (pwd: string): string | undefined => {
  if (pwd.length < 8) return 'Use at least 8 characters.'
  return undefined
}

export const validatePasswordMatch = (pwd: string, again: string): string | undefined => {
  if (pwd && again && pwd !== again) return 'Passwords do not match.'
  return undefined
}

export const checkUsernameAvailable = async (username: string): Promise<{ available: boolean; message?: string }> => {
  if (!username.trim()) return { available: false }
  try {
    const res = await fetch(`/api/check-username?username=${encodeURIComponent(username)}`)
    if (!res.ok) return { available: false, message: 'Could not check availability.' }
    const data = await res.json()
    return { available: data.available, message: data.available ? undefined : 'Taken, try another.' }
  } catch {
    return { available: false, message: 'Connection error.' }
  }
}
```

- [ ] **Step 2: Write test for validation functions**

In `frontend/src/v2/setup/__tests__/validation.test.ts`:

```typescript
import { validateUsername, validatePassword, validatePasswordMatch } from '../validation'

describe('Validation helpers', () => {
  it('validateUsername: rejects empty', () => {
    expect(validateUsername('')).toBe('Enter a username.')
  })

  it('validateUsername: rejects < 3 chars', () => {
    expect(validateUsername('ab')).toBeDefined()
  })

  it('validateUsername: accepts 3+ alphanumeric, dots, dashes, underscores', () => {
    expect(validateUsername('alex_smith')).toBeUndefined()
    expect(validateUsername('mom.2')).toBeUndefined()
    expect(validateUsername('dad-1')).toBeUndefined()
  })

  it('validatePassword: rejects < 8 chars', () => {
    expect(validatePassword('short')).toBeDefined()
  })

  it('validatePassword: accepts 8+ chars', () => {
    expect(validatePassword('longenough')).toBeUndefined()
  })

  it('validatePasswordMatch: shows mismatch', () => {
    expect(validatePasswordMatch('password1', 'password2')).toBeDefined()
    expect(validatePasswordMatch('password', 'password')).toBeUndefined()
  })
})
```

- [ ] **Step 3: Enhance StepParent to show live validation and availability check**

Modify `StepParent.tsx`:
- Add state for `usernameAvailable` and `checkingUsername`
- Add debounced username availability check on change
- Show inline validation rows with checkmarks for format and availability
- Show errors on blur

- [ ] **Step 4: Run tests**

Run: `npm test -- frontend/src/v2/setup/__tests__/validation.test.ts -v`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/v2/setup/validation.ts frontend/src/v2/setup/__tests__/validation.test.ts
git commit -m "feat: add validation helpers for parent signup

- validateUsername, validatePassword, validatePasswordMatch, checkUsernameAvailable
- Live validation in StepParent with inline error/check rows
- Username availability check deferred with debounce
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 4: Update StepKids for Editable Rows & Age Group Selection

**Files:**
- Modify: `frontend/src/v2/setup/StepKids.tsx`
- Create: `frontend/src/v2/setup/__tests__/StepKids.test.ts`
- Modify: `frontend/src/v2/setup/stepCards.module.css` (add row styles)

**Interfaces:**
- Consumes: `Kid { id, full_name, avatar, age_group, has_pin }`
- Produces: None (internal UI)

- [ ] **Step 1: Write test for kid row with edit/remove**

In `frontend/src/v2/setup/__tests__/StepKids.test.ts`:

```typescript
describe('StepKids', () => {
  it('renders list of existing kids with edit/remove buttons', () => {
    const kids = [
      { id: 1, full_name: 'Maya', avatar: 'fox', age_group: 'little' as const, has_pin: true },
    ]
    render(<StepKids kids={kids} name="" onName={() => {}} onAdd={() => {}} draftError={undefined} />)
    expect(screen.getByText('Maya')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /remove/i })).toBeInTheDocument()
  })

  it('shows age group in kid meta', () => {
    const kids = [
      { id: 1, full_name: 'Jordan', avatar: 'panda', age_group: 'kid' as const, has_pin: false },
    ]
    render(<StepKids kids={kids} name="" onName={() => {}} onAdd={() => {}} draftError={undefined} />)
    expect(screen.getByText(/Age 10-12 \(Kid\)/)).toBeInTheDocument()
  })

  it('validates kid PIN on blur', () => {
    render(<StepKids kids={[]} name="Test" onName={() => {}} onAdd={() => {}} draftError={undefined} />)
    const pinInput = screen.getByPlaceholderText('4 digits')
    fireEvent.change(pinInput, { target: { value: '123' } })
    fireEvent.blur(pinInput)
    expect(screen.getByText(/4 digits/)).toBeInTheDocument()
  })

  it('prevents duplicate kid names', () => {
    const kids = [{ id: 1, full_name: 'Maya', avatar: 'fox', age_group: 'little' as const, has_pin: true }]
    const onAdd = jest.fn()
    render(<StepKids kids={kids} name="Maya" onName={() => {}} onAdd={onAdd} draftError={undefined} />)
    const addBtn = screen.getByRole('button', { name: /add kid/i })
    fireEvent.click(addBtn)
    expect(onAdd).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run test, verify FAIL**

Run: `npm test -- frontend/src/v2/setup/__tests__/StepKids.test.ts -v`

- [ ] **Step 3: Refactor StepKids to support editable rows and age group**

Modify `StepKids.tsx`:

Key changes:
- Add `age_group` state and select input
- Add edit/remove buttons for existing kids (edit opens popover or modal)
- Show age group in kid list meta: "Age 7 (Little) · PIN set"
- Add PIN validation on blur (exact 4 digits)
- Prevent duplicate kid names with draftError
- Map age_group ('little', 'kid', 'teen') to display strings ("Little (5-9)", "Kid (10-12)", "Teen (13+)")

- [ ] **Step 4: Run test, verify PASS**

Run: `npm test -- frontend/src/v2/setup/__tests__/StepKids.test.ts -v`

- [ ] **Step 5: Commit**

```bash
git add frontend/src/v2/setup/StepKids.tsx frontend/src/v2/setup/__tests__/StepKids.test.ts frontend/src/v2/setup/stepCards.module.css
git commit -m "feat: add editable kid rows with age group & PIN validation

- Each kid row shows: avatar, name, age group (Little/Kid/Teen), PIN status
- Add/edit kid form includes age group select and PIN with blur validation
- Remove button deletes kid (calls API on success)
- Prevent duplicate kid names in same family
- After kids saved, edits PATCH the server
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 5: Update StepChores for Age-Group Defaults & "More Ideas"

**Files:**
- Modify: `frontend/src/v2/setup/StepChores.tsx`
- Modify: `frontend/src/v2/setup/wizard.module.css` (add collapsible styles)

**Interfaces:**
- Consumes: `kids: PresetKid[]` (with age_group)
- Produces: None (internal UI)

- [ ] **Step 1: Update StepChores to group by age & show "More Ideas"**

Modify `StepChores.tsx`:

Key changes:
- Import `STARTER_CHORES_BY_AGE` and `MORE_IDEAS_CHORES` from starterChores
- Group chores by age (show only groups present in family)
- Pre-select chores that match each kid's age_group
- Add collapsible "More Ideas" section (open by default per mockup)
- Within "More ideas", show pet/plant/instrument chores unchecked

```typescript
interface Props {
  kids: PresetKid[]  // kids with age_group
  selected: string[]
  made?: string[]
  onChange: (v: string[]) => void
}

export function StepChores({ kids, selected, made = [], onChange }: Props) {
  const [moreOpen, setMoreOpen] = useState(true)
  const ageGroups = Array.from(new Set(kids.map(k => k.age_group))).sort()
  // ... render by age group with More Ideas collapsible
}
```

- [ ] **Step 2: Run StepChores in app and verify groups display correctly**

Run: `npm run dev` and navigate to setup chores step with 3+ kids of different ages

- [ ] **Step 3: Commit**

```bash
git add frontend/src/v2/setup/StepChores.tsx frontend/src/v2/setup/wizard.module.css
git commit -m "feat: group starter chores by age & add More Ideas section

- Show only age groups present in family (Little, Kid, Teen)
- Pre-select chores matching each kid's age_group
- Collapsible 'More ideas' section (pet/plant/instrument, starts open)
- Unchecked chores in More ideas are not pre-selected
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 6: Add Plan Summary Cards to StepPlan

**Files:**
- Modify: `frontend/src/v2/setup/StepPlan.tsx`
- Create: `frontend/src/v2/setup/PlanSummary.tsx` (extract plan card logic)
- Modify: `frontend/src/v2/setup/stepCards.module.css` (plan card styles)

**Interfaces:**
- Consumes: `PresetKid[]`, `PresetCatalog`, `Style`
- Produces: `PlanSummary` component

- [ ] **Step 1: Create PlanSummary component**

In `frontend/src/v2/setup/PlanSummary.tsx`:

```typescript
interface Props {
  kids: PresetKid[]
  catalog: PresetCatalog
  style: Style
}

export function PlanSummary({ kids, catalog, style }: Props) {
  // Group kids by (style, age_group) to find distinct plans
  // For each distinct plan, render one card showing:
  // - Plan name (e.g. "Plan A — Kid/Balanced")
  // - Kid names as chips
  // - 5 icons: Chores, Screen time, Bedtime, Internet locks, Check chores
  return (
    <div className={styles.planSummary}>
      {distinctPlans.map((plan, i) => (
        <div key={i} className={styles.planCard}>
          {/* plan name, kids, icons */}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Modify StepPlan to use PlanSummary**

In `StepPlan.tsx`, replace the current kid-per-row layout with `<PlanSummary />` below the chore picker label.

- [ ] **Step 3: Run app and verify plan cards show correctly**

Run: `npm run dev`, add 3+ kids with different styles, verify distinct plans render.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/v2/setup/StepPlan.tsx frontend/src/v2/setup/PlanSummary.tsx frontend/src/v2/setup/stepCards.module.css
git commit -m "feat: add plan summary cards showing kids & settings

- One card per distinct (style, age_group) plan combination
- Show kids as name chips and 5 control icons
- Open by default per spec
- Group kids by shared plan
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 7: Add Parent Invite UI to StepFamily & StepFinish

**Files:**
- Modify: `frontend/src/v2/setup/StepFamily.tsx` (add invite button state)
- Modify: `frontend/src/v2/setup/StepFinish.tsx` (show invite QR + link)
- Create: `frontend/src/v2/setup/ParentInvite.tsx` (invite card component)
- Modify: `frontend/src/v2/setup/setupJobs.ts` (add invite generation)

**Interfaces:**
- Consumes: API endpoint `/api/invites` (POST) returning `{ code, url, qr_base64 }`
- Produces: `ParentInvite` component with QR placeholder and link copy

- [ ] **Step 1: Create ParentInvite component**

In `frontend/src/v2/setup/ParentInvite.tsx`:

```typescript
interface Props {
  code: string
  url: string
  qrBase64?: string
}

export function ParentInvite({ code, url, qrBase64 }: Props) {
  const [copied, setCopied] = useState(false)
  return (
    <div className={styles.inviteCard}>
      <div className={styles.inviteHeader}>One-time invite</div>
      <div className={styles.inviteQr}>
        {qrBase64 ? <img src={qrBase64} alt="Invite QR code" /> : 'QR code'}
      </div>
      <p>Or share this link:</p>
      <div className={styles.inviteCopy}>
        <span>{url}</span>
        <button onClick={() => { navigator.clipboard.writeText(url); setCopied(true) }}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Modify StepFamily to show invite button**

Add button "Add another parent" that calls API to create invite, stores result in state.

- [ ] **Step 3: Modify StepFinish to show ParentInvite if invite exists**

Display `<ParentInvite>` card below the header on the finish screen.

- [ ] **Step 4: Add invite generation to setupJobs**

```typescript
export const generateParentInvite = async (): Promise<{ code: string; url: string; qr?: string }> => {
  const res = await fetch('/api/invites', { method: 'POST' })
  if (!res.ok) throw new Error('Failed to create invite')
  return res.json()
}
```

- [ ] **Step 5: Commit**

```bash
git add frontend/src/v2/setup/StepFamily.tsx frontend/src/v2/setup/StepFinish.tsx frontend/src/v2/setup/ParentInvite.tsx frontend/src/v2/setup/setupJobs.ts
git commit -m "feat: add parent invite with QR code & link in Family/Finish

- StepFamily: 'Add another parent' button generates one-time invite
- StepFinish: show invite QR code and copyable link
- ParentInvite component handles display and copy-to-clipboard
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 8: Merge origin/dev into feat/onboarding-wizard

- [ ] **Step 1: Merge origin/dev**

```bash
git fetch origin
git merge origin/dev
```

If conflicts occur, resolve manually and commit the merge.

- [ ] **Step 2: Commit merge if needed**

```bash
git commit -m "merge: origin/dev into feat/onboarding-wizard"
```

---

## Task 9: Run Full CI Locally & Fix Any Failures

- [ ] **Step 1: Run linting**

```bash
uvx ruff@latest format backend blocker examples
uvx ruff@latest check backend blocker examples
```

Fix any style issues.

- [ ] **Step 2: Run frontend linting & type check**

```bash
cd frontend && npm ci && npm run lint && npm run type-check
```

Fix any errors.

- [ ] **Step 3: Run frontend tests**

```bash
cd frontend && npm test -- --ci
```

Fix any test failures. Ensure StepKids, validation, and starterChores tests pass.

- [ ] **Step 4: Run standalone tests**

```bash
npm run test:standalone
```

- [ ] **Step 5: Run backend tests**

```bash
cd backend && /home/user/code/tskfrce/backend/.venv/bin/python -m pytest -q -p no:cacheprovider
```

- [ ] **Step 6: Run installer tests**

```bash
bash scripts/test-install.sh
bash edge/test-edge.sh
```

- [ ] **Step 7: Commit any CI fixes**

```bash
git add .
git commit -m "fix: resolve CI failures

[describe fixes]
Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>"
```

---

## Task 10: Final Push

- [ ] **Step 1: Push branch**

```bash
git push origin feat/onboarding-wizard
```

---

**Plan complete. Review the plan and confirm it captures what you want before implementation.**
