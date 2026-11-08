# Parent app declutter: calm, then focus

Status: draft for owner approval, 2026-11-08. Roadmap: next after 2.7.0 "Less parent work" (PR #67). Builds on that branch. Ships as a minor version (2.8.0).

Mockups (owner-approved, binding):
- `.superpowers/mockups/declutter-v1.html`: Today and the Kid page. Owner: "much better, very good".
- `.superpowers/mockups/declutter-v2.html`: v1 plus the chore editor, device and group detail, notification settings, screen time rules, setup step 6 and custom badges. Owner: "good, continue".
- Published copies: v1 https://claude.ai/artifact/LeKpCnvTfDbX3Tw7Zr1Tow, v2 https://claude.ai/artifact/HGSgx4efmu1XC1TsxYvjFJ. The audit that started this is at https://claude.ai/artifact/7CnSapbpCuZ8LL52PppnLh.

## Why

Parents get overwhelmed when a screen shows too much at once (owner). The audit found the busiest parent screens showing 40 to 70 separate items, with the same fact repeated: points three times on the Kid page, progress three times on Today, lock state three times on a device. Some parents will never get past a crowded first screen. The app should feel calm and still be informative.

## Goals (owner)

- Parent screens are "fairly simple, yet informative and to the point".
- Fewer separate items at any one time. Consolidate into shared widgets.
- Expanders and pop-overs keep details handy without clutter. They open on hover on desktop and on tap on phone (my call: hover is not available on phones).
- **Today is the most-used screen.** It gives an overview, the data at a glance, and is clean and organized.
- **Calm, then focus, on every parent screen.** A screen opens calm, as a short summary. Tapping into an area opens it and minimises or hides what is not relevant.
- "This needs to be done well so that navigation is not affected."

## Non-goals

- No feature is removed. Everything that works today stays reachable, at most one tap deeper (my call).
- Kid screens are out of scope (owner: "parent screens").
- No backend or API change, except where a screen needs a count it can't get today (builder to flag).
- No new colours or fonts. The app's theme and the mockups' tokens are binding.

## Anti-goals

- **Navigation gets worse.** Getting lost, a back button that leaves the screen when it should only close a section, or content that jumps around when something opens.
- **Hidden means lost.** A parent can't find a setting they used to see. Each summary row says what's inside it ("3 steps, in order", "4 of 6 events", "2 on").
- **Two copies of the same thing.** A form on top of a read-only copy of the same fields, or a number repeated on one screen.

## The pattern

### Calm state
- A screen opens as a header plus a short list of **summary rows**. Each row has an icon, a name, a one-line summary of what's inside, and a chevron.
- Each fact appears once per screen.
- At most one tip, and only in the calm state.
- Status shows as one chip. Its pop-over holds the details.

### Focus state
- Tapping a summary row opens it in place, and the other rows collapse to one line. On Today, the other kids collapse into an avatar strip at the top (see Today below).
- One section is open at a time.
- An open section scrolls into view if needed. Nothing above it jumps.

### Leaving focus
- Back, Esc, tapping the open section's header, or swiping down on it (phone) returns to the calm state.
- The calm state's scroll position is restored when you return (owner: navigation must not suffer).

### Navigation safety (my calls, from the owner's rule)
- The header and the bottom tab bar never change or move.
- **Focus is in the URL.** Each focus state is a query param on the page (for example `/?kid=maya`, `/?focus=needs`, `/kids?kid=3&open=trust`, `/kids?kid=3&open=settings&edit=1`). Opening a section pushes a browser history entry, so the phone's back button closes the section before it leaves the page. Links and refreshes land on the same state.
- Tapping a tab while focused goes to that tab's calm state.

### Saving (my call, to end today's mix)
- Single switches, chips and pickers save on change and show a short "Saved" toast. This covers devices, groups, notification places, screen time rules and family settings.
- Multi-field forms show a Save bar only after something changes, with Cancel next to it. This covers the chore editor, kid profile and custom badges.
- Leaving a form with unsaved changes asks "Discard changes?" in the app's own confirm sheet.

### Actions
- Each header has one main action and a "…" menu for the rest. Destructive actions (Delete) live only in "…" and keep their existing confirm.
- Each list row has one main button and a "…" for the rest. For example, Needs you rows: Approve, then Send back and Reply.

### Pop-overs
- Explanations and help text move into an (i) pop-over.
- Small secondary data moves into pop-overs too: streak, last active, next reward, lock time, the last 6 point changes, an hourly online chart.
- Pop-overs stay inside the screen at 390 px.
- They close on outside tap or Esc and return focus to what opened them.

## Shared widgets (my call: build once, use everywhere)

| Widget | Used by |
|---|---|
| `SummaryRow`: icon, name, one-line summary, chevron, expands in place | every screen below |
| `FocusArea` / `useFocusParam`: one-open-at-a-time, URL param, history, Esc, scroll restore | every screen below |
| `DetailHeader`: icon/avatar, title, one status chip with a pop-over, one main action, "…" menu | kid, chore, device, group, badge |
| `ActionRow`: one main button plus a "…" menu | Needs you, chore rows, alerts, self-approved list |
| `InfoPop`: (i) or chip pop-over, hover on desktop, tap on phone | everywhere |
| `KidStrip`: avatar strip with waiting-count dots and "‹ All" | Today focus |
| `SaveBar`: shows only when the form is dirty | chore, kid profile, badge |
| `KidPicker`: one kid picker, replacing today's three styles | assignments, owners, award, setup |

## Decisions after the builder check

- **Today's other content is tucked in** (owner).
  - Try cards and the getting-started checklist take turns in the one tip slot, one at a time, checklist first. This keeps the feature-discoverability rule.
  - Integration widgets get one "Add-ons" summary row that opens in place.
  - The online/offline summary becomes one "Devices · 8 online" row.
  - "Start Happy Hour" moves to the Today header's "…" menu. While Happy Hour runs it shows as the chip, whose pop-over has Stop.
- **Desktop keeps the list column** (owner). Device, group, chore, badge and notification pages keep the list on the left, as the Kid page mockup does. Calm and focus happen inside the right-hand pane. On phone, list and detail stay separate screens. Where the v2 mockup draws these pages full width on desktop, this decision wins.
- **Scope** (my call): the 14 busy screens in the audit's ranked table, rows 1–17 except More. The 10 screens the audit calls calm keep their layout, and only swap in shared widgets where that changes nothing visible (for example InfoPop for help text).
- **Busy screens without a mockup** (my call, from the owner's mockups-first rule): setup step 3, the notifications inbox, Settings › Family and rewards history. They get a v3 mockup for the owner after the shared widgets are built and before those screens change. The other screens go ahead in the meantime.
- **Two levels of focus at most** (my call). A section plus one item inside it, for example `/?kid=maya&chore=12`. The item opens as today's chore sheet. Old links (`/?tab=needs`, `/?item=`, `/?chore=`, `/kids?kid=`) keep working through aliases. On the Kid page, the Chores row expands in place to the kid's chore list, and each chore links to the chore editor.
- **Autosave for fields that depend on each other** (my call). A pair of fields, such as a time range or a limit against a budget, saves when the pair is complete and valid. Until then it shows an inline hint and nothing is sent. The backend is unchanged because it already validates the whole update.

## Screens (as in the mockups)

1. **Today, calm.**
   - A Happy Hour chip, only while Happy Hour runs.
   - One "Needs you · N" strip, only when something waits.
   - One row per kid: avatar, "N waiting" badge, progress ring "4 of 6", points. On desktop these are tiles side by side.
   - At most one dismissible tip.
   - The separate Today / Needs you tabs go away.
   - Tapping the avatar opens a details pop-over (streak, last active, next reward, locks at). Tapping the rest of the row focuses that kid.
2. **Today, kid focus** (`?kid=`).
   - The kid's chores open in place. A waiting chore keeps its row and shows Approve plus "…".
   - Requests that aren't chores (screen time, rewards, notes) show as a small Requests group.
   - The kid's actions are "+ Add chore" and a "…" menu: Bonus, Deduct, View as kid, Open page.
   - The other kids collapse into the `KidStrip`.
   - A waiting chore appears once, not also in a separate list.
3. **Today, Needs you focus** (`?focus=needs`).
   - All waiting items, grouped by kid, oldest first. Each row is an `ActionRow` with Approve plus "…" (Send back, Reply).
   - "Approve all" sits at the top.
   - No status chip that repeats the icon. Tapping or hovering the type icon explains it.
   - Counts update everywhere as items clear.
4. **Kid page.**
   - Header: avatar, name, one points chip, Level, Edit, "…". The points chip's pop-over shows the last 6 point changes; the Points history card and the Profile "Points" row go away.
   - Summary rows:
     - Trust, as approved in 2.7.0: switch, level, progress, "N approved on their own ›".
     - Devices: merged with Phones and tablets; "+ Add a phone" is the last row.
     - Chores: "6 daily".
     - Settings: profile and Celebrations.
   - Edit turns the Profile rows into inputs in place. The form never sits on top of a read-only copy.
   - Happy Hour shows only on Today, not on the Kid page.
5. **Chore editor.**
   - Header with the one-line summary ("School · 30 pts · daily · Maya, Leo"). Duplicate and Delete go in "…".
   - Rows: Basics, Steps ("3 steps, in order"), Who & when, Options (Due by, Needs a photo, Always check, shown as "2 on").
   - The step legend and limits go in one (i). The notes kids can send go in a pop-over on the type chip.
6. **Device detail.**
   - One status chip: Open, Locked or Got around the lock. Its pop-over holds the follow-ups.
   - One main action: Lock now, or Unlock 30 min when locked. The "…" menu holds Test block, Rename, Delete and Back to schedule.
   - Rows: Right now, Details, Network, Activity (with a mini week bar; its hourly chart is a pop-over).
   - Lock state appears once.
7. **Group detail.**
   - Same header as a device. The status pop-over holds the stats and owners.
   - Devices row ("2 of 9 devices") opens to a switch list. Settings has the icon picker in a pop-over. Hours is its own row.
8. **Settings › Notifications.**
   - One row per place: name, "N of M events", switch. Focusing a place shows its event chips, URL with Test, and Delete.
   - Quiet hours is one row. All help about reaching iPhones is merged into one row with (i).
   - The old Advanced fold's remaining items go into a "When and how" row. The builder lists them from the code; they were not in the audit screenshots.
9. **Rewards › Screen time.**
   - One line per rule. One row per kid with a bought-today bar; it opens in place.
   - Autosave. Names never wrap mid-word (fixes "Av / a").
   - "What points buy" folds into the Price row.
10. **Setup step 6, devices.**
    - Devices split into "Need an owner · N left" and "Done · N". Each device gets one owner pop-over (kids, Guest, Not sure yet) instead of 4 buttons; picking an owner moves it to Done.
    - The step bar fits at 390 px: compact on phone, full labels on desktop.
    - The private-address explanation is one pop-over.
11. **Custom badges.**
    - A one-line list of badges. Focusing a badge opens its editor in place, with the icon grid in a pop-over.
    - The award form appears only after tapping Award.

**The remaining busy screens follow the same pattern** with the shared widgets: setup step 3 (avatar grid in a pop-over), the notifications inbox, Settings › Family and rewards history. They wait for the v3 mockup and owner approval (see the decisions above).

## Bugs folded in (found by the audit)

- Screen time per-kid limits wrap names mid-word ("Av / a").
- The setup step header cuts off labels on phone.
- The notifications inbox filter showed "Needs you · 0" while asks were waiting. Check against real data; the audit used mock data.

## Constraints

- Phone 390 px and desktop 1280 px, light and dark, matching the mockups. Every UI change gets screenshots in all four combinations, reviewed against the mockups (owner rule).
- Accessibility:
  - Expanders are buttons with `aria-expanded`.
  - Focus moves into an opened section and returns to its opener when it closes.
  - Touch targets are at least 44 px on phone.
  - Motion respects reduced-motion settings (about 180 ms otherwise).
- Files under 500 lines. Semantic commits. Semantic versioning: 2.8.0.
- Existing jest, Playwright and backend tests stay green. Tests that assert old layouts get updated, never deleted without a replacement.
- The user guide (`docs/guide/`), its screenshots and the site get updated for the new layouts.

## Left to the builder

- Exact component split and file layout. Migration order: shared widgets first, then Today, then the Kid page, then the rest.
- Exact summary-row wording beyond the mockups.
- How each screen maps its sections to URL param names.
- Animation details within the 180 ms, reduced-motion rule.
