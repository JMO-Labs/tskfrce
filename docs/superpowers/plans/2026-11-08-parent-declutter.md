# Parent Declutter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every busy parent screen open calm (header + summary rows) and focus one area at a time, with focus in the URL, without removing any feature. Ships as 2.8.0.

**Architecture:** One hook (`useFocusParam`) owns "which section is open" as a shallow-routed query param: history entries, Esc, scroll restore and focus return. A small set of shared widgets (`SummaryRow`/`FocusArea`, `InfoPop`, `MoreMenu`, `DetailHeader`, `ActionRow`, `SaveBar`, `KidPicker`, `ProgressRing`, `KidStrip`) is built first. Then each screen is rebuilt on them, in spec order. Old links are rewritten by a pure `aliasQuery` function plus `router.replace`. Backend unchanged.

**Tech Stack:** Next.js pages router, React 19, Mantine 9 (Popover, Menu, Switch, Modal), TanStack Query 5, Jest + Testing Library, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-08-parent-declutter-design.md`. The section "Decisions after the builder check" overrides the v2 mockup. Mockups (binding look): `.superpowers/mockups/declutter-v1.html` and `declutter-v2.html`. Open a state with `?s=<preset>&t=light|dark&w=phone|desktop`.

## Pre-flight rulings

Pre-flight findings (`.superpowers/sdd/2026-11-08-parent-declutter/preflight.md`) are folded into the tasks below. One line each:

- F1: Esc depth comes from `clears`: a hook ignores Esc while another open hook's param is in its `clears` (T1).
- F2: Default scroller is `document.scrollingElement ?? document.documentElement` (T1).
- F3: `valid: undefined` means "don't validate yet"; callers pass `valid: data ? fn : undefined` (T1, T4, T5, T14).
- F4: `openTo(id, { replace?, extra? })`; T7 Edit, T8 new-chore Basics and T9 unassigned Details use it (T1, T7, T8, T9).
- F5: `/kids` `kid=K` + hash `#trust` aliases to `open: 'trust'` (T1, T7).
- F6: T4 moves the older-day case into `needsYouList.test.tsx` and deletes `kidListNeeds.test.tsx` with `KidList.tsx`; T6 no longer touches them.
- F7: `KidFacts` drops Points and adds Last active (T4).
- F8: `Earned today` stays in the kid pop-over; the dangling "report's ruling" note is gone (T4).
- F9: Start Happy Hour lives only in the Today header "…" (spec); no Happy Hour button in kid focus (T4, T5).
- F10: `happyHour.test.tsx`: T4 updates the Today assertion; T7 asserts KidDetail has no `HappyHourButton`.
- F11: `SummaryRow` renders `line2` as a sibling after the head button, never inside it (T2).
- F12: `line2` is not rendered while another row in the area is open; CSS only does layout (T2).
- F13: Region `aria-labelledby` points at the title `<b id>`; T8 e2e uses `Who & when`; T9 updates `devices-hours.spec.ts:84-86`.
- F14: ChoreRow's Approve and "…" are siblings of `.pt-row`, not inside it (T5).
- F15: ChoreRow takes `waiting?: NeedsItem`; `reply(i: NeedsItem)` uses `i.kid_id` (T5).
- F16: `useNeedsActions` gains `decline(i)`; Decline (red) stays in the row "…" for screen-time and reward requests (T5, T6).
- F17: Integration items get icon help `From an integration: <name> checked it off` (T6).
- F18: The older-day chip stays (T6).
- F19: Null `kid_id` groups last as `A kid`; null `submitted_at` sorts last (T6).
- F20: Bell count comes from `useInbox` (approve already invalidates `inbox`); wording only (T6).
- F21: T7 test list: drop `kid.test`/`kidTrust.test` (kid app); add `kidPushPane.test`, `polish.test`, `happyHour.test`.
- F22: `useDiscardGuard` also guards browser Back through `router.beforePopState` (T3; used by T7, T8, T14).
- F23: The new chore header line is `choreHeadLine`; existing `choreLine` is untouched (T8).
- F24: `ChoreDetail` gets `onGuard?(g: ((go: () => void) => void) | null)`; KidsPage keeps it in a ref and wraps `pick` (T8).
- F25: Discard deletes `drafts[key]` (T8).
- F26: `choreMeta.ts` uses `import type { Step }` (T8).
- F27: KidPicker pills render `role="group" aria-label={label}`; default `variant='pills'` (T3).
- F28: T9 migrates `RuleEditor.tsx` to KidPicker before deleting `KidPills.tsx`.
- F29: `settingsVisibility.test.tsx` is in the T9, T11 and T12 test lists; `manage.test.tsx` in T9.
- F30: `segmentedTabs.test.tsx` is dropped from T9.
- F31: Device chip keeps three states (Open / Locked / Got around the lock); an unassigned device shows `No owner yet` in the Details summary, and Details opens by default (T9).
- F32: T10 finds the `manage.test.tsx` group cases with grep, not line numbers.
- F33: The Quiet hours row stays hidden when there are no places (T11).
- F34: The place body component is `PlaceDetail` (T11).
- F35: The `.p-kn` CSS test lives in T2; T12 asserts the kid name element has class `p-kn`.
- F36: `ScreenLimits`/`LimitForm` are deleted; `ScreenLimits.tsx` keeps only `MaxOptions` and `limitText` (T12).
- F37: T13 lists and stages `scripts/shots/declutter/shoot.mjs` (its `step=` arg).
- F38: The compact step bar renders through `useMediaQuery` (T13).
- F39: T14 modifies `KidsPage.tsx`; custom badges drop the `pick`/`onPick` props.
- F40: The inbox "Needs you · 0" was mock data (wrong kinds), fixed in the mock (`302176e0`). No inbox fix; T18 and T23 must not claim one.
- F41: T17's new tests go in `setupKids.test.tsx` (setup.test.tsx is at 460 lines).
- F42: `today-hero.jpg` is shot at 1280×800 (`DESKTOP_H=800`, T1 + T22).
- F43: SHOTS.md lines use the real date (T22).
- F44: T16 commits the spec edit that records owner approval (`docs(spec): record v3 approval`).
- F45: The Needs strip button has `aria-expanded`/`aria-controls` (T4); T21 checks every `[aria-expanded]`.
- F46: `ActionRow` for device alerts (T9) and the self-approved list (T7); `DetailHeader` for the custom badge editor (T14).
- F47: Shot tooling is already committed in `scripts/shots/declutter/` (`302176e0`); T1 only edits it.
- F48: `trustParent.test.tsx` is in the T5 test list.
- F49: T15 tab-bar test starts from `/kids?…&open=trust` and asserts no `open` after tapping the tab.
- F50: KidStrip has no `Add` button (mockup); T5 renames the kidStrip test.
- F51: Busy buttons set both `aria-busy` and `data-loading` (T3).

## Global Constraints

- Work in `/home/user/code/tskfrce-declutter` on branch `feat/declutter`. Before the first task, run `cd frontend && npm ci` (this worktree has no `node_modules`).
- Files stay under 500 lines. If an edit would push a file past 500, split it in the same task.
- Commits are semantic (`feat(scope):`, `fix(scope):`, `test(scope):`, `docs(scope):`, `chore(release):`). Every commit ends with these two lines as a second `-m`:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
  `Claude-Session: https://claude.ai/code/session_011K7jrVbDK9XkJbLGVTb23M`
- Never `git add` `frontend/AGENTS.md`. Stage files by name, never `git add -A`.
- Dev server only on 127.0.0.1: `cd frontend && npx next dev --hostname 127.0.0.1 --port 3295`.
- CI gate before each commit of a UI task: in `frontend/`, run `npx jest`, `npm run lint`, `npm run type-check`. Run `npm run test:standalone` in Tasks 4, 7 and 23. Every task leaves CI green at its own commit: a task that deletes or renames a module also updates or moves every importer and test of it in the same commit (check with `grep -rn <name> frontend/src frontend/tests frontend/pages frontend/e2e`). Backend (Task 23 only): `cd backend && python -m pytest tests -q`, `ruff check backend blocker examples`, `ruff format --check backend blocker examples` (run from the repo root).
- No backend or API change. No new colours or fonts: use only the `--p-*` tokens in `parent-tokens.css`.
- Every new `p-*` class must be defined in a stylesheet imported by `pages/_app.tsx` (`tests/v2/cssCoverage.test.ts` enforces this). New widget CSS goes in `src/v2/parent/declutter.css`, imported in `_app.tsx` right after `interactions.css`. Screen CSS goes in that screen's existing CSS file. If that file would pass 500 lines, create `<screen>-focus.css` and import it.
- Accessibility: every expander is a `<button aria-expanded aria-controls>`. Focus moves into an opened section and returns to its opener on close. Touch targets are at least 44 px under `@media (max-width: 767px)`. Motion is 180 ms, and 0 ms under `prefers-reduced-motion: reduce`.
- Saving: single switches, chips and pickers save on change and toast `Saved` (`toastOk('Saved')`). Multi-field forms (chore, kid profile, badge) use `SaveBar`. A pair of fields that depend on each other saves only when both are complete and valid; until then it shows an inline `.pk-hint` and sends nothing.
- Each header has one main action plus a "…" `MoreMenu`. Delete lives only in "…" and keeps its existing `ConfirmDelete`.
- Tests that assert old layouts get updated in the same task. A test is never deleted without a replacement that covers the same behaviour.
- **Screenshot step (SS)**, the last step of every UI task:
  1. Start the dev server (above) in the background.
  2. For each listed state, run `node scripts/shots/declutter/shoot.mjs frontend/e2e-artifacts/declutter <name> '<app path>' <mockup file> <preset>`. This writes `<name>-{phone,desktop}-{light,dark}.png` (phone 390×844 @2x with touch, desktop 1280×900 @1x) and the same four as `<name>-mock-*.png` from the mockup.
  3. Read each app/mock pair. List every drift: layout, number of items, wording, colours, a missing chip. Fix it, re-shoot, and repeat until the only differences are mock data and the desktop list column that the spec keeps. Put the list of remaining differences in the task report. PNGs are not committed (`frontend/e2e-artifacts/` is gitignored).

## Review Focus

1. **Esc while a pop-over or menu is open** must close only the pop-over, not the focused section behind it. Tests: Task 1 `ignores Esc while a popover or menu dropdown is open`, Task 2 `Esc closes the pop-over and returns focus to its button`.
2. **Unknown or stale focus values** (`?kid=999`, `?open=bogus`, a deleted device) must land on the calm state through `router.replace`, with no history entry and no blank pane. Tests: Task 1 `drops an invalid value with replace`, Task 5 `unknown kid id falls back to calm`, Task 9 `unknown open value shows calm`.
3. **Switching sections, then Back.** Opening A, then B, then pressing Back must return to calm, not to A. A redirect from an old link must not add a history entry or loop. Tests: Task 1 `switching sections replaces, so one Back returns to calm`, Task 1 `alias rewrite uses replace`.
4. **Data refresh while focused.** A poll or approval removes the item in focus (the last waiting item, a deleted kid). The screen must not jump or blank, and counts must update everywhere. Tests: Task 6 `approving the last item shows All caught up and the calm strip goes away`, Task 5 `focused kid survives a refetch with fewer chores`.
5. **Long names and narrow screens.** "Ava" must never wrap as "Av / a". Long names truncate with an ellipsis. Pop-overs stay inside 390 px. Tests: Task 2 `kid names never break mid-word` (CSS assertion), Task 12 `screen time kid names use p-kn`, Task 2 `InfoPop dropdown is width-capped at 100vw - 32px`.

---

### Task 1: `useFocusParam`, old-link aliases, router test helper, shot tooling

**Files:**
- Create: `frontend/src/v2/parent/useFocusParam.ts`
- Create: `frontend/src/v2/parent/focusAliases.ts`
- Create: `frontend/tests/v2/helpers/fakeRouter.ts`
- Create: `frontend/tests/v2/focusParam.test.tsx`
- Create: `frontend/tests/v2/focusAliases.test.ts`
- Already committed (`302176e0`), do not recreate: `scripts/shots/declutter/mock.mjs` (busy-family mock API, `export { route, S }`; leave unchanged) and `scripts/shots/declutter/shoot.mjs` (the old audit script; Step 5 edits it in place)
- Modify: `scripts/shots/declutter/shoot.mjs`

**Interfaces:**
- Produces (`useFocusParam.ts`):
  ```ts
  export type Query = Record<string, string | string[] | undefined>
  export interface FocusOptions {
    /** same-level params: removed when this one opens; if one was set, the open uses replace (no new history entry) */
    group?: string[]
    /** deeper params (e.g. 'chore', 'edit', 'pin'): removed when this one opens another id or closes */
    clears?: string[]
    /** values that may be open; any other value is removed with router.replace. undefined = not checked yet (data still loading) */
    valid?: (id: string) => boolean
    /** element that scrolls; default document.scrollingElement ?? document.documentElement */
    scroller?: () => HTMLElement | null
  }
  export interface OpenOpts {
    /** use router.replace even when nothing was open (open-on-mount defaults) */
    replace?: boolean
    /** extra params set in the same navigation, e.g. { edit: '1' } */
    extra?: Query
  }
  export interface Focus {
    param: string
    open: string | null
    isOpen(id: string): boolean
    openTo(id: string, opts?: OpenOpts): void
    toggle(id: string): void
    close(): void
  }
  export function useFocusParam(param: string, opts?: FocusOptions): Focus
  ```
- Produces (`focusAliases.ts`):
  ```ts
  export function aliasQuery(pathname: string, query: Query, hash: string, kidOfRun?: (runId: number) => number | undefined): Query | null
  export function useFocusAliases(kidOfRun?: (runId: number) => number | undefined): void
  ```
- Produces (`tests/v2/helpers/fakeRouter.ts`):
  ```ts
  export const fakeRouter: { pathname: string; asPath: string; query: Query; stack: Query[]; push: jest.Mock; replace: jest.Mock; back: jest.Mock; reset(pathname: string, query?: Query): void }
  export function useFakeRouter(): typeof fakeRouter
  // usage in a test: jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
  ```
  `push({ pathname, query })` appends to `stack`. `replace` overwrites the top. `back()` pops. Each one sets `query`, bumps a version and notifies subscribers. `useFakeRouter` uses `useSyncExternalStore`, so components re-render. `asPath` is rebuilt from pathname + query.
- Produces: `scripts/shots/declutter/shoot.mjs <outDir> <name> <appPath> [<mockupFile> <preset>]`. Later tasks' SS steps call it. Env `DESKTOP_H` (default 900) sets the desktop viewport height (T22 uses 800 for the site hero).

Behaviour that `useFocusParam` must have (the tests pin each line):
- `open` is the param's current string value, or null.
- `openTo(id, opts)`: if `id` is already open and `opts.extra` adds nothing new, do nothing. If `opts.replace`, or this param or a `group` param is already set, call `router.replace`. Otherwise call `router.push`. Both calls use `{ pathname, query }`, `undefined`, `{ shallow: true, scroll: false }`. The query drops the `group` and `clears` keys, then sets the param and every `opts.extra` key, so one navigation sets several params (T7 Edit = `rows.openTo('settings', { extra: { edit: '1' } })`).
- `close()`: if this hook pushed the current entry, call `router.back()`. Otherwise call `router.replace` without the param and without the `clears` keys. Reset the "pushed" mark whenever `open` turns null from outside the hook (the browser Back button).
- On a change from null to an id: save `scroller.scrollTop`, and remember `document.activeElement` as the opener. On a change from an id to null: in `requestAnimationFrame`, restore `scrollTop`, then focus the opener if it is still connected. If it is not, focus `[data-focus-head="<id>"]`.
- Esc (a `keydown` listener on `document` while open) calls `close()` only when all three hold: the event is not `defaultPrevented`; no `[role="dialog"]`, `.mantine-Popover-dropdown` or `.mantine-Menu-dropdown` is in the DOM; and no param in this hook's `clears` is currently set in the query (a deeper level is open, so the deeper hook handles Esc). Depth comes from `clears`, not from effect order, so it works whatever component the inner hook lives in.
- Scroller default: `document.scrollingElement ?? document.documentElement` (jsdom has no `scrollingElement`).
- If `valid` is a function and `open` fails it, `router.replace` without the param. If `valid` is undefined, nothing is checked (callers pass `valid: data ? fn : undefined`, so a deep link survives loading).

`aliasQuery` rules (it returns null when nothing changes):
- `/` + `tab=needs` → `{ focus: 'needs' }`.
- `/` + `item=N` → `{ kid: N }`.
- `/` + `chore=R` without `kid`:
  - `kidOfRun` absent → null (data not loaded yet).
  - `kidOfRun(R)` returns K → `{ kid: K, chore: R }`.
  - `kidOfRun(R)` returns undefined → `{ focus: 'needs' }`.
- `/kids` + `kid=K` without `item`:
  - section `chores` → `{ section: 'chores', item: 'new' }` (today's behaviour).
  - otherwise → `{ section: 'kids', item: K }`, plus `{ open: 'settings', edit: '1', pin: '1' }` when `pin=1`, or `{ open: 'trust' }` when the hash is `#trust` (`RecapLooks.tsx:37` links `kid=K#trust`).
- `/kids` + `section=kids` + `item` + hash `#trust` + no `open` → the same query plus `open: 'trust'`.
- `useFocusAliases` runs `aliasQuery(router.pathname, router.query, window.location.hash, kidOfRun)` in an effect. When the result is non-null, it calls `router.replace({ pathname, query }, undefined, { shallow: true, scroll: false })`.

- [ ] **Step 1: Write `fakeRouter.ts`, then the failing tests**

`focusParam.test.tsx`: render a tiny harness that has two section buttons using `data-focus-head` and calls `useFocusParam('open')`.
```ts
test('openTo pushes the param with shallow routing', () => { /* click A */ expect(fakeRouter.push).toHaveBeenCalledWith({ pathname: '/x', query: { open: 'a' } }, undefined, { shallow: true, scroll: false }); expect(fakeRouter.stack).toHaveLength(2) })
test('reads the open section from the URL on first render', () => { fakeRouter.reset('/x', { open: 'b' }); /* render */ expect(screen.getByTestId('open')).toHaveTextContent('b') })
test('switching sections replaces, so one Back returns to calm', () => { /* open a, open b */ expect(fakeRouter.stack).toHaveLength(2); act(() => fakeRouter.back()); expect(fakeRouter.query.open).toBeUndefined() })
test('close after a push goes back instead of adding an entry', () => { /* open a, close */ expect(fakeRouter.back).toHaveBeenCalled(); expect(fakeRouter.stack).toHaveLength(1) })
test('close on a deep-linked section replaces', () => { fakeRouter.reset('/x', { open: 'a' }); /* close */ expect(fakeRouter.replace).toHaveBeenCalled(); expect(fakeRouter.query).toEqual({}) })
test('Esc closes the open section', () => { /* open a */ fireEvent.keyDown(document, { key: 'Escape' }); expect(fakeRouter.query.open).toBeUndefined() })
test('ignores Esc while a popover or menu dropdown is open', () => { /* open a; append <div class="mantine-Popover-dropdown"> */ fireEvent.keyDown(document, { key: 'Escape' }); expect(fakeRouter.query.open).toBe('a') })
test('Esc closes only the deepest level', () => { /* outer useFocusParam('kid', { clears: ['chore'] }), inner useFocusParam('chore'); both open */ fireEvent.keyDown(document, { key: 'Escape' }); expect(fakeRouter.query).toEqual({ kid: '3' }) })
test('Esc closes the deepest level when the inner hook is in a child component', () => { /* deep link reset('/x',{kid:'3',chore:'12'}); inner hook in <Child/> */ fireEvent.keyDown(document, { key: 'Escape' }); expect(fakeRouter.query).toEqual({ kid: '3' }) })
test('keeps a deep link while valid is undefined (data loading)', () => { fakeRouter.reset('/x', { open: 'a' }); /* render with valid: undefined */ expect(fakeRouter.replace).not.toHaveBeenCalled(); /* rerender with valid: id => id === 'a' */ expect(fakeRouter.query.open).toBe('a') })
test('openTo with extra sets several params in one navigation', () => { /* openTo('settings', { extra: { edit: '1' } }) */ expect(fakeRouter.push).toHaveBeenCalledTimes(1); expect(fakeRouter.query).toEqual({ open: 'settings', edit: '1' }) })
test('openTo with replace adds no history entry', () => { /* openTo('basics', { replace: true }) */ expect(fakeRouter.push).not.toHaveBeenCalled(); expect(fakeRouter.stack).toHaveLength(1) })
test('restores the calm scroll position on close', () => { document.documentElement.scrollTop = 420; /* open a */ document.documentElement.scrollTop = 0; /* close, flush rAF */ expect(document.documentElement.scrollTop).toBe(420) })
test('returns focus to the opener on close', () => { /* click head a (focused), close, flush rAF */ expect(document.activeElement).toBe(screen.getByRole('button', { name: 'A' })) })
test('drops an invalid value with replace', () => { fakeRouter.reset('/x', { open: 'bogus' }); /* render with valid: id => ['a','b'].includes(id) */ expect(fakeRouter.replace).toHaveBeenCalled(); expect(fakeRouter.query.open).toBeUndefined() })
test('group params are swapped without a new history entry', () => { /* useFocusParam('kid', { group: ['focus'] }) with query { focus: 'needs' }; openTo('3') */ expect(fakeRouter.query).toEqual({ kid: '3' }); expect(fakeRouter.push).not.toHaveBeenCalled() })
```
`focusAliases.test.ts`: one `test.each` row per rule above (including `/kids` `{ section: 'kids', kid: '7' }` + hash `#trust` → `{ section: 'kids', item: '7', open: 'trust' }`), plus:
```ts
test('alias rewrite uses replace', () => { fakeRouter.reset('/', { tab: 'needs' }); render(<Harness />); expect(fakeRouter.replace).toHaveBeenCalledWith({ pathname: '/', query: { focus: 'needs' } }, undefined, { shallow: true, scroll: false }); expect(fakeRouter.push).not.toHaveBeenCalled() })
test('a chore not on today goes to Needs you', () => expect(aliasQuery('/', { chore: '77' }, '', () => undefined)).toEqual({ focus: 'needs' }))
test('waits for data before mapping a chore', () => expect(aliasQuery('/', { chore: '77' }, '')).toBeNull())
test('already-new links are left alone', () => expect(aliasQuery('/', { kid: '3', chore: '12' }, '')).toBeNull())
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd frontend && npx jest tests/v2/focusParam.test.tsx tests/v2/focusAliases.test.ts`
Expected: FAIL, "Cannot find module '@/v2/parent/useFocusParam'".

- [ ] **Step 3: Implement `useFocusParam.ts` and `focusAliases.ts` to the behaviour above**

- [ ] **Step 4: Run the tests and confirm they pass**

Run the same command. Expected: PASS.

- [ ] **Step 5: Edit the shot tooling**

`mock.mjs` and `shoot.mjs` already exist in `scripts/shots/declutter/` (committed). Leave `mock.mjs` as it is. Edit `shoot.mjs` in place (it is the old audit script that shoots every screen) so it does only this:
- Load Playwright with `createRequire(new URL('../../../frontend/package.json', import.meta.url))('playwright')`, as `site/check.mjs` does (replaces the hard-coded `tskfrce-trust` import).
- Keep `BASE = 'http://127.0.0.1:3295'` and the `import { route, S } from './mock.mjs'`.
- Keep the login as `dad` / `pw12345678` with `page.route('**/api/proxy/**', route)`.
- Replace the screen list, `COUNT`, `EXPAND` and `counts.json` with the CLI `<outDir> <name> <appPath> [<mockupFile> <preset>]`.
- For phone (390×844, deviceScaleFactor 2, isMobile, hasTouch) and desktop (1280×`DESKTOP_H`, default 900), each in `colorScheme` light and dark: go to `appPath`, wait for `main`, wait 1200 ms, and take a viewport screenshot as `<out>/<name>-<device>-<scheme>.png`.
- If `<mockupFile> <preset>` are given, also load `file://<repo>/.superpowers/mockups/<mockupFile>?s=<preset>&t=<scheme>&w=<device>` and screenshot `#box` as `<name>-mock-<device>-<scheme>.png`.
- Fix the first-line comment to describe the new CLI.

Smoke run: start the dev server, then run `node scripts/shots/declutter/shoot.mjs frontend/e2e-artifacts/declutter smoke / declutter-v1.html today-calm`. Expected: 8 PNGs, no errors.

- [ ] **Step 6: CI gate, then commit**

```bash
git add frontend/src/v2/parent/useFocusParam.ts frontend/src/v2/parent/focusAliases.ts frontend/tests/v2/helpers/fakeRouter.ts frontend/tests/v2/focusParam.test.tsx frontend/tests/v2/focusAliases.test.ts scripts/shots/declutter/shoot.mjs
git commit -m "feat(focus): useFocusParam, old-link aliases and shot tooling" -m "<trailer>"
```

---

### Task 2: `SummaryRow`, `FocusArea`, `InfoPop`, `MoreMenu`, widget CSS

**Files:**
- Create: `frontend/src/v2/parent/SummaryRow.tsx` (exports `SummaryRow`, `FocusArea`)
- Create: `frontend/src/v2/parent/InfoPop.tsx`
- Create: `frontend/src/v2/parent/MoreMenu.tsx`
- Create: `frontend/src/v2/parent/declutter.css`
- Modify: `frontend/pages/_app.tsx` (import `../src/v2/parent/declutter.css` after `interactions.css`, line 61)
- Test: `frontend/tests/v2/summaryRow.test.tsx`, `frontend/tests/v2/infoPop.test.tsx`

**Interfaces:**
- Consumes: `Focus` from Task 1.
- Produces:
  ```ts
  export interface SummaryRowProps {
    id: string; icon: ReactNode; title: ReactNode; summary: ReactNode
    line2?: ReactNode   // second calm line, rendered after (not inside) the head button; not rendered while another row in the FocusArea is open
    aside?: ReactNode   // control right of the head, outside the toggle button (e.g. a Switch)
    focus: Focus; children: ReactNode   // body, rendered only when open
  }
  export function SummaryRow(p: SummaryRowProps): JSX.Element
  export function FocusArea({ focus, label, children }: { focus: Focus; label?: string; children: ReactNode }): JSX.Element
  export function InfoPop({ label, children, target, width }: { label: string; children: ReactNode; target?: ReactElement; width?: number }): JSX.Element
  export interface MenuItem { label: string; icon: string; onClick?: () => void; href?: string; tone?: 'red'; divider?: boolean; hidden?: boolean }
  export function MoreMenu({ label, items, id }: { label: string; items: MenuItem[]; id?: string }): JSX.Element
  ```
- CSS classes the later tasks use: `.p-srows` (`[data-focused]`), `.p-srow` (`[data-open]`), `.p-srow-head`, `.p-srow-l1`, `.p-srow-l2`, `.p-srow-val`, `.p-srow-chev`, `.p-srow-body`, `.p-srow-aside`, `.p-info-btn`, `.p-pop`, `.p-kn` (a name that never breaks mid-word: `white-space: nowrap; overflow: hidden; text-overflow: ellipsis; word-break: keep-all; overflow-wrap: normal`), `.p-sec-h` (small section heading), `.p-ib` (44 px icon button on phone).

Markup and behaviour:
- `SummaryRow` renders `<section className="p-srow" data-open?>`. Inside, a head `<button className="p-srow-head" aria-expanded aria-controls="srow-<id>-body" data-focus-head={id} onClick={() => focus.toggle(id)}>` holds the icon, `<b id="srow-<id>-title">`title, `.p-srow-val` summary and chevron. `line2` is a sibling `<div className="p-srow-l2">` right after the button (never inside it: T7 puts a Switch there, T9 a button), and is not rendered when `focus.open && focus.open !== id`. `aside` is also a sibling of the button. When open, the body is `<div id="srow-<id>-body" role="region" aria-labelledby="srow-<id>-title" tabIndex={-1} className="p-srow-body">`, so the region's name is exactly the title (e2e selectors like `getByRole('region', { name: 'Right now' })` rely on this). On opening, focus the first focusable element in the body (or the body itself) and call `scrollIntoView({ block: 'nearest', behavior })`, where `behavior` is `'auto'` when `matchMedia('(prefers-reduced-motion: reduce)')` matches and `'smooth'` otherwise.
- Swipe down on the head of an open row (touchstart→touchend, dy > 60 px) calls `focus.close()`.
- `FocusArea` renders `<div className="p-srows" data-focused={focus.open ? '' : undefined} aria-label={label}>`. CSS only does layout: rows that are not open stay one line while the area is focused (`line2` is already not rendered, see above).
- `InfoPop` wraps a Mantine `Popover` with `withinPortal`, `position="bottom"`, `middlewares={{ flip: true, shift: { padding: 16 } }}`, `closeOnEscape`, `closeOnClickOutside`, `returnFocus`, and is controlled. The default target is `<button type="button" className="p-info-btn" aria-label={label}>` with Icon `info`. A click toggles it. When `matchMedia('(hover: hover) and (pointer: fine)')` matches, `mouseenter` opens it and `mouseleave` closes it after 120 ms. The dropdown has `className="p-pop"` and `maw="calc(100vw - 32px)"`, and `w={width}` when given.
- `MoreMenu` is a Mantine `Menu` with `position="bottom-end" withinPortal`. Its target is `<button className="p-btn p-ib" aria-label={label} id={id}>` with Icon `more_horiz`. Each item: `href` → `component={Link}`; `tone: 'red'` → `color="red"`; `divider` → `Menu.Divider` before it; `hidden` → skipped.

- [ ] **Step 1: Write the failing tests**

```ts
// summaryRow.test.tsx (fakeRouter from Task 1)
test('head is a button with aria-expanded and opens the body', async () => { /* click 'Trust' */ expect(screen.getByRole('button', { name: /Trust/ })).toHaveAttribute('aria-expanded', 'true'); expect(screen.getByRole('region', { name: /Trust/ })).toBeInTheDocument() })
test('only one row is open at a time and others drop their second line', () => { /* open trust then devices */ expect(screen.queryByRole('region', { name: /Trust/ })).toBeNull(); expect(screen.queryByText('trust line 2')).toBeNull() })
test('focus moves into the opened body', () => { /* open */ expect(screen.getByRole('region', { name: /Trust/ })).toContainElement(document.activeElement as HTMLElement) })
test('tapping the open head closes it', () => { /* click twice */ expect(fakeRouter.query.open).toBeUndefined() })
test('swipe down on the open head closes it', () => { fireEvent.touchStart(head, { touches: [{ clientY: 100 }] }); fireEvent.touchEnd(head, { changedTouches: [{ clientY: 180 }] }); expect(fakeRouter.query.open).toBeUndefined() })
test('aside switch does not toggle the row', () => { /* click aside switch */ expect(fakeRouter.push).not.toHaveBeenCalled() })
test('line2 sits outside the head button', () => { /* line2 = <button>x</button> */ expect(screen.getByRole('button', { name: /Trust/ })).not.toContainElement(screen.getByText('trust line 2')) })
test('region is named by the title only', () => { /* open */ expect(screen.getByRole('region', { name: 'Trust' })).toBeInTheDocument() })
test('kid names never break mid-word', () => {                         // CSS assertion, read declutter.css like parentCss.test.ts
  expect(css).toMatch(/\.p-kn\s*{[^}]*white-space:\s*nowrap/); expect(css).toMatch(/\.p-kn\s*{[^}]*word-break:\s*keep-all/) })
// infoPop.test.tsx
test('tap opens the pop-over', async () => { await user.click(screen.getByRole('button', { name: 'About trust' })); expect(await screen.findByText('pop body')).toBeVisible() })
test('Esc closes the pop-over and returns focus to its button', async () => { /* open, Escape */ expect(screen.queryByText('pop body')).toBeNull(); expect(document.activeElement).toBe(screen.getByRole('button', { name: 'About trust' })) })
test('InfoPop dropdown is width-capped at 100vw - 32px', async () => { /* open */ expect(document.querySelector('.p-pop')).toHaveStyle({ maxWidth: 'calc(100vw - 32px)' }) })
test('MoreMenu shows items and hides hidden ones', async () => { /* open menu */ expect(screen.getByRole('menuitem', { name: 'Delete' })).toBeInTheDocument(); expect(screen.queryByRole('menuitem', { name: 'Secret' })).toBeNull() })
```

- [ ] **Step 2: Run them and confirm they fail**

Run: `cd frontend && npx jest tests/v2/summaryRow.test.tsx tests/v2/infoPop.test.tsx`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement the four components and `declutter.css`, and import the CSS in `_app.tsx`**

Copy the row and pop look from the mockup classes `.srow`, `.shead`, `.l1`, `.val`, `.chev`, `.sb`, `.pop` in `declutter-v1.html` (the `<style>` block), mapped onto `--p-*` tokens.

- [ ] **Step 4: Run these tests plus `tests/v2/cssCoverage.test.ts`. Expected: PASS.**

- [ ] **Step 5: CI gate, then commit** `feat(parent): SummaryRow, FocusArea, InfoPop and MoreMenu`

---

### Task 3: `DetailHeader`, `ActionRow`, `SaveBar` + `useDiscardGuard`, `KidPicker`, `ProgressRing`

**Files:**
- Create: `frontend/src/v2/parent/DetailHeader.tsx`, `ActionRow.tsx`, `SaveBar.tsx`, `KidPicker.tsx`, `ProgressRing.tsx`
- Modify: `frontend/src/v2/parent/declutter.css`
- Modify: `frontend/tests/v2/helpers/fakeRouter.ts` (add `beforePopState: jest.Mock` that stores the handler)
- Test: `frontend/tests/v2/detailWidgets.test.tsx`, `frontend/tests/v2/kidPicker.test.tsx`, `frontend/tests/v2/saveBar.test.tsx`

**Interfaces:**
- Consumes: `InfoPop`, `MoreMenu`, `MenuItem` (Task 2); `ChipTone` from `@/v2/parent/Chip`; `ConfirmDelete` from `@/v2/manage/ConfirmDelete`; `initial`, `nameOf` from `@/v2/manage/choreMeta`; `Kid` from `@/v2/types`.
- Produces:
  ```ts
  export interface StatusChip { tone: ChipTone; icon: string; label: string; pop?: ReactNode }
  export function DetailHeader(p: { media: ReactNode; title: string; sub?: ReactNode; chips?: ReactNode; status?: StatusChip; main?: ReactNode; menu?: MenuItem[]; menuLabel?: string; menuId?: string }): JSX.Element
  export function ActionRow(p: { icon: string; iconTone?: ChipTone; iconLabel: string; iconHelp?: ReactNode; title: ReactNode; sub?: ReactNode;
    main?: { label: string; onClick: () => void; busy?: boolean; disabled?: boolean }; menu?: MenuItem[]; menuLabel?: string; children?: ReactNode }): JSX.Element
  export function SaveBar(p: { dirty: boolean; saving: boolean; onSave: () => void; onCancel: () => void; saveLabel?: string; disabled?: boolean; note?: ReactNode }): JSX.Element | null
  export function useDiscardGuard(dirty: boolean): { guard: (go: () => void) => void; sheet: ReactNode }
  export interface PickerExtra { value: string; label: string; icon?: string }
  export function KidPicker(p: { kids: Kid[]; value: string[]; onChange: (v: string[]) => void; label: string; single?: boolean; extras?: PickerExtra[];
    busy?: boolean; disabled?: boolean; variant?: 'pills' | 'pop'; placeholder?: string }): JSX.Element
  export function ProgressRing(p: { done: number; total: number }): JSX.Element
  ```

Behaviour:
- `DetailHeader`:
  - Renders `<header className="p-dhead">`: media, `<h2>`title, `sub` as a `.p-dhead-sub` line, then `chips`.
  - `status` renders as an `InfoPop` whose target is `<button className="p-chip" data-tone>` with the icon and label, and whose body is `status.pop`. With no `pop`, it is a plain `Chip`.
  - On the right: `main`, then `MoreMenu` when `menu` is non-empty.
- `ActionRow`:
  - Renders `.p-arow`: a type icon `<button className="p-arow-ty" data-tone aria-label={iconLabel}>` wrapped in `InfoPop` with `iconHelp`; then title and sub; then `main` as `p-btn data-variant="accent"` with `aria-busy={busy}` and `data-loading={busy || undefined}` (`buttons.css` styles `data-loading`; the same pair goes on every busy button in this task); then `MoreMenu`.
  - `children` render under the row (an inline reply or send-back box).
- `SaveBar`:
  - Renders nothing when `!dirty`.
  - Otherwise renders a sticky `.p-savebar` with `role="region" aria-label="Unsaved changes"`, an optional note, a `Cancel` button and a primary `saveLabel` button (default `Save`) with `aria-busy={saving}`.
- `useDiscardGuard`:
  - `guard(go)` calls `go()` at once when the form is clean. When dirty, it opens `ConfirmDelete` with `title="Discard changes?"`, `body="What you changed here won't be saved."` and `confirmLabel="Discard"`, and calls `go()` on confirm.
  - While dirty it adds a `beforeunload` listener that calls `preventDefault`.
  - While dirty it also sets `router.beforePopState`: browser Back returns `false` (stays), restores the URL with `router.push(router.asPath, undefined, { shallow: true, scroll: false })`, and opens the same sheet; Discard then calls `router.back()`. It resets `beforePopState(() => true)` when clean or unmounted. Add `beforePopState: jest.fn()` to `fakeRouter` (Task 1 file; extend it here).
- `KidPicker`:
  - Values are strings: kid ids as text, plus extras such as `'guest'` and `'unsure'`.
  - Picking an extra clears the kids. Picking a kid clears the extras. `single` keeps one value.
  - `variant` defaults to `'pills'`, which renders `<div className="pk-pills" role="group" aria-label={label}>` with one `.pk-pill` button per kid (letter avatar `initial(nameOf(k))`) and per extra, using `aria-pressed`.
  - `variant='pop'` renders one button labelled with the current pick (or `placeholder`, default `Owner`), `aria-label={label}`. It opens an `InfoPop`-style Popover listing kids, extras and a divider, and closes on pick.
  - `busy` ignores taps but keeps keyboard focus, as `KidPills` does.
- `ProgressRing`: an SVG ring (r=12, stroke 4, as `ring()` in the mockup) followed by the text `{done} of {total}`. It has `role="img"` and `aria-label={`${done} of ${total} done`}`.

- [ ] **Step 1: Write the failing tests**

```ts
test('DetailHeader status chip opens its pop-over', ...) // click chip 'Open' → pop text visible
test('DetailHeader puts Delete only in the … menu', ...) // queryByRole('button',{name:'Delete'}) null; menu has menuitem Delete
test('ActionRow main button and … menu', ...)           // Approve calls onClick; menu lists Send back, Reply
test('ActionRow type icon explains itself', ...)         // click icon button 'Spot check' → help text
test('SaveBar is hidden until dirty', ...)               // dirty=false → queryByRole('region',{name:'Unsaved changes'}) null
test('SaveBar Cancel and Save', ...)                     // callbacks fire; Save has aria-busy and data-loading when saving
test('useDiscardGuard asks before leaving a dirty form', ...) // guard(go) → dialog 'Discard changes?'; click Discard → go called once
test('useDiscardGuard passes straight through when clean', ...)
test('useDiscardGuard blocks browser Back while dirty', ...) // dirty → beforePopState handler returns false and opens 'Discard changes?'; clean → handler returns true
test('KidPicker pills is a labelled group', ...)          // getByRole('group',{name:'Assign to'}) with no variant prop
test('KidPicker multi toggles kids', ...)                // value ['3'] click Leo → onChange(['3','4'])
test('KidPicker extras are exclusive', ...)              // value ['3'] click Guest → onChange(['guest'])
test('KidPicker single replaces', ...)                   // single, value ['3'] click Leo → onChange(['4'])
test('KidPicker pop variant shows the pick and closes after choosing', ...) // button text 'Owner' → open → click Maya → onChange(['3']), menu gone
test('ProgressRing labels progress', ...)                // getByRole('img',{name:'4 of 6 done'})
```

- [ ] **Step 2: Run them and confirm they fail** (`npx jest tests/v2/detailWidgets.test.tsx tests/v2/kidPicker.test.tsx tests/v2/saveBar.test.tsx`)
- [ ] **Step 3: Implement the five files and their CSS** (`.p-dhead*`, `.p-arow*`, `.p-savebar`, `.p-ring`). The look follows mockup classes `.khead`, `.row`/`.acts`, `.ring`, and the `savebar()` output in `declutter-v2.html`.
- [ ] **Step 4: Run them and confirm they pass, along with `cssCoverage.test.ts`**
- [ ] **Step 5: CI gate, then commit** `feat(parent): DetailHeader, ActionRow, SaveBar, KidPicker, ProgressRing`

---

### Task 4: Today, calm state

**Files:**
- Modify: `frontend/src/v2/today/TodayPage.tsx` (full rewrite as the orchestrator, under 200 lines)
- Create: `frontend/src/v2/today/KidCard.tsx` (calm row/tile; the focused body comes in Task 5)
- Create: `frontend/src/v2/today/TipSlot.tsx`
- Create: `frontend/src/v2/today/TodayRows.tsx` (`DevicesRow`, `AddonsRow`)
- Create: `frontend/src/v2/today/HappyHourChip.tsx`
- Modify: `frontend/src/v2/today/HappyHourButton.tsx`: export `HappyHourSheet({ opened, onClose, kidId, allKids }: { opened: boolean; onClose: () => void; kidId?: number; allKids?: boolean })`, taken from the sheet inside `HappyHourButton`. `HappyHourButton` keeps working by using it.
- Modify: `frontend/src/v2/today/GetStartingChecklistCard.tsx`: export `useChecklistShown(kids: TodayKid[]): boolean`, using the same `allDone || wasDismissed` logic.
- Modify: `frontend/src/v2/today/TryCards.tsx`: export `useTryCardKey(): string | null`, the same key `TryCards` would show.
- Modify: `frontend/src/v2/today/KidFacts.tsx`: drop the Points fact (the card shows points) and add `Last active` (from `TodayKid.last_active`, formatted with the same clock helper; `—` when null). Facts are Streak, Last active, Next reward, Locks at.
- Delete: `frontend/src/v2/today/KidList.tsx` (the desktop list column and its Today / Needs you tabs go away)
- Delete: `frontend/tests/v2/kidListNeeds.test.tsx`, in this same commit (it imports `KidList`). Its one case (`Needs tab labels a waiting chore from an older day`) moves first into `frontend/tests/v2/needsYouList.test.tsx` as `labels a waiting chore from an older day`, rendering `NeedsYouList` directly.
- Modify: `frontend/src/v2/parent/parent-today.css` (or a new `today-focus.css` if it would pass 500 lines)
- Test: create `frontend/tests/v2/todayCalm.test.tsx`; update `today.test.tsx`, `todayPhone.test.tsx`, `needsYouList.test.tsx` (gains the older-day case), `happyHour.test.tsx` (its TodayPage placement assertion now expects Start Happy Hour in the header "…", not a header button), `tryCards.test.tsx`, `GetStartingChecklistCard.test.tsx`, and any `KidFacts` test (`grep -rln KidFacts frontend/tests`)
- E2E: `frontend/e2e/parent.spec.ts:9-10`. Replace `getByRole('tab', { name: /Needs you/ })` with `getByRole('button', { name: /^Needs you/ })`.

**Interfaces:**
- Consumes: `useFocusParam`, `useFocusAliases` (Task 1); `SummaryRow`, `FocusArea`, `InfoPop`, `MoreMenu` (Task 2); `ProgressRing` (Task 3); `KidFacts` (`today/KidFacts.tsx`); `useToday`, `useDevices`, `useIntegrationWidgets('parent')`, `useHappyHours`.
- Produces for Tasks 5 and 6:
  ```ts
  // TodayPage.tsx
  const kidFocus = useFocusParam('kid', { group: ['focus'], clears: ['chore'], valid: data ? id => data.kids.some(k => String(k.id) === id) : undefined })
  const areaFocus = useFocusParam('focus', { group: ['kid'], clears: ['chore'], valid: id => ['needs', 'devices', 'addons'].includes(id) })
  // KidCard.tsx
  export function KidCard(p: { kid: TodayKid; focus: Focus; waiting: NeedsItem[]; children?: ReactNode /* focused body, Task 5 */ }): JSX.Element
  // TipSlot.tsx
  export function TipSlot({ kids }: { kids: TodayKid[] }): JSX.Element | null
  // TodayRows.tsx
  export function DevicesRow({ focus }: { focus: Focus }): JSX.Element | null
  export function AddonsRow({ focus }: { focus: Focus }): JSX.Element | null
  // HappyHourChip.tsx
  export function HappyHourChip(): JSX.Element | null
  ```

Calm layout, top to bottom (mockup `today-calm`):
- `ParentShell` with **no `list`** (Today drops the list column on desktop). `actions = <MoreMenu label="More for Today" items={[{ label: 'Start Happy Hour', icon: 'bolt', onClick: openSheet }]} />`, which renders `HappyHourSheet allKids`.
- `HappyHourChip`, only while a Happy Hour runs. The chip text is `Happy hour ×2 · 45 min`. Its pop-over says who it is for and when it ends, and has a red `Stop now` that uses `useStopHappyHour`.
- The Needs strip: a button `Needs you · N` with `aria-expanded={areaFocus.isOpen('needs')}` and `aria-controls="needs-body"`, only when `needs_you.length > 0`. It calls `areaFocus.toggle('needs')`. Until Task 6 reworks it, the open body (`<div id="needs-body" role="region" aria-label="Needs you">`) renders the existing `NeedsYouList` unchanged, so no feature is missing at this commit.
- Kid cards:
  - Phone: one row each. Desktop (≥768 px): tiles in a grid, `repeat(auto-fit, minmax(260px, 1fr))`.
  - Each `KidCard` is a `div.pt-kcard`. It holds two sibling buttons:
    - Avatar button `aria-label="<Name> details"`, wrapped in `InfoPop`. The pop-over shows `KidFacts` (Streak, Last active, Next reward, Locks at), plus `Earned today: N` (it was in the removed summary strip), plus a link `Open <Name>'s page` → `/kids?section=kids&item=<id>`.
    - Row button with `aria-expanded`, calling `kidFocus.toggle(String(id))`. It shows the name (`.p-kn`), a lav chip `N waiting` only when `needs_you_count > 0`, `ProgressRing done/total`, `<points> pts` and a chevron.
- `TipSlot`. It shows exactly one of these, in order:
  1. `GetStartingChecklistCard` when `useChecklistShown`.
  2. Otherwise `TryCards` when `useTryCardKey()` is non-null.
  3. Otherwise `TipsContainer tips={PARENT_TIPS} maxTips={1}`.
  It renders only in the calm state (hidden while `kidFocus.open || areaFocus.open`).
- `DevicesRow`: a `SummaryRow id="devices"`, title `Devices`, summary `N online`, where N counts `useDevices().data` items with `seen_now`. The body lists each kid's devices (name + `Open`/`Locked` chip, the same rule as `KidDetail`), then `Open Devices ›` → `/devices`.
- `AddonsRow`: a `SummaryRow id="addons"`, title `Add-ons`, summary `N add-ons`. The body is `<IntegrationWidgets surface="parent" />`. The row is hidden when there are no widgets.
- Remove: `SegmentedControl` (phone Today / Needs tabs), the `pt-head` buttons (View as kid and Add chore move to kid focus in Task 5; `HappyHourButton` is replaced by the header "…" item `Start Happy Hour` above and appears nowhere else), the progress bar, `pt-phone-facts`, and `p-summary-strip`.
- Empty family (`kids.length === 0`): the existing `EmptyState` stays.
- `useFocusAliases(runId => data?.kids.find(k => k.chores.some(c => c.id === runId))?.id)`. Pass `undefined` until `data` loads.
- Keep the `OpeningLink` guard for `?chore=` while loading.

- [ ] **Step 1: Write failing tests in `todayCalm.test.tsx`**, using the fakeRouter mock and the existing `api` mock pattern from `today.test.tsx`

```ts
test('calm shows one card per kid with waiting chip, ring and points', ...) // 'Maya' row: '2 waiting', img '2 of 6 done', '240 pts'
test('no waiting chip when nothing waits', ...)
test('Needs strip shows the total and only when something waits', ...)     // button /^Needs you · 7/ with aria-expanded="false" and aria-controls; with needs_you [] → absent
test('Needs strip opens the waiting list in place', ...)                  // click strip → aria-expanded true; region 'Needs you' lists the items
test('there are no Today / Needs you tabs', ...)                            // queryByRole('tab') null; queryByRole('radiogroup',{name:'Today view'}) null
test('avatar opens the details pop-over, row focuses the kid', ...)        // click 'Maya details' → 'Streak', 'Last active', 'Earned today'; no 'Points' fact; click row → fakeRouter.query.kid === '3'
test('?kid= deep link survives the first render before data loads', ...)  // reset('/',{kid:'3'}); api pending → replace not called
test('one tip at most, checklist first', ...)                               // checklist shown → TryCards text absent
test('Devices row counts devices online now', ...)                          // 'Devices' + '8 online' with mock devices
test('Add-ons row hidden without widgets', ...)
test('Start Happy Hour lives in the header … menu', ...)                    // open 'More for Today' → menuitem 'Start Happy Hour' → dialog
test('Happy Hour chip only while running, Stop in its pop-over', ...)
test('old ?tab=needs link becomes ?focus=needs', ...)                       // fakeRouter.reset('/',{tab:'needs'}) → replace to {focus:'needs'}
```

- [ ] **Step 2: Run and confirm FAIL**: `npx jest tests/v2/todayCalm.test.tsx`
- [ ] **Step 3: Implement the files above.** Update the existing Today tests to the new layout. Keep every behaviour they covered, with the selectors moved.
- [ ] **Step 4: Run and confirm PASS**: `npx jest tests/v2/today* tests/v2/needsYouList.test.tsx tests/v2/happyHour.test.tsx tests/v2/tryCards.test.tsx tests/v2/GetStartingChecklistCard.test.tsx tests/v2/cssCoverage.test.ts`, then `grep -rn "KidList\b" frontend/src frontend/tests` returns nothing.
- [ ] **Step 5: SS**: `today-calm` at `/`, against `declutter-v1.html today-calm`.
- [ ] **Step 6: CI gate including `npm run test:standalone`, then commit** `feat(today): calm overview with kid cards, one tip and tucked extras`

---

### Task 5: Today, kid focus (`?kid=`) and chore second level (`?kid=&chore=`)

**Files:**
- Create: `frontend/src/v2/today/KidFocus.tsx`
- Create: `frontend/src/v2/today/needsActions.ts` (logic taken out of `NeedsYouList.tsx`, so both lists share it)
- Modify: `frontend/src/v2/today/KidStrip.tsx` (rework to the spec)
- Modify: `frontend/src/v2/today/ChoreRow.tsx` (new optional prop `waiting?: NeedsItem`; when set, the row shows Approve + "…" instead of the `Needs OK` chip. The actions render as a sibling after `<button className="pt-row">`, never inside it)
- Modify: `frontend/src/v2/today/NeedsYouList.tsx` (use `needsActions`)
- Modify: `frontend/src/v2/today/TodayPage.tsx`, `KidCard.tsx`
- Test: create `frontend/tests/v2/todayFocus.test.tsx`; update `kidStrip.test.tsx` (rename `waiting count, all-done tick, selection and Add` → `waiting count, all-done tick and selection`; the strip has no Add, per the mockup), `choreRow.test.tsx`, `needsYouList.test.tsx`, `trustParent.test.tsx` (renders `ChoreRow`)

**Interfaces:**
- Consumes: `kidFocus`, `KidCard` (Task 4); `ActionRow`, `MoreMenu` (Tasks 2–3); `PointsForm` (`manage/PointsForm.tsx`, needs a `Kid` from `useKids`); `viewAs` (`kid/viewAs`); `ChoreRow`, `ChoreOpen`.
- Produces:
  ```ts
  // needsActions.ts
  export const isChore: (i: NeedsItem) => boolean
  export function useNeedsActions(): {
    approve(i: NeedsItem): Promise<boolean>
    approveAll(items: NeedsItem[]): Promise<void>
    sendBack(runId: number, note: string): Promise<boolean>
    decline(i: NeedsItem): Promise<boolean>   // screen_time / reward: the existing `decide.mutateAsync({ id: i.id, approve: false })` + 'Declined' toast (NeedsYouList.tsx:187)
    reply(i: NeedsItem): void   // chore items (i.id is the run id): router.push(`/?kid=${i.kid_id}&chore=${i.id}`) + openChat('chore', String(i.id))
    busy: string | null
  }
  // ChoreRow.tsx (new optional prop)
  waiting?: NeedsItem   // KidFocus passes the kid's needs_you item whose run id matches the chore
  // KidStrip.tsx
  export function KidStrip(p: { kids: TodayKid[]; selected?: number; onSelect: (id: number) => void; onAll: () => void; waiting: number; onNeeds: () => void }): JSX.Element
  // KidFocus.tsx
  export function KidFocus(p: { kid: TodayKid; requests: NeedsItem[]; chore: Focus }): JSX.Element
  ```
  `chore = useFocusParam('chore', { valid: kid ? id => kid.chores.some(c => String(c.id) === id) : undefined })`.

Behaviour (mockup `today-kid`):
- While `kidFocus.open`: `KidStrip` replaces the other kid cards at the top. It has a `‹ All` button that calls `kidFocus.close()`, then one avatar per kid with `aria-pressed` for the selected kid and a lav dot holding the waiting count, a spacer, and a Needs pill with the total that calls `areaFocus.openTo('needs')`. Only the focused `KidCard` stays, expanded with `KidFocus` as its body. The Needs strip, tip and extras rows are hidden.
- `KidFocus`, on desktop in two columns (`kb` grid in the mockup):
  - `Chores` (`.p-sec-h`): one `ChoreRow` per chore. `isOpen = chore.isOpen(String(c.id))` and `onToggle = chore.toggle(id)`. A `needs_you` chore gets `waiting={item}` and shows `Approve` + "…" (`Send back`, `Reply`) instead of its status chip, and appears only here, not also in Requests.
  - `Requests` group: shown only when the kid has non-chore needs items (`screen_time`, `reward`, `note`). One `ActionRow` per item. Screen-time and reward rows: main `Approve`, "…" holds `Decline` (red, `decline(i)`). A note's main is `Reply`.
  - Action bar: `+ Add chore` (accent link to `/kids?section=chores&item=new`) and `MoreMenu label="More for <Name>"` with:
    - `Bonus` and `Deduct`: open `PointsForm` inline under the bar.
    - `View as kid` → `viewAs(id, asPath)`.
    - `Open page` → `/kids?section=kids&item=<id>`.
  - No Happy Hour button here (it lives only in the Today header "…", Task 4).
- An unknown `?kid=` id falls back to calm through `valid`.
- A focused kid stays focused when `/today` refetches.
- `ChoreRow`'s own open sheet (`ChoreOpen`) is the second level. Esc closes the chore first, then the kid.

- [ ] **Step 1: Write failing tests (`todayFocus.test.tsx`)**

```ts
test('?kid= opens that kid in place and collapses others into the strip', ...) // reset('/',{kid:'3'}); region/heading Maya chores; strip buttons Leo, Ava; '‹ All' present
test('‹ All returns to calm', ...)
test('waiting chore shows Approve and … once, not in Requests', ...)          // 'Make bed' row has button Approve; Requests has no 'Make bed'
test('non-chore requests show as a Requests group', ...)                      // '30 min screen time' with Approve; its … has Decline
test('waiting chore actions are not inside the row button', ...)            // getByRole('button',{name:/Make bed/}) does not contain the Approve button
test('Reply on a waiting chore keeps the kid in the URL', ...)              // … → Reply → push query {kid:'3',chore:'103'}
test('kid … menu has Bonus, Deduct, View as kid, Open page', ...)
test('?kid=&chore= opens the chore sheet; Esc closes only the chore', ...)
test('old ?chore= link focuses the chore on its kid', ...)                    // reset('/',{chore:'103'}) → replace {kid:'3',chore:'103'}
test('old ?item= link focuses that kid', ...)
test('unknown kid id falls back to calm', ...)                                // reset('/',{kid:'999'}) → replace, query {}
test('focused kid survives a refetch with fewer chores', ...)                // re-resolve api with one chore → still focused, no calm cards
test('strip shows waiting dots and the Needs total', ...)
```

- [ ] **Step 2: Run and confirm FAIL**
- [ ] **Step 3: Implement `needsActions.ts` first** (move `approveOne`, `approveAll`, the decline, send-back and reply flows and the `lock` ref out of `NeedsYouList.tsx`, with no behaviour change; the existing `needsYouList.test.tsx` must stay green). Then implement `KidStrip`, `KidFocus` and the `ChoreRow` change.
- [ ] **Step 4: Run and confirm PASS**: `npx jest tests/v2/today* tests/v2/kidStrip.test.tsx tests/v2/choreRow.test.tsx tests/v2/needsYouList.test.tsx tests/v2/choreOpen.test.tsx tests/v2/trustParent.test.tsx`
- [ ] **Step 5: SS**: `today-kid` at `/?kid=3`, against `declutter-v1.html today-kid`. Also shoot `today-chore` at `/?kid=4&chore=202` (no mockup state; check that it reads as the existing chore sheet inside the focused card).
- [ ] **Step 6: CI gate, then commit** `feat(today): kid focus with strip, in-place chores and requests`

---

### Task 6: Today, Needs you focus (`?focus=needs`)

**Files:**
- Modify: `frontend/src/v2/today/NeedsYouList.tsx` (render `ActionRow`s grouped by kid; stay under 250 lines)
- Modify: `frontend/src/v2/today/TodayPage.tsx` (the Needs strip expands in place)
- Test: create `frontend/tests/v2/todayNeeds.test.tsx`. Update `needsYouList.test.tsx` (it already holds the older-day case moved in Task 4; `kidListNeeds.test.tsx` and `KidList.tsx` are already gone).
- E2E: `frontend/e2e/parent.spec.ts:9-10`, `frontend/e2e/notifications.spec.ts:107`. Check that the selectors still match the strip button and the `region` name `Needs you`.

**Interfaces:**
- Consumes: `areaFocus` (Task 4), `useNeedsActions`, `isChore` (Task 5), `ActionRow`.
- Produces: `NeedsYouList({ items, today }: { items: NeedsItem[]; today?: string })`, with the same props as now.

Behaviour (mockup `today-needs`):
- The strip head stays visible as the open section's header. Tapping it, Back or Esc closes it. The body is a `region` named `Needs you`.
- Top row: `Oldest first, grouped by kid` and `Approve all` (disabled while busy; notes are skipped as today).
- Groups: one per kid (avatar + name), ordered by each group's oldest `submitted_at`. Inside a group, items run oldest first. Items with a null `kid_id` form the last group, titled `A kid`. Items with a null `submitted_at` sort last in their group (and don't set the group's age).
- Each item is an `ActionRow`:
  - The type icon uses the `KIND`/`SPOT` icon and tone, and `iconHelp` from the mockup's `TYN` text: `Needs OK: they marked it done`, `Spot check: take a look before it counts`, `Screen time request: spends points`. Rule: reward → `Reward request: spends points`; note → `Note from a kid`; redo → `Redo: they tried again`; integration → `From an integration: <name> checked it off`.
  - Main `Approve` (a note's main is `Reply`). "…" holds `Send back` and `Reply` for chores, and `Decline` (red, `decline(i)`) for screen-time and reward requests.
  - The status chip that repeated the icon is removed. The older-day chip (an item from an earlier day) stays. Thumbnails and existing sub lines stay.
- Counts (strip, kid card chips, strip dots) come from `useToday`; the bell count comes from `useInbox`. Approve already invalidates both `today` and `inbox`, so every count updates after each action.
- Empty: the existing `All caught up` `EmptyState`. Once the list is empty, closing returns to calm with no strip.

- [ ] **Step 1: Write failing tests**

```ts
test('?focus=needs opens the list in place, grouped by kid, oldest first', ...) // group order Leo (90m), Maya (60m), Ava (15m); within Leo: 'Take out bins' before 'Homework'
test('each row has Approve and … with Send back and Reply', ...)
test('screen time and reward rows keep Decline in …', ...)                    // menuitem 'Decline' → decide approve:false, toast 'Declined'
test('an item from an earlier day keeps its older-day chip', ...)
test('items without a kid group last as A kid', ...)
test('type icon explains itself instead of a status chip', ...)               // no text 'Needs OK' chip; click icon → 'Needs OK: they marked it done'
test('Approve all approves every approvable item', ...)
test('approving the last item shows All caught up and the calm strip goes away', ...)
test('Esc and the strip head close Needs focus', ...)
```

- [ ] **Step 2: Run and confirm FAIL** · **Step 3: Implement** · **Step 4: Run and confirm PASS**: `npx jest tests/v2/today* tests/v2/needsYouList.test.tsx`
- [ ] **Step 5: SS**: `today-needs` at `/?focus=needs`, against `declutter-v1.html today-needs`.
- [ ] **Step 6: CI gate, then commit** `feat(today): Needs you focus with grouped action rows`

---

### Task 7: Kid page

**Files:**
- Modify: `frontend/src/v2/manage/KidDetail.tsx` (rewrite on `DetailHeader` + `FocusArea`; delete `PointsHistory`; under 200 lines)
- Create: `frontend/src/v2/manage/KidRows.tsx` (the `TrustRow`, `DevicesRow`, `ChoresRow`, `SettingsRow` bodies)
- Create: `frontend/src/v2/manage/PointsPop.tsx` (points chip pop-over: last 6 rows from `useKidPoints(id)`, sliced to 6)
- Modify: `frontend/src/v2/manage/TrustSection.tsx` → export `TrustLine({ kid })` (switch + level chip + bar + `n/goal`) and `TrustBody({ kid })` (next level + Change + `SelfApprovedList`). Remove the `#trust` scroll effect; the alias (`kid=K#trust` → `open=trust`, Task 1) handles it.
- Modify: `frontend/src/v2/manage/SelfApprovedList.tsx`: each `Row` becomes an `ActionRow` (icon `threadGlyph(undefined, r.title)` as now, `iconLabel`/`iconHelp` `Approved on their own`, title/sub as now, main = `{ label: "Wasn't done", onClick: onTake }`, no menu). Text and behaviour unchanged.
- Modify: `frontend/src/v2/manage/KidPhonesPanel.tsx` → export `KidPhoneRows({ kid })` (rows only, no panel or heading)
- Modify: `frontend/src/v2/manage/KidEditor.tsx` → export `KidProfileForm({ kid, focusPin, onSaved }: { kid: Kid; focusPin?: boolean; onSaved: () => void })`, with the fields in place as kv inputs and its dirty state. Keep `KidEditor` for the `item=new` add flow. Removing a kid moves to the header "…".
- Modify: `frontend/src/v2/manage/KidsPage.tsx`: replace the `kidParam` effect (lines 60–68) with `useFocusAliases()`; `pick()` must drop `open`, `edit` and `pin`.
- Modify: `frontend/src/v2/manage/KidsList.tsx`: add `ProgressRing` per kid from `useToday` (mockup `klist`).
- Test: create `frontend/tests/v2/kidPage.test.tsx`; update `kidPointsHistory.test.tsx` (now the points pop-over), `trustParent.test.tsx` (also covers `SelfApprovedList`), `kidPhones.test.tsx`, `kidsPageStates.test.tsx`, `bonus.test.tsx`, `manage.test.tsx`, `kidPushPane.test.tsx` and `polish.test.tsx` (both render `<KidEditor kid>`), `happyHour.test.tsx` (its KidDetail placement assertion becomes "KidDetail renders no Happy Hour button"). `kid.test.tsx`/`kidTrust.test.tsx` are kid-app tests: leave them alone unless they fail.
- E2E: `frontend/e2e/parent.spec.ts:81` onward. Update the kid page selectors.

**Interfaces:**
- Consumes: `useFocusParam`, `useFocusAliases`, `DetailHeader`, `SummaryRow`, `FocusArea`, `InfoPop`, `MoreMenu`, `SaveBar`, `useDiscardGuard`, `ProgressRing`.
- Produces:
  ```ts
  const rows = useFocusParam('open', { clears: ['edit', 'pin'], valid: id => ['trust', 'devices', 'chores', 'settings'].includes(id) })
  const edit = useFocusParam('edit')   // '1' = Settings profile in edit mode (second level)
  export function KidDetail({ kid, onDeleted }: { kid: Kid; onDeleted: () => void })  // focusPin is now from query pin === '1'
  ```

Layout (mockups `kid-calm`, `kid-trust`, `kid-edit`):
- `DetailHeader`:
  - media: avatar `pk-av` xl. title: name.
  - chips: an accent points chip `<N> pts`, which is an `InfoPop` target. Its pop-over reads `Last 6 changes`, with each row `dayTime(at) · label` and `+N` or `−N`. Then `Level N`.
  - main: `Edit` (`id="kid-act-edit"`), one navigation: `rows.openTo('settings', { extra: { edit: '1' } })`. When already editing it is a no-op.
  - menu: `Bonus`, `Deduct` (open `PointsForm` inline under the header, as now), `View as kid`, then a divider and `Remove <Name>` (red, `ConfirmDelete`, `useDeleteKid`).
  - No `HappyHourButton`.
- Rows:
  - `trust`: summary `N approved on their own` (count of `SelfApprovedList` rows), or `Off`. line2: `TrustLine`. Body: `TrustBody`.
  - `devices`: summary `N devices · all open`, `N open · M locked`, or `No devices yet`. Body: device rows (name + chip, as today), then `KidPhoneRows`, then a last row `+ Add a phone` with `InfoPop` `No phones yet. Not every kid has one, and that's fine.`
  - `chores`: summary `N daily` when every active assignment is daily, otherwise `N chores`. Body: one row per chore (glyph, title, `schedules(c, kid.id)` as the sub), each a `Link` to `/kids?section=chores&item=<id>`, then `Edit in Chores ›`.
  - `settings`: summary `Celebrations: <Full|Small|Off|Mode default>`. Body: a `Profile` kv list (Name, Age group, PIN `•••• set` / `Not set`, Next reward `N pts away`, read-only), then `Celebrations` (`KidCelebrations`, with its help in `InfoPop`). With `edit=1`, the Profile kv rows become `KidProfileForm` inputs in place, with a `SaveBar` (Save / Cancel). Next reward stays read-only (no API field). Closing the row, Cancel, picking another kid, or browser Back while dirty goes through `useDiscardGuard` (its `beforePopState` covers Back).
- Removed: the Points history card, the Profile `Points` row, the `Chores assigned` tag card, the `pk-grid` cards.
- Old links: `/kids?section=kids&kid=7&pin=1` → `item=7&open=settings&edit=1&pin=1`, and `KidProfileForm` focuses the PIN. `#trust` → `open=trust`.

- [ ] **Step 1: Write failing tests (`kidPage.test.tsx`)**

```ts
test('calm: header with one points chip, Level, Edit, … and four rows', ...)  // rows Trust, Devices, Chores, Settings; no 'Points history'; text '240 pts' appears once
test('points chip pop-over shows the last 6 changes', ...)                   // 8 rows from api → 6 shown
test('Trust row: switch on the calm line, list in the body', ...)
test('Devices row merges phones and ends with + Add a phone', ...)
test('Chores row: "6 daily" and each chore links to its editor', ...)        // href '/kids?section=chores&item=400'
test('Edit turns Profile into inputs in place with a Save bar', ...)         // one push → query {open:'settings',edit:'1'}; textbox Name; no read-only 'Name' kv duplicate
test('Cancel with changes asks Discard changes?', ...)
test('browser Back with changes asks Discard changes?', ...)                 // fakeRouter.beforePopState handler returns false + sheet
test('self-approved rows are action rows', ...)                              // open=trust → take-back button still works
test('… menu: Bonus, Deduct, View as kid, Remove', ...)
test('no Happy Hour button on the kid page', ...)
test('old &kid=&pin=1 link opens Settings in edit with PIN focused', ...)
test('old #trust link opens Trust', ...)
test('picking another kid drops open and edit', ...)
```

- [ ] **Step 2: Run and confirm FAIL** · **Step 3: Implement** · **Step 4: Run and confirm PASS**: `npx jest tests/v2/kid*.test.tsx tests/v2/trustParent.test.tsx tests/v2/bonus.test.tsx tests/v2/manage.test.tsx tests/v2/polish.test.tsx tests/v2/happyHour.test.tsx tests/v2/cssCoverage.test.ts`
- [ ] **Step 5: SS**:
  - `kid-calm` at `/kids?section=kids&item=3`, against `declutter-v1.html kid-calm`.
  - `kid-trust` at `…&open=trust`, against `kid-trust`.
  - `kid-edit` at `…&open=settings&edit=1`, against `kid-edit`.
- [ ] **Step 6: CI gate including `npm run test:standalone`, then commit** `feat(kids): calm kid page with summary rows and in-place edit`

---

### Task 8: Chore editor

**Files:**
- Modify: `frontend/src/v2/manage/ChoreDetail.tsx` (keep the state and save logic; replace the header, cards and `pk-foot`; under 300 lines)
- Create: `frontend/src/v2/manage/ChoreRows.tsx` (`BasicsBody`, `OptionsBody`)
- Modify: `frontend/src/v2/manage/choreMeta.ts`. Add (the existing `choreLine(c: LibChore)` used by `ChoresList.tsx:42` stays untouched; `Step` comes in with `import type { Step } from './ChoreSteps'` to avoid a runtime cycle):
  ```ts
  export const stepsSummary = (steps: Step[]): string        // 'No steps' | '1 step' | '3 steps, in order' | '3 steps, any order' | '3 steps, some in order'
  export const optionsOn = (o: { due: string; photo: boolean; check: boolean }): number
  export const choreHeadLine = (typeName: string | undefined, points: number, when: string, doers: string): string // 'School · 30 pts · daily · Maya, Leo'
  ```
- Modify: `frontend/src/v2/manage/ChoreSteps.tsx`: move the step legend and the `MAX_STEPS` hint into an `InfoPop` (`label="How steps work"`). The legend text is from the mockup `stepinfo`, ending `N of 20 steps used.`
- Modify: `frontend/src/v2/manage/AssignmentForm.tsx`: replace the inline kid pills (lines ~86–95) with `KidPicker label="Assign to"` (pills, multi). Move the mode hints into an `InfoPop` (`About sharing`).
- Modify: `frontend/src/v2/manage/KidsPage.tsx`: keep the chore editor's guard (from `onGuard`, below) in a `useRef`; for the chores section, `pick(x)` becomes `guardRef.current ? guardRef.current(() => pick(x)) : pick(x)`.
- Test: create `frontend/tests/v2/choreEditor.test.tsx`; update `choreDetail.test.tsx`, `choreLibrary.test.tsx`, `choreTypePanel.test.tsx`
- E2E: `frontend/e2e/chore-model.spec.ts:49,53`, `parent.spec.ts:45-60` (`Save chore` now lives in the Save bar; open the needed rows first via `&open=`). Any region selector for Who and when uses the exact title `Who & when`.

**Interfaces:**
- Consumes: `DetailHeader`, `SummaryRow`, `FocusArea`, `InfoPop`, `SaveBar`, `useDiscardGuard`, `KidPicker`, `useFocusParam` (with `openTo(id, { replace: true })`).
- Produces: `ChoreDetail({ kids, chore, onSelect, onGuard })`. The existing props are unchanged; new optional `onGuard?: (g: ((go: () => void) => void) | null) => void`, called with `guard` on mount/when it changes and with `null` on unmount. Internally `useFocusParam('open', { valid: id => ['basics', 'steps', 'who', 'opts'].includes(id) })`. For `item=new`, Basics opens on mount with `open.openTo('basics', { replace: true })` (no history entry).

Layout (mockups `chore-calm`, `chore-steps`):
- `DetailHeader`:
  - media: the type glyph tile. title: the chore name. sub: `choreHeadLine(...)`.
  - chips: the type chip `<Type>` as an `InfoPop` target. Its pop-over shows `Notes kids can send` / `From the <Type> type. Kids pick one when they're stuck.`, the note chips, a divider and `Edit <Type> type` (opens `ChoreTypePanel`). The `Notes` card is removed.
  - menu: `Duplicate`, then a divider and `Delete chore` (red, existing `ConfirmDelete`).
- Rows:
  - `basics` `Basics`: summary `<Type> · N pts`. Body: name, `ChoreTypePicker`, points.
  - `steps`: title `Steps` with `InfoPop`, summary `stepsSummary`. Body: `ChoreSteps`.
  - `who` `Who & when`: summary `<names> · <schedules>` or `Nobody yet`. Body: `WhoWhen`, or the hint for a new chore.
  - `opts` `Options`: summary `N on`. Body: Due by (time), Needs a photo (switch + `InfoPop` from mockup `photoinfo`), Always check (switch + `InfoPop` from `checkinfo`).
- `SaveBar saveLabel="Save chore"` replaces `pk-foot`. `onCancel` → existing `discard()` for a saved chore; for a new chore it is `drafts.delete(key); onSelect(null)`. The `Unsaved changes (restored)` note passes as `note`.
- Leaving the chore (another list item through `onGuard`, Back to the list on phone, or browser Back via `beforePopState`) while dirty uses `guard`. Choosing `Discard` in the sheet deletes `drafts[key]` before leaving, so the prompt's "won't be saved" is true. Drafts still survive an unmount that did not go through the guard (existing `drafts` map).

- [ ] **Step 1: Write failing tests**

```ts
test('calm: header line, four rows with summaries, no Save until a change', ...) // 'School · 30 pts · daily · Maya, Leo'; 'Homework' steps '3 steps, in order'; options '1 on'; no region 'Unsaved changes'
test('Steps opens as the form; legend lives in one (i)', ...)                  // &open=steps; button 'How steps work' → '3 of 20 steps used.'
test('type chip pop-over holds the notes kids can send', ...)
test('Duplicate and Delete are only in …', ...)
test('editing shows the Save bar; Save chore sends chore and assignments once', ...)
test('picking another chore while dirty asks Discard changes?', ...)   // via KidsPage + onGuard
test('Discard drops the draft', ...)                                   // dirty → pick other → Discard → come back: no restored note, original values
test('new chore opens Basics', ...)                                    // replace, no push
test('Who & when uses KidPicker', ...)                                          // group 'Assign to' pills aria-pressed
```

- [ ] **Step 2: Run and confirm FAIL** · **Step 3: Implement** · **Step 4: Run and confirm PASS**: `npx jest tests/v2/chore*.test.tsx tests/v2/kidsPageStates.test.tsx tests/v2/manage.test.tsx`
- [ ] **Step 5: SS**:
  - `chore-calm` at `/kids?section=chores&item=404`, against `declutter-v2.html chore-calm`.
  - `chore-steps` at `…&open=steps`, against `chore-steps`.
  - Desktop keeps the chores list on the left (spec decision).
- [ ] **Step 6: CI gate, then commit** `feat(chores): calm chore editor with summary rows and save bar`

---

### Task 9: Device detail

**Files:**
- Modify: `frontend/src/v2/manage/DeviceDetail.tsx` (header + rows; remove `SegmentedControl` tabs; under 200 lines)
- Create: `frontend/src/v2/manage/DeviceRows.tsx` (`DetailsBody`, `ActivityLine`)
- Modify: `frontend/src/v2/manage/OnlineWeek.tsx`: export `WeekBars({ device }: { device: Device })` (7 mini bars, the online fraction per day, for the Activity calm line). The existing hourly `OnlineWeek` content moves into the Activity line's `InfoPop` (`label="Online by hour"`).
- Modify: `frontend/src/v2/manage/DevicesPage.tsx`: `pick()` and `setTab()` drop `open`.
- Modify: `frontend/src/v2/manage/DeviceActivity.tsx`: each alert `<li className="da-al">` becomes an `ActionRow` (icon/tone from `eventText(e)` `t.icon`/`t.sev`, `iconLabel` = the severity name, title `t.title`, sub `whenLabel · t.sub`). The first action from `actions(e)` is `main`; the rest go in its "…" with the same labels and handlers. `data-reviewed` styling stays.
- Modify: `frontend/src/v2/manage/RuleEditor.tsx` (lines ~11, ~159): replace `KidPills` with `KidPicker` (pills, multi, same label and values as strings), so nothing imports `KidPills`.
- Delete: `frontend/src/v2/manage/KidPills.tsx`, in this commit, after `grep -rn KidPills frontend/src frontend/tests` shows only DeviceDetail and RuleEditor (both migrated here).
- Test: create `frontend/tests/v2/deviceDetail.test.tsx`; update `deviceOverview.test.tsx`, `devices.test.tsx`, `devicesEdge.test.tsx`, `deviceActivity.test.tsx` (alert actions: first is a button, the rest are `menuitem`s), `manage.test.tsx` (renders DeviceDetail), `settingsVisibility.test.tsx` (its Always allowed case now opens `&open=details` first), `ruleEditor.test.tsx` (kid pills → KidPicker group). Leave `segmentedTabs.test.tsx` alone.
- E2E: `frontend/e2e/devices-hours.spec.ts:110,114`. `getByRole('tab', { name: 'Activity' })` becomes `getByRole('button', { name: /^Activity/ })`. `devices-hours.spec.ts:84-86`: the `Right now` region now exists only after opening that row; click `getByRole('button', { name: /^Right now/ })` first, then keep `getByRole('region', { name: 'Right now' })`.

**Interfaces:**
- Consumes: `DetailHeader`, `StatusChip`, `SummaryRow`, `FocusArea`, `InfoPop`, `KidPicker`, `useFocusParam`.
- Produces: `DeviceDetail` with unchanged props. Uses `useFocusParam('open', { valid: id => ['now', 'details', 'network', 'activity'].includes(id) })`.

Layout (mockups `device-calm`, `device-activity`):
- Status chip, exactly one of the spec's three states:
  - `device.resisting` → red `Got around the lock`. Pop-over: `See activity ›` (`openTo('activity')`) and `Lock now`.
  - Else, the device is locked (`ovLive?.action === 'lock'`, or `!device.online` for a non-exempt owned device) → grey `Locked`. Pop-over: the override expiry and `Back to schedule`.
  - Else → acc `Open`. Pop-over: the `locks at` time; for an unassigned device, also the existing strict/learning text.
- Unassigned device (`device.status === 'unassigned'`): no extra chip. The Details row summary reads `No owner yet · <groups>`, and Details opens on mount with `open.openTo('details', { replace: true })` when no `open` is set.
- Main action: `Unlock 30 min` when locked, otherwise red `Lock now` (same `onRequestOverride` calls).
- Menu: `Test block`, `Rename` (`openTo('details')` then focus the Name input), `Back to schedule` (only when `ovLive`), then a divider and `Delete` (red).
- Rows:
  - `now` `Right now`: summary `Open · locks at 9:30 PM` / `Locked · until you unlock`. Body: `DeviceRightNow`.
  - `details` `Details`: summary `<owners> · <groups>` (`No owner yet · <groups>` when unassigned). Body: name; owners `KidPicker` (pills, multi, label `Owners`); groups pills; Guest switch; Always allowed switch with `InfoPop`. Keep the shared-device PIN note.
  - `network` `Network`: summary IP in mono. Body: `DeviceNetwork`; the private-MAC help goes into an `InfoPop`.
  - `activity` `Activity`: summary `N alerts this week` / `No alerts this week`. line2 (a sibling of the head button, so its `InfoPop` button is valid markup): `WeekBars` + `Online ~N h a day` + the hourly `InfoPop`. Body: `DeviceActivity` (alerts as `ActionRow`s).
- The lock state appears once: the HeaderChips `Online now` / `Last seen` chip is dropped, and `Last seen` moves into the Right now body.

- [ ] **Step 1: Write failing tests**

```ts
test('one status chip and one main action', ...)        // Open + 'Lock now'; locked device → Locked + 'Unlock 30 min'; lock words appear once
test('got around the lock chip pop-over links to Activity', ...)
test('… has Test block, Rename, Delete; Back to schedule only with an override', ...)
test('four rows with summaries; Activity line has week bars', ...)
test('owners use KidPicker and save on change with Saved toast', ...)
test('unknown open value shows calm', ...)               // reset({item:'12',open:'bogus'}) → replace, no region open
test('unassigned device opens Details by default', ...)  // replace, no push; chip is Open (no 4th chip); Details summary starts 'No owner yet'
test('alerts are action rows with extra actions in …', ...)
```

- [ ] **Step 2: Run and confirm FAIL** · **Step 3: Implement** · **Step 4: Run and confirm PASS**: `npx jest tests/v2/device*.test.tsx tests/v2/devices*.test.tsx tests/v2/manage.test.tsx tests/v2/settingsVisibility.test.tsx tests/v2/ruleEditor.test.tsx`, then `grep -rn KidPills frontend/src frontend/tests` returns nothing.
- [ ] **Step 5: SS**:
  - `device-calm` at `/devices?item=12`, against `declutter-v2.html device-calm`.
  - `device-activity` at `/devices?item=12&open=activity`, against `device-activity`.
- [ ] **Step 6: CI gate, then commit** `feat(devices): calm device detail with one status chip`

---

### Task 10: Group detail

**Files:**
- Modify: `frontend/src/v2/manage/GroupDetail.tsx` (existing groups: header + rows; the new-group form stays as is; under 250 lines)
- Create: `frontend/src/v2/manage/GroupRows.tsx`
- Test: create `frontend/tests/v2/groupDetail.test.tsx`; update the `manage.test.tsx` group cases (find them with `grep -n "GroupDetail\|tab: 'groups'\|/groups" frontend/tests/v2/manage.test.tsx`; do not trust line numbers)

**Interfaces:**
- Consumes: as Task 9, plus `GlyphPicker`, `GroupStats`, `HoursTimeline`, `GROUP_ICONS`.
- Produces: `GroupDetail` with unchanged props. Uses `useFocusParam('open', { valid: id => ['gdev', 'gset', 'ghours'].includes(id) })`.

Layout (mockups `group-calm`, `group-devices`):
- `DetailHeader`:
  - media: the icon tile. title: the name.
  - status: grey `N open · M locked`. Its pop-over holds `GroupStats` and `Owners: <names>`.
  - main: red `Lock group`.
  - menu: `Unlock 30 min`, `Back to schedule` (when an override is live), then a divider and `Delete group` (red).
- Rows:
  - `gdev` `Devices`: summary `N of M devices`. line2: member names (`.p-kn`). Body: every device as a row with name, owner sub and an `In group` switch that saves on change.
  - `gset` `Settings`: summary `Chores lock · N pts` (or `Free` when chore lock is off). Body: name (save on blur); Icon row whose tile button opens `GlyphPicker` in an `InfoPop` (`Change icon`); `Lock with the kids' chores` switch + `InfoPop`; `Screen time price` + `InfoPop`, autosaved when valid.
  - `ghours` `Hours`: summary `N rules · next lock <time>`. Body: one `HoursTimeline` line per rule, then `Edit in Settings › Hours ›` → `/settings?section=hours`.

- [ ] **Step 1: Write failing tests**

```ts
test('header: one status chip with stats pop-over and Lock group', ...)
test('Devices row: "2 of 9 devices" opens a switch list that saves on change', ...)
test('icon picker lives in a pop-over', ...)
test('price autosaves only when valid', ...)          // '0' → hint, no api call; '25' blur → PATCH once
test('Delete only in …', ...)
```

- [ ] **Step 2: Run and confirm FAIL** · **Step 3: Implement** · **Step 4: Run and confirm PASS**
- [ ] **Step 5: SS**:
  - `group-calm` at `/devices?tab=groups&item=1`, against `declutter-v2.html group-calm`.
  - `group-devices` at `…&open=gdev`, against `group-devices`.
- [ ] **Step 6: CI gate, then commit** `feat(devices): calm group detail`

---

### Task 11: Settings › Notifications

**Files:**
- Modify: `frontend/src/v2/manage/NotificationsPane.tsx` (places as summary rows; "When and how" rows; drop the `Fold`)
- Modify: `frontend/src/v2/manage/PlaceCard.tsx` → export `PlaceDetail({ place, events })` (URL code box + Test, event chips, Edit, `Delete place` with confirm; named `PlaceDetail` because `useNotify` already exports a `PlaceBody` type). The place switch becomes the row `aside`.
- Modify: `frontend/src/v2/manage/KidPushPane.tsx` → export `IphoneBody()` (relay switch + per-kid ntfy QR; its help moves into one `InfoPop`) and `iphoneSummary(): string` (`Instant (relay)` / `Late (no relay)`)
- Modify: `frontend/src/v2/manage/SettingsPage.tsx:76-81`: the notifications section renders only `NotificationsPane` (it now contains the iPhones row)
- Test: create `frontend/tests/v2/notifySettings.test.tsx`; update `notificationsPane.test.tsx`, `kidPushPane.test.tsx`, `settings.test.tsx`, `settingsVisibility.test.tsx` (its Advanced-fold case now opens the `address` row)

**Interfaces:**
- Produces: `useFocusParam('open', { valid: id => /^place-\d+$/.test(id) || ['quiet', 'iphones', 'address'].includes(id) })`.

Layout (mockups `notif-calm`, `notif-place`):
- Header: `Notifications`, sub `Pings to the chat apps your family already uses.`, main `+ Add a place`.
- `Places` (`.p-sec-h`): one `SummaryRow id="place-<id>"` per place. Title is the name (`.p-kn`), summary `N of M events` (M = `settings.events.length`), and `aside` is a Mantine `Switch` (save on change, `Saved` toast). Body: `PlaceDetail`.
- `When and how`:
  - `quiet` `Quiet hours`, shown only when at least one place exists (as today; keep the existing test for that): aside switch; summary `10 PM – 7 AM` or `Off`. Body: From/To times, saved as a pair only when both are set (otherwise the hint `Pick both times`), and `Security alerts still send`.
  - `iphones` `iPhones` + `InfoPop` `How iPhone alerts work` (all the reaching-iPhones help merged): summary `iphoneSummary()`. Body: `IphoneBody`.
  - `address` `App address`: summary = the host, or `Default (<fallback>)`. Body: the existing `AddressCard` field. These were the old Advanced fold's remaining items (only App address, from the code).
- Empty places: the existing `EmptyState` stays above `When and how`.

- [ ] **Step 1: Write failing tests**

```ts
test('one row per place with switch and "N of M events"', ...)
test('focusing a place shows event chips, Test and Delete', ...)
test('place switch saves without opening the row', ...)
test('Quiet hours saves the pair only when both times are set', ...)
test('iPhone help is one row with one (i)', ...)
test('no Advanced fold; App address is a row', ...)
test('Quiet hours row is hidden with no places', ...)
```

- [ ] **Step 2: Run and confirm FAIL** · **Step 3: Implement** · **Step 4: Run and confirm PASS**: `npx jest tests/v2/notif*.test.tsx tests/v2/kidPushPane.test.tsx tests/v2/settings*.test.tsx`
- [ ] **Step 5: SS**:
  - `notif-calm` at `/settings?section=notifications`, against `declutter-v2.html notif-calm`.
  - `notif-place` at `…&open=place-1`, against `notif-place`.
  - Desktop keeps the Settings list on the left.
- [ ] **Step 6: CI gate, then commit** `feat(settings): calm notification settings`

---

### Task 12: Rewards › Screen time

**Files:**
- Modify: `frontend/src/v2/manage/ScreenTimePane.tsx` (header + Rules rows + Kids rows; the `HowItWorks` Save button goes; under 200 lines)
- Create: `frontend/src/v2/manage/ScreenRules.tsx` (six rule rows, autosave)
- Create: `frontend/src/v2/manage/ScreenKids.tsx` (per-kid rows; replaces `ScreenLimits` and `LimitForm`)
- Modify: `frontend/src/v2/manage/ScreenLimits.tsx`: delete the `ScreenLimits` and `LimitForm` components (no dead code); the file keeps only `MaxOptions` and `limitText`, still exported.
- Test: create `frontend/tests/v2/screenTime.test.tsx`; update `screenBank.test.tsx`, `rewardsPanes.test.tsx`, `kidsRewards.test.tsx`, `settingsVisibility.test.tsx` (renders `ScreenTimePane`)

**Interfaces:**
- Consumes: `useScreenTime`, `usePatchScreenTime` (the existing patch hook in `hooks/useScreenTime.ts`), `useSetLimit`, `useDeleteLimit`.
- Produces: `useFocusParam('open', { valid: id => ['price', 'max', 'save', 'gprice', 'auto', 'hrs'].includes(id) || /^kid-\d+$/.test(id) })`.

Layout (mockups `screen-calm`, `screen-kid`):
- Header: `Screen time`, sub `Kids spend points on extra minutes. Changes save as you go.`, main `On` switch (`Kids can buy extra minutes`).
- `Rules`:
  - `price` `Price`: summary `N pts = 15 min`. Body: the price field, then the hint with the "What points buy" content (the old card is removed).
  - `max` `Max per day`: summary `N min` or `No max`. Body: select `MaxOptions`.
  - `save` `Save unused time`: summary `On · up to N min` / `Off`. Body: switch + `Save up to`. The pair `rollover` + `bank_cap` saves only when the cap is ≥ the daily max or empty; otherwise the hint shows and nothing is sent.
  - `gprice` `Prices per device group`: summary `On` / `Off`. Body: switch, hint, `Set group prices ›` → `/devices?tab=groups`.
  - `auto` `Approve automatically`: summary `On` / `Off`. Body: switch + hint.
  - `hrs` `Only during allowed hours`: summary `On` / `Off`. Body: switch + hint.
- `Kids` heading, right-aligned `bought today · resets <time>`. One row `kid-<id>` per kid:
  - Icon: avatar. Title: name in `.p-kn`. Summary: `N min/day` or `Family max`.
  - line2: bought-today bar + `B/C min today`.
  - Body: `<pts> pts · up to … · saved …`, then `Daily limit (min)` and `Not allowed until`, autosaved as a pair when valid (`intError` rules as now), then `Remove limit` when set.
- Text fields autosave on blur, switches and selects on change, each with the `Saved` toast.

- [ ] **Step 1: Write failing tests**

```ts
test('one line per rule with its summary', ...)
test('a switch saves on change with Saved', ...)
test('price autosaves on blur when valid, hint when not', ...)
test('save-up-to cap below the daily max shows a hint and sends nothing', ...)
test('kid row opens its limit in place and autosaves the pair', ...)
test('screen time kid names use p-kn', ...)                           // getByText('Ava') has class 'p-kn' (the CSS rule itself is pinned in Task 2)
test('no What points buy card; its content is in Price', ...)
```

- [ ] **Step 2: Run and confirm FAIL** · **Step 3: Implement** · **Step 4: Run and confirm PASS**: `npx jest tests/v2/screen*.test.tsx tests/v2/rewardsPanes.test.tsx tests/v2/kidsRewards.test.tsx tests/v2/settingsVisibility.test.tsx`, then `grep -rn "<ScreenLimits\|LimitForm" frontend/src frontend/tests` returns nothing.
- [ ] **Step 5: SS**:
  - `screen-calm` at `/kids?section=rewards&item=screen`, against `declutter-v2.html screen-calm`.
  - `screen-kid` at `…&open=kid-5`, against `screen-kid`. Check that "Ava" does not wrap at 390.
- [ ] **Step 6: CI gate, then commit** `feat(rewards): calm screen time rules with autosave` (body: `fix: kid names no longer wrap mid-word`)

---

### Task 13: Setup step 6, devices

**Files:**
- Modify: `frontend/src/v2/setup/StepDevices.tsx` (two summary rows; owner `KidPicker variant="pop" single`)
- Modify: `frontend/src/v2/setup/WizardFrame.tsx` + `wizard.module.css`: on phone (≤767 px) the step bar shows numbers/ticks only, plus the current step's label. On desktop it shows full labels and fits 8 steps at 1280. The choice is made in React with Mantine `useMediaQuery('(max-width: 767px)')` (labels of other steps are not rendered on phone), so jsdom tests with a mocked `matchMedia` can see it; CSS handles layout only.
- Modify: `frontend/src/v2/setup/devices.module.css`
- Modify: `scripts/shots/declutter/shoot.mjs`: optional 6th CLI arg `step=<n>` sets `S.step = n` (imported from `./mock.mjs`) before loading `appPath`; without it `S.step = null`. Stage it with this task's commit.
- Test: update `StepDevices.test.tsx`, `WizardFrame.test.tsx`, `setup.test.tsx`

**Interfaces:**
- Consumes: `SummaryRow`, `FocusArea`, `InfoPop`, `KidPicker` (`variant='pop'`, `single`, `extras=[{ value: 'guest', label: 'Guest (never blocked)', icon: 'shield' }, { value: 'unsure', label: 'Not sure yet', icon: 'close' }]`), `useFocusParam('open', { valid: id => id === 'need' || id === 'done' })`.

Behaviour (mockups `setup-calm`, `setup-need`):
- Live line: `Looking for devices… N found`.
- Rows:
  - `need` `Need an owner`: summary `N left`. line2: the first two names plus `+N more`, or `All devices have an owner`.
  - `done` `Done`: summary `N`.
- Each device row shows: type icon, name (`.p-kn`), `<maker> · <ip>` in mono, and the owner pop button (`Owner ▾`, or the owner's name).
  - Picking a kid → `{ status: 'assigned', owner_ids: [id] }`.
  - `guest` → `{ status: 'guest', owner_ids: [] }`.
  - `unsure` → `{ status: 'unassigned', owner_ids: [] }`.
  - A device with an owner or Guest moves to Done at the next refetch.
- One tip line `Not seeing a device, or one keeps changing?` with `More` (`InfoPop`), holding the mockup `notseen` text. The private-MAC count comes from `isPrivateMac`. The per-row `Private MAC` chip is removed.

- [ ] **Step 1: Write failing tests**

```ts
test('devices split into Need an owner · N left and Done · N', ...)
test('one owner pop-over per device: kids, Guest, Not sure yet', ...)
test('picking an owner sends one PATCH with that kid', ...)
test('private address help is one pop-over', ...)
test('phone step bar shows the current label only', ...)   // matchMedia phone → only 'Devices' label text visible in the steps nav
```

- [ ] **Step 2: Run and confirm FAIL** · **Step 3: Implement** · **Step 4: Run and confirm PASS**
- [ ] **Step 5: SS**:
  - `setup-calm`: `node scripts/shots/declutter/shoot.mjs frontend/e2e-artifacts/declutter setup-calm /setup declutter-v2.html setup-calm step=6`.
  - `setup-need` at `/setup?open=need` (also `step=6`), against `setup-need`.
- [ ] **Step 6: CI gate, then commit** `feat(setup): calm device step with owner pop-overs` (body: `fix: step bar no longer cuts labels on phone`). Stage the source and test files by name plus `scripts/shots/declutter/shoot.mjs`.

---

### Task 14: Custom badges

**Files:**
- Modify: `frontend/src/v2/manage/BadgesCustom.tsx` (one-line list of `SummaryRow`s; focus param `pick`)
- Modify: `frontend/src/v2/manage/BadgeDetail.tsx` (opens with a `DetailHeader`: media = the badge icon tile, title = name, sub = description, main = `Award`, menu = `Delete badge` (red, existing confirm). Then the editor body in place: name + description in two columns, Icon row whose tile opens `GlyphPicker` in an `InfoPop`, `Tiers so far`; `SaveBar saveLabel="Save badge"`; Delete lives only in the header "…")
- Modify: `AwardPanel` in `BadgesCustom.tsx` (shown only after tapping `Award`; uses `KidPicker single`)
- Modify: `frontend/src/v2/manage/KidsPage.tsx`: stop passing `pick`/`onPick` to `BadgesCustom` (`pickIn('custom')`); `BadgesCustom` reads `pick` from the URL itself.
- Test: update `badgesPanes.test.tsx`, `kidsPageStates.test.tsx` (if it renders custom badges); create `frontend/tests/v2/customBadges.test.tsx`

**Interfaces:**
- Produces: `BadgesCustom()` with no `pick`/`onPick` props. Inside: `useFocusParam('pick', { valid: list ? id => id === 'new' || list.some(b => String(b.id) === id) : undefined })` (undefined while the list loads, so `?pick=` deep links survive). `+ New` calls `pick.openTo('new')`.
- Summary per badge: from `useBadgeOverview()` tiers for `custom:<id>`, as `<Kid> <TierName>` joined with `, `, or `Not awarded yet`. Tier names are the capitalised `TIER_NAMES` entries from `src/v2/tiers.ts`; check the index base against how `BadgeCard` reads `tiers`.

Layout (mockups `badges-calm`, `badges-edit`):
- Header: `Custom badges`, sub `Each award moves a kid up a tier.`, main `+ New`.
- Rows: tile icon, name, summary. The focused body is `BadgeDetail`: its `DetailHeader` (`Award` + "…" with `Delete badge`), then the editor. After `Award` is tapped: the award form (Award to `KidPicker single`, `<Kid> gets <Tier>`, optional note, `Award <Name>`).
- `pick=new` shows a new row at the top, open.
- Desktop keeps the badges nav on the left.

- [ ] **Step 1: Write failing tests**

```ts
test('one line per badge with who has it', ...)
test('focusing a badge opens its editor in place', ...)
test('icon grid is in a pop-over', ...)
test('award form appears only after tapping Award', ...)
test('Save bar only after a change; Delete only in …', ...)
test('?pick= deep link survives the list loading', ...)                  // reset({section:'badges',item:'custom',pick:'1'}); api pending → no replace; resolves → editor open
test('editor has a header with Award and …', ...)                       // heading 'Kindness'; button 'Award'; header … menu (menuLabel 'More for Kindness') → menuitem 'Delete badge'
```

- [ ] **Step 2: Run and confirm FAIL** · **Step 3: Implement** · **Step 4: Run and confirm PASS**: `npx jest tests/v2/badge*.test.tsx tests/v2/customBadges.test.tsx tests/v2/kidsPageStates.test.tsx`
- [ ] **Step 5: SS**:
  - `badges-calm` at `/kids?section=badges&item=custom`, against `declutter-v2.html badges-calm`.
  - `badges-edit` at `…&pick=<first id>`, against `badges-edit`.
- [ ] **Step 6: CI gate, then commit** `feat(badges): calm custom badges with in-place editor`

---

### Task 15: Cross-screen navigation check

**Files:**
- Create: `frontend/e2e/declutter-nav.spec.ts` (runs in the CI lab with the real backend and seed, like `parent.spec.ts`)
- Test: same file

The spec's main anti-goal is navigation getting worse. This is one Playwright pass over real routing, at phone size (390×844):

```ts
test('Back closes a section before it leaves the page', ...)   // goto '/', click kid row, page.goBack() → url '/' and still on Today
test('tab bar from a focused section goes to that tab calm', ...) // goto '/kids?section=kids&item=<id>&open=trust' → click Kids tab → url has no 'open' param and no Trust region; then '/?kid=<id>' → click Today tab → url has no 'kid'
test('refresh keeps the focus state', ...)                      // '/kids?section=kids&item=<id>&open=trust' reload → Trust region visible
test('header and tab bar do not move when a section opens', ...) // boundingBox of header and tab bar equal before/after opening
test('old links still land', ...)                               // '/?tab=needs' → url has focus=needs; '/?item=<id>' → kid=<id>
```

- [ ] **Step 1: Write the spec** · **Step 2: Run it locally**: `cd frontend && npx playwright test e2e/declutter-nav.spec.ts`, against a local backend with `lab.sh` if available. Otherwise mark it CI-only in the report. · **Step 3: Fix any failure in the owning component** · **Step 4: Commit** `test(e2e): navigation stays safe with focus states`

---

### Task 16: v3 mockup for setup step 3, notifications inbox, Settings › Family, rewards history — OWNER GATE

**Files:**
- Create: `.superpowers/mockups/declutter-v3.html` (gitignored, not committed)
- Modify (after owner approval): `docs/superpowers/specs/2026-11-08-parent-declutter-design.md` ("Decisions after the builder check": v3 approval and any owner changes). Committed in Step 5.

Build the mockup by copying `declutter-v2.html` (same tokens, chrome, `PRE` presets, `?s=&t=&w=` params, built from the same `srow`, `dhead`, `actRow`, `savebar` helpers). Add these presets, each with a calm state and one focus state:
- `setup3-calm` / `setup3-avatar`: setup step 3 Kids. Added kids as one-line rows. The avatar grid moves into a pop-over on the avatar button.
- `inbox-calm` / `inbox-filter`: Notifications inbox (`components/Bell.tsx` `List page`). Filter chips with true counts, rows as `ActionRow`.
- `family-calm` / `family-points`: Settings › Family (`manage/FamilyCards.tsx`: name, time zone, reset, bedtime, recap, extras, points rules) as summary rows.
- `history-calm` / `history-kid`: Rewards history (`manage/RewardsHistory.tsx`). A totals chip with pop-over, one line per redemption, a filter by kid.

Base the content on the real current screens. Read the four components and use the busy-family mock data. Each summary row says what's inside it (spec anti-goal "Hidden means lost").

- [ ] **Step 1: Read the four components and list every control and fact each one shows today** (the list goes in the task report)
- [ ] **Step 2: Build `declutter-v3.html`** with the 8 presets, light/dark, phone/desktop
- [ ] **Step 3: Shoot all 8 presets × 4** with Playwright `file://` (the mockup half of `shoot.mjs`) and check that nothing overflows 390 px
- [ ] **Step 4: STOP.** Report the file path and the control lists to the controller, who publishes it for the owner. **Do not start Tasks 17–20 until the owner approves v3.**
- [ ] **Step 5: Record the approval** (and any changes the owner asks for) in the spec under "Decisions after the builder check", then commit: `git add docs/superpowers/specs/2026-11-08-parent-declutter-design.md && git commit -m "docs(spec): record v3 approval" -m "<trailer>"`.

---

### Task 17: Setup step 3 (after v3 approval)

**Files:** Modify `frontend/src/v2/setup/StepKids.tsx` and `wizard.module.css`. Test: create `frontend/tests/v2/setupKids.test.tsx` for every new test (`setup.test.tsx` is at 460 lines; only fix existing assertions there, and keep it under 500).
**Interfaces:** Consumes `SummaryRow`, `InfoPop`, `useFocusParam('open')`, and the approved `setup3-*` states.

- [ ] **Step 1: Write failing tests in `setupKids.test.tsx`** for each approved behaviour, at minimum `avatar grid opens from the avatar button in a pop-over` and `added kids show one line each`
- [ ] **Step 2: FAIL** · **Step 3: Implement to the approved mockup** · **Step 4: PASS**
- [ ] **Step 5: SS**: `setup3-calm` / `setup3-avatar` against `declutter-v3.html` (`step=3`)
- [ ] **Step 6: CI gate, then commit** `feat(setup): calm kids step` (stage `setupKids.test.tsx` by name)

### Task 18: Notifications inbox (after v3 approval)

**Files:** Modify `frontend/src/v2/components/Bell.tsx` (the `List` page mode; under 300 lines; split it if it would grow), `bellRules.ts`, `bell.css`. Test: update `bell.test.tsx`, `bellRules.test.ts`.

The audit's "Needs you · 0" was not an app bug: the mock used kinds the backend never sends (`chore_done`, `redemption`). The mock now uses the real kinds (`chore_submitted`, `redemption_request`, commit `302176e0`), which match `NEEDS_KINDS` in `bellRules.ts`. Do not change `isNeedsYou` for it.

- [ ] **Step 1: Write a guard test** in `bell.test.tsx`: `Needs you filter counts pending real kinds`. Items with `pending: true` and kinds `chore_submitted`, `redemption_request`, `chore_submitted` → `Needs you · 3`. It should pass on the current code; it guards the layout change. If it fails, stop and report (do not add mock kinds to `NEEDS_KINDS`).
- [ ] **Step 2: Write failing tests** for each approved `inbox-*` behaviour · **Step 3: Implement the approved layout** · **Step 4: PASS**
- [ ] **Step 5: SS**: `inbox-calm` / `inbox-filter` at `/notifications` · **Step 6: CI gate, then commit** `feat(inbox): calm notifications inbox` (no `fix:` line in the body)

### Task 19: Settings › Family (after v3 approval)

**Files:** Modify `frontend/src/v2/manage/FamilyCards.tsx` (split `FamilyCard` into rows in a new `FamilyRows.tsx`; keep `GifsCard`). Test: update `settings.test.tsx`, `bedtimeSettings.test.tsx`, `settingsVisibility.test.tsx`.
**Interfaces:** `useFocusParam('open', { valid })` with the approved row ids. Single switches autosave. Paired fields (bedtime on + time, early bonus on + cap) follow the pair rule.

- [ ] Steps 1–6 as Task 17: tests per approved behaviour, including `bedtime saves only when the time is set`. SS: `family-calm` / `family-points` at `/settings?section=family`. Commit `feat(settings): calm family settings`.

### Task 20: Rewards history (after v3 approval)

**Files:** Modify `frontend/src/v2/manage/RewardsHistory.tsx`. Keep `historyCsv.ts` and its export action, which moves into "…". Test: update `rewardsPanes.test.tsx`.

- [ ] Steps 1–6 as Task 17: tests per approved behaviour, including `CSV export lives in …`. SS: `history-calm` / `history-kid` at `/kids?section=rewards&item=history`. Commit `feat(rewards): calm rewards history`.

---

### Task 21: Leftover-text sweep and screen-reader pass

**Files:** Any component changed in Tasks 4–20.

- [ ] **Step 1:** `grep -rn "Needs OK\|Points history\|Chores assigned\|Advanced" frontend/src/v2` and check that each remaining hit is intended (kid screens are out of scope).
- [ ] **Step 2:** Write `tests/v2/focusA11y.test.tsx`. It renders Today, Kid, Chore, Device, Group, Notifications, Screen time and Badges, each with one section open via its URL param, and asserts: every element with `[aria-expanded]` (summary row heads, the Today Needs strip, the kid card row buttons, any other expander) is a `<button>`; the expanded ones' `aria-controls` names an element that exists; and every icon-only button has an accessible name. Also render Today with `?focus=needs` so the Needs strip's `aria-controls` target is checked.
- [ ] **Step 3:** Run `npx jest`, `npm run lint`, `npm run type-check`. Expected: all green.
- [ ] **Step 4: Commit** `test(a11y): every summary row expander is labelled`

---

### Task 22: Guide, screenshots and site

**Files:**
- Modify: `docs/guide/03-first-setup.md` (step 6 owners pop-over; step 3 if Task 17 shipped), `docs/guide/04-everyday-use.md` (Today calm / focus, Needs you, Kid page rows, chore editor rows, device rows), `docs/guide/06-troubleshooting.md` (where things moved: points history → points chip; Notes → type chip; Advanced → When and how), `docs/guide/img/SHOTS.md`
- Replace images in `docs/guide/img/`: `today.jpg`, `today-kid.jpg`, `needs-you.jpg`, `setup-devices.jpg`, `devices.jpg`, `group-price.jpg`, `trust-kid.jpg`, `wasnt-done.jpg`, `extras.jpg` (if Task 19 shipped), `happy-hour-start.jpg` (now from the Today "…" menu)
- Replace images in `site/img/`: `today-hero.jpg` (1280×800), `today-parent.jpg` (600 wide), `needs-you.jpg`. Update the alt text in `site/index.html:41,42,98,102` to describe the calm Today and the grouped Needs you.
- Modify: `scripts/build_site.py`, only if a new chapter anchor or image needs registering (check `copy_images()`).

- [ ] **Step 1:** Shoot every listed image with `shoot.mjs` (mocked API, light). `site/img/today-hero.jpg` is declared 1280×800, so shoot it with `DESKTOP_H=800 node scripts/shots/declutter/shoot.mjs …`; the rest use the default 1280×900. Convert to JPEG quality 82: desktop at 1280 wide, phone resized to 600 wide. Use names as in SHOTS.md. Add a SHOTS.md line per retaken file, saying `Retaken <YYYY-MM-DD> for 2.8.0 declutter, mocked API`, with the real date of the shoot (`date +%F`).
- [ ] **Step 2:** Update the guide text. Each moved feature gets one sentence saying where it is now (spec rule "Hidden means lost").
- [ ] **Step 3:** Build and check: `python3 scripts/build_site.py && (python3 -m http.server 8811 --bind 127.0.0.1 --directory site &) && node site/check.mjs http://127.0.0.1:8811`. Expected: no problems listed. Also run `python3 scripts/check-links.py` if it takes no network.
- [ ] **Step 4: Commit** `docs(guide): calm parent screens, new screenshots`

---

### Task 23: Release 2.8.0

**Files** (the same set as the 2.7.0 release commit `dccf5eba`, plus notes):
- Modify: `backend/app/__init__.py` (`2.7.0` → `2.8.0`)
- Modify: `backend/tests/test_health.py` (expected version `2.8.0`)
- Modify: `frontend/package.json` (`"version": "2.8.0"`)
- Modify: `frontend/package-lock.json` (both top-level `version` fields → `2.8.0`; edit by hand, no reinstall)
- Create: `docs/releases/2.8.0.md` in the shape of `docs/releases/2.7.0.md`:
  - Heading: `# 2.8.0: Calm parent screens`.
  - `Changed for every family`: Today opens calm; the Needs you tab became a strip; the kid page has summary rows and in-place edit; chore, device, group, notification, screen time, setup step 6 and custom badges screens open calm; links and the Back button follow focus.
  - `Moved` list (one line each): points history → points chip; Start Happy Hour → Today "…"; chore notes → type chip; Advanced → When and how; Delete → "…".
  - `Fixed`: screen time names wrapping; setup step bar on phone. Nothing about the inbox Needs you count (it was mock data, not an app bug).
  - Guide link to `../guide/04-everyday-use.md`.

- [ ] **Step 1:** `grep -rn "2\.7\.0" backend/app/__init__.py backend/tests/test_health.py frontend/package.json frontend/package-lock.json`, then bump each hit that is the app version.
- [ ] **Step 2: Full CI locally**:
  - Frontend: `cd frontend && npx jest && npm run lint && npm run type-check && npm run test:standalone`.
  - Backend: `cd backend && python -m pytest tests -q`, then from the repo root `ruff check backend blocker examples` and `ruff format --check backend blocker examples`.
  - Expected: all green, and `test_health` passes with 2.8.0.
- [ ] **Step 3: Commit**:
  ```bash
  git add backend/app/__init__.py backend/tests/test_health.py frontend/package.json frontend/package-lock.json docs/releases/2.8.0.md
  git commit -m "chore(release): 2.8.0" -m "<trailer>"
  ```
