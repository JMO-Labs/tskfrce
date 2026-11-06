# Turnkey defaults — design

Status: **approved by owner 2026-11-06**: all 12 recommended changes, including new default hours, screen time on at setup, and remote access out of the wizard.

Principle (owner): "make the default experience as turnkey as possible, ensuring the basic experience is still very good but can be highly configurable." Power features are opt-in and hidden until on. Nothing pauses a device during setup.

The audit below is the source of truth for the exact defaults and copy. Existing families keep their saved settings: only new families and UI visibility change.


## Summary
- The worst problem: a kid's devices can pause **during the wizard**. Starter chores are created for *today* (`chore_library.py:255`) and `chores_lock` is on (`family.py:42`), so once a device is assigned in step 6 it pauses until today's chores are approved.
- The default hours in `StepHours.tsx:11-12` block **Sunday 08:00–15:00** (Sunday counts as a "school night" for the whole day) but leave Friday daytime open. They also block weekday daytime on holidays and sick days.
- The main loop is off at first: "Kids can buy extra minutes" (`points_unlock_early`) defaults to off and there are no starter rewards, so day-one points buy nothing.
- Hide-until-enabled is not applied consistently. Screen time, GIFs and quiet hours all show their sub-fields while switched off. Per-group pricing (`ScreenTimePane.tsx:58-67`) gets it right, except `GroupDetail.tsx:58` ignores whether screen time is on.
- Smaller items: `new_device` floods the bell during setup, the wizard step "Remote access" is information only, and the kid-phone copy contains env-var jargon and a privacy claim that looks wrong.

## Inventory

Vis = visibility to a parent who never touched the item: **Shown**, **Hidden** (until enabled), **None** (no UI).

| # | Item | Default and where | Vis | Verdict | Reason | Eff |
|---|---|---|---|---|---|---|
| 1 | Family name | model `"My Family"` family.py:30. The wizard requires it (setup.tsx:177) | Shown | Keep | The kids see it. One field. | S |
| 2 | Time zone | `"UTC"` family.py:31. The wizard pre-fills the detected zone (StepFamily.tsx:4, setup.tsx:47) | Shown | Keep | Auto-detected already | S |
| 3 | Day resets at | `"06:00"` family.py:32. Shown in Family (FamilyCards.tsx:106-112) | Shown | Keep | Good default and it is understandable. Could move under Advanced with #4. | S |
| 4 | Early finish bonus cap | `5`, server_default 5, family.py:35, migration e5f6…:25. FamilyCards.tsx:114-122 | Shown | Hide (Advanced fold) | Tuning knob in the "basics" card | S |
| 5 | Block new devices until assigned | `False` family.py:33 (migration 69d343fc2820:30 has no server_default). FamilyCards.tsx:126-131 | Shown | Keep | Fail-open is the right day-one choice. It is a single switch with clear copy. | S |
| 6 | Kids can buy extra minutes (`points_unlock_early`) | `False` family.py:34 (migration 69d343…:31 has no server_default). ScreenTimePane.tsx:36 | Shown | **Change default → on** for new installs | Off breaks the core promise "points buy screen time". Approval is still required (#8). | S |
| 7 | Screen time price | `20` pts/15 min family.py:36, migration e5f6…:29. ScreenTimePane.tsx:37-45 | Shown even when #6 is off | Hide until #6 is on | Rule: settings stay hidden until switched on | S |
| 8 | Approve automatically | `False` family.py:47. ScreenTimePane.tsx:68 | Shown when off | Keep default. Hide until #6 is on. | Parent approval is the safe default | S |
| 9 | Only during allowed hours | `True` family.py:48, migration p5e1…:84. ScreenTimePane.tsx:69 | Shown when off | Keep default. Hide until #6 is on. | Safe default | S |
| 10 | Max per day (family) | `NULL` family.py:46. ScreenTimePane.tsx:46-56 | Shown when off | Hide until #6 is on | Same rule | S |
| 11 | Per-kid limits (max min, min points) | `NULL` screen_time.py:12-13. ScreenTimePane.tsx:155 | Shown when off | Hide until #6 is on | Same rule | S |
| 12 | Per-group pricing | `False` family.py:49. Switch ScreenTimePane.tsx:58. Price field GroupDetail.tsx:58 | Hidden (the model) | Keep. Also gate on #6. | `showPrice` ignores `st.enabled`, so a dead price field can show while screen time is off | S |
| 13 | Group "Lock with the kids' chores" | `True` lock.py:106, migration p0d1…:181. GroupDetail.tsx:183-187 | Shown in group detail | Keep | Opt-out per group. Groups are already an advanced area. | S |
| 14 | Lock until today's chores are done (`chores_lock`) | `True` family.py:42, migration p0d1…:186. Wizard pre-fills on (setup.tsx:52, StepHours.tsx:68-71). HoursSection.tsx:127-136 | Shown | Keep on, but **start tomorrow** | It is the product's purpose, but it pauses devices during setup (see Summary) | S |
| 15 | Wizard default hours | School nights `01236` 06–08 + 15–20. Weekends `45` 08–22. StepHours.tsx:11-12 | Shown in step 7 | **Change default** | Sunday daytime is blocked and Friday daytime is open. Holidays and sick days are blocked 08–15. | S |
| 16 | Hour rule fields (kind, everyone, date range) | `everyone=False` hours.py:35 (the wizard passes `true`). RuleEditor.tsx:149-187 | Shown in the editor | Keep | Only seen when the parent opens a rule | – |
| 17 | Starter chores | None pre-selected. All are **daily**, including "Homework" (starterChores.ts:14, setup.tsx:193) | Shown in step 5 | Change Homework to school days | Daily homework plus chore lock pauses weekends until homework is approved | S |
| 18 | Chore defaults | points `10` chores.py:49 / ChoreDetail.tsx:54. needs_photo `False` chores.py:50 | Shown | Keep | Sensible | – |
| 19 | Device Guest switch | status `"unassigned"` lock.py:46. DeviceDetail.tsx:148-157 | Shown | Keep | Clear | – |
| 20 | Device "Always allowed (never lock)" | `False` lock.py:57. DeviceDetail.tsx:159-170 | Shown, including on Guest devices | Hide when Guest is on | Two "never blocked" switches confuse. On a guest device the second does nothing. | S |
| 21 | Listen-only mode / VLAN coverage | `False` family.py:40, `covered=False` lock.py:138. API only: network.py:52-58 | None | Keep (leave as is) | A power or diagnostic feature with no UI is acceptable. Document it or delete it later. | – |
| 22 | Notification places (Apprise) | None exist. When added, events = DEFAULT_EVENTS (api/notify.py:98) | Shown (empty state) | Keep | Opt-in already | – |
| 23 | DEFAULT_EVENTS | chore_ok, kid_note, reward_request, **new_device**, resisting, box_offline, workaround. services/notify.py:47-55 | Shown per place | **Change**: drop `new_device`, add `summary` | One ping per device seen is noisy on a new box. A single 19:00 summary is calm and useful. | S |
| 24 | new_device bell row | Always, for each new MAC. internal.py:165-171 | Shown (bell) | Suppress while the wizard runs (`setup_step` not NULL) | Step 6 already lists those devices. The bell floods with dozens of rows. | S |
| 25 | Bypass / workaround / password-guess alerts | Always on, in the bell and in DEFAULT_EVENTS (`resisting`, `workaround`). internal.py:240-249, 343-349 | Shown | Keep | Security signal, deduplicated per pause | – |
| 26 | lock_change, badge, overdue pings | Not in defaults (notify.py:47-55) | Opt-in per place | Keep | Off is the right default for noisy events | – |
| 27 | Daily summary time | Hardcoded `19:00` notify_jobs.py:17 | None | Keep | One less setting | – |
| 28 | Quiet hours | `NULL`, off (family.py:52-53). Turning it on fills 21:30–07:00 (NotificationsPane.tsx:13) | Shown | Keep off. Hide the card until a place exists. | It only affects Apprise pings | S |
| 29 | Security alerts still send | `True` family.py:54, migration l5f6…:66. NotificationsPane.tsx:47-54 | **Shown even when quiet hours are off** | Hide until quiet hours are on | A dead toggle when quiet hours are off | S |
| 30 | App address | `NULL`, falls back to BOX_URL as the placeholder (NotificationsPane.tsx:58-75, notify.py:84) | Shown | Hide (Advanced fold) | It already has an automatic value | S |
| 31 | Kid phone alerts (ntfy QR) | Depends on BOX_URL/NTFY_URL. KidPushPane.tsx:58-80 | Shown | Change the copy and fold it | It shows "Set BOX_URL / NTFY_URL" to parents. It is a second "kid phone" concept next to enrollment (#33). | M |
| 32 | Instant alerts on iPhones (relay) | `False` family.py:45. KidPushPane.tsx:69-75 | Shown when ntfy is on | Keep default. Fix the copy. | "Nothing leaves your home unless…" looks wrong. Enrolled phones get generic pushes via `NTFY_UPSTREAM_URL="https://ntfy.sh"` (config.py:47, push.py:97-106) regardless of this switch. | S |
| 33 | Kid phone enrollment | Code TTL 24 h, session 180 days sliding (services/kid_enroll.py:17-18). Wizard step 4 (optional) and KidPhonesPanel | Shown | Keep | It works without configuration. Optional in the wizard. | – |
| 34 | Kid mode (age group) | `"kid"` (9–12) user.py:80, migration l5e6…:46, KidEditor.tsx:22. The wizard does not ask. | Shown in the kid editor | Keep | A sensible middle. Adding it to the wizard would add input. | – |
| 35 | Kid PIN | Optional (StepKids.tsx:60-62) | Shown | Keep | Already optional | – |
| 36 | Reward defaults | price `50`, visible `True`, needs_approval `True` (RewardDetail.tsx:33-36, reward.py:32-33). No starter rewards are seeded. | Shown | Keep | Safe. #6 covers the empty shop. | – |
| 37 | GIFs | `gifs_enabled=False`, `gif_rating="g"` family.py:37-39. FamilyCards.tsx:141-176 | **Rating and key shown while off** | Hide until enabled | Same rule | S |
| 38 | Quick replies | `NULL`, which means 3 defaults (api/family.py:31-40) | Shown in chat | Keep | Works with no setup | – |
| 39 | Accent / colour scheme | `"neon"` family.py:41. Mode is per device (AppearancePane.tsx:14-18) | Shown | Keep | Cosmetic. The "7:1+ contrast" copy is jargon (line 28), a small fix. | S |
| 40 | Integrations | None installed. Home network keys card always shown (IntegrationsPane.tsx:69-82). Trust automatically `False` (LocalKeyForm.tsx:99) | Shown | Keep, with an optional fold | Opt-in already. The key card is advanced but harmless. | S |
| 41 | Wizard step 4 Kids' phones | Optional (WizardFrame.tsx:12) | Shown | Keep | Needed for kids to sign in. Already skippable. | – |
| 42 | Wizard step 6 Devices | Skippable, no default owners | Shown | Keep | Core of turnkey (who gets locked) | – |
| 43 | Wizard step 8 Remote access | Information only (StepRemote.tsx). WizardFrame.tsx:16 | Shown | **Move out of the wizard** to a Finish-screen tip | It collects no input and adds a step | S |
| 44 | Parents / invites | Invite link 24 h (ParentsPane.tsx:56) | Shown | Keep | – | – |

## Recommended changes (ranked by parent impact ÷ effort)

1. **Chore lock starts tomorrow for wizard chores** (S, highest impact). In `api/chore_library.py:255`, call `svc.make_runs(db, a, day)` only when `get_family(db).setup_step is None`. The wizard saves steps 3–8, so step 5 has `setup_step=5`. Hours still apply today.
   - Finish copy (StepFinish.tsx:8): replace "Locks start at the next lock time." with **"Hours start now. Chores, and the chore lock, start tomorrow at 6:00 AM."** (use `reset_time`)
   - StepHours switch hint: **"Starts tomorrow, so nobody is paused while you finish setting up."**
   - Update docs/guide/03-first-setup.md:76 to match.
2. **Fix the default hours** (S). In `StepHours.tsx:11-12`:
   - `School nights` days `'01236'`, times **`[{start:'07:00', end:'20:00'}]`**
   - `Weekends` days `'45'`, times **`[{start:'08:00', end:'22:00'}]`**
   - This removes the 08:00–15:00 gap, which blocked Sunday daytime, holidays and sick days. Parents who want a school-hours block add one.
   - Subtitle (setup.tsx:233): **"Devices are on during these hours and off at bedtime. Add school hours, holidays and per-kid hours later in Settings."**
3. **Screen time on by default for new families** (S). Set `points_unlock_early=True` when `/setup` creates the family (api/setup.py around line 113), not in a migration, so existing families keep their choice. Keep `screen_auto_approve=False`, so every purchase still needs a parent's OK.
   - Guide 04-everyday-use.md:100: **"Screen time is on: kids can trade 20 points for 15 minutes, and you approve each one."**
4. **Hide screen-time fields until it is on** (S). ScreenTimePane.tsx:37-69: render price, max per day, group pricing, approve automatically and only-during-hours only when `val('enabled')`. Also render `<ScreenLimits>` (line 155) only when `st.enabled`. Fix GroupDetail.tsx:58 to `showPrice = !!st?.enabled && !!st?.group_pricing && choreLock`.
   - Off-state hint: **"Turn this on to let kids spend points on extra internet time."**
5. **Quieter notification defaults** (S). In services/notify.py:47-55, set `DEFAULT_EVENTS = ("chore_ok","kid_note","reward_request","resisting","box_offline","workaround","summary")`, removing `new_device` and adding `summary`. In internal.py:165, skip the `new_device` bell row while `get_family(db).setup_step is not None`.
6. **Hide quiet-hours sub-toggle and fold App address** (S). NotificationsPane.tsx:47-54: render "Security alerts still send" only when `on`. Lines 58-75: move App address into a `<Fold title="Advanced">` with the help text **"Leave blank to use {app_address_default}."** Render QuietCard only when `places.data.length > 0`.
7. **GIFs: hide until enabled** (S). FamilyCards.tsx:146-174: render rating, key and help only when `val('gifs_enabled')`. Off copy: **"Off. Turn on to search GIFs in chat (needs a free GIPHY key)."**
8. **Move Early finish bonus cap to Advanced** (S). FamilyCards.tsx:114-122: put it in a collapsed **"Points rules"** fold, closed by default. Default stays `5`.
9. **Homework starter on school days** (S). starterChores.ts: add `days: [0,1,2,3,4]` (Mon–Fri) to Homework and pass `repeat: { type: 'weekly', days }` in setup.tsx:193. Card sub-line: **"Schoolwork · 30 pts · school days"**.
10. **Remote access out of the wizard** (S). Drop step 8 (`LAST = 7` in setupStep.ts:5, STEPS in WizardFrame.tsx:16) and show StepRemote's text as a Finish-screen tip with a "Later" link: **"Want to approve chores away from home? Set up Tailscale. Takes 5 minutes."** The wizard drops from 8 steps to 7.
11. **Device detail: one "never blocked" concept** (S). DeviceDetail.tsx:159-170: render "Always allowed" only when `!guest`. Hint: **"For a kid's device that should skip hours and chores, like a school laptop. A manual lock still applies."**
12. **Kid phone alerts copy** (M). KidPushPane.tsx:58-80:
    - When ntfy is off, replace the env-var text with **"Phone alerts aren't set up on this box. See the guide: Kid phone alerts."**
    - Fix the privacy line to **"Alert text stays in your home. Kid phones signed in with a code get a content-free 'check t@sk4ce' nudge through ntfy.sh."** Verify this against push.py:97-106 first.
    - Fold the ntfy-app QR section under **"Use the ntfy app instead"**, because enrollment via KidPhonesPanel is the primary path.

## Leave as is
- **Block new devices off** (#5): fail-open on day one avoids surprise pauses. The switch and copy are clear.
- **Approve automatically off, Only during allowed hours on** (#8, #9): safe, and once #4 lands they only show after opt-in.
- **Group chore lock on** (#13): only matters once a parent builds groups. Per-group opt-out is the right shape.
- **Bypass, workaround and box-offline alerts always on** (#25): the security value outweighs the noise. They are deduplicated per pause.
- **lock_change, badge and overdue off** (#26): correctly opt-in.
- **Quiet hours off, security-through-quiet on** (#28, #29 default): sensible defaults. Only visibility changes.
- **Hardcoded 19:00 summary** (#27): no new knob needed.
- **Age group "kid"** (#34): a reasonable middle. Asking in the wizard would add input.
- **Reward defaults and no seeded rewards** (#36): with screen time on (#3), kids have something to buy.
- **Enrollment TTLs, invite expiry, PINs optional** (#33, #35, #44): already zero-config.
- **Listen-only and VLAN API without UI** (#21): hidden power feature. Fine, but document or delete in a later pass.
- **Integrations** (#40): opt-in already. Folding "Home network keys" when there are none is optional polish.
- **Accent and theme** (#39): cosmetic and per-device. Simplifying the contrast-ratio copy is optional.
- **Migration hygiene:** `new_devices_blocked` and `points_unlock_early` have no server_default (69d343fc2820:30-31). This is harmless because rows are created through the ORM; fix only if raw inserts appear.
