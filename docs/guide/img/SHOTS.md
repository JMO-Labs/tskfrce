# Screenshots

Referenced by the guide and README. v3 look, light mode, JPEG (quality ~82), at most 1400 px wide: desktop shots at 1280 px, phone shots taken at 390 px (2x) and saved 600 px wide.

Taken with Playwright from a demo family (kids Bobby and Susan), read-only: every write request was aborted. Kid screens were rendered as a kid session whose reads go through the parent "view as" header.

| File | Screen and state |
|---|---|
| `today.jpg` | Parent **Today**, desktop, calm view: Needs you bar, a card per kid, Devices line. |
| `today-kid.jpg` | Parent **Today** with one kid open (Maya): chores and requests. |
| `needs-you.jpg` | Parent **Today**, desktop, **Needs you** open, grouped by kid (mocked API). |
| `setup-account.jpg` | Setup wizard step 1 "Make your parent account", with the step list visible. |
| `setup-family.jpg` | Setup wizard step 2 "Your family" (step 1 filled in locally; nothing is sent before step 2's Next). |
| `setup-hours.jpg` | Setup wizard step 7 "When can devices be online?" with the new starting schedule (07:00–20:00 Sun–Thu, 08:00–22:00 Fri–Sat). Retaken 2026-11-06 for 2.4.0; 1280×900 capture cropped to 1280×740 from the top. |
| `setup-devices.jpg` | Setup wizard step 6 "Whose devices are these?": **Need an owner** open with the **Owner** pop-over. |
| `devices.jpg` | **Devices** page with one device open; the **Home network** row is at the top of the list. |
| `chat.jpg` | **Chat** on a chore thread with a kid note ("Need help"). |
| `kid-today.jpg` | Kid page (phone): internet paused, chore cards with points and due chips. |
| `kid-chore.jpg` | Kid page: one chore opened with chained steps, "I'm done!" held back. |
| `kid-locker.jpg` | Kid **Customize** (Locker): name card preview, slot tabs, locked items with unlock level. |
| `setup-claim.jpg` | Box code screen (phone), empty, from the sticker's **Open my box** link. |
| `setup-phones.jpg` | Setup wizard step 4 "Kids' phones" (phone), Bobby's code shown. The QR is a mock pattern. Retaken 2026-11-06 for the 7-step wizard. |
| `kid-welcome.jpg` | Kid welcome page after scanning a code (iPhone steps). |
| `group-price.jpg` | **Devices → Groups**, one group open with **Screen time price** filled in (phone). Mocked API. |
| `kid-screen-for.jpg` | Kid **Rewards** (phone): **What for?** picker with Consoles selected. Mocked API. |
| `celebrate.jpg` | Kid page (phone): a cowboy-dog celebration with coins and "YEEHAW!". Excitement pack 2.6.0. |
| `happy-hour-kid.jpg` | Kid page (phone): Happy Hour banner with countdown and doubled chore points. |
| `happy-hour-start.jpg` | Parent **Today** (phone): the **Start Happy Hour** sheet, opened from the Today **…** menu (60 min, ×2, all kids). |
| `trust-kid.jpg` | Kid page (phone): **Trust mode** card, Trusted level, and **Approved on their own** with **Wasn't done**. Less parent work 2.7.0. |
| `wasnt-done.jpg` | Kid page (phone): the **Wasn't done?** sheet with **Also lower trust level** ticked. |
| `setup-extras.jpg` | Setup wizard step 8 "Optional extras" (phone): trust mode per kid and bedtime auto-approve, all off. |
| `extras.jpg` | **Settings → Family** (phone): the **Bedtime & recap** row open. |
| `recap.jpg` | **Your week** (phone): **Worth a look** list and the **This week** card. |
| `kid-trust-chip.jpg` | Kid **Me** (phone, Little look): the Proven level chip and its friendly line. |

Retaken 2026-11-07 after the polish passes: `trust-kid.jpg`, `wasnt-done.jpg`, `extras.jpg`, `recap.jpg`. These four came from a mocked API (Playwright `page.route`, parent logged in with a fake token), phone 390x844 at 2x, light, viewport only, resized to 600 px wide, JPEG quality 82. The real-backend shot process was not used.

Retaken 2026-11-08 for 2.8.0 declutter, mocked API (`scripts/shots/declutter`, light, 1280x800 desktop or 390x844 phone at 2x resized to 600 wide, JPEG quality 82):
- `today.jpg`: Retaken 2026-11-08 for 2.8.0 declutter, mocked API
- `today-kid.jpg`: Retaken 2026-11-08 for 2.8.0 declutter, mocked API
- `needs-you.jpg`: Retaken 2026-11-08 for 2.8.0 declutter, mocked API
- `setup-devices.jpg`: Retaken 2026-11-08 for 2.8.0 declutter, mocked API
- `devices.jpg`: Retaken 2026-11-08 for 2.8.0 declutter, mocked API
- `group-price.jpg`: Retaken 2026-11-08 for 2.8.0 declutter, mocked API
- `trust-kid.jpg`: Retaken 2026-11-08 for 2.8.0 declutter, mocked API
- `wasnt-done.jpg`: Retaken 2026-11-08 for 2.8.0 declutter, mocked API
- `extras.jpg`: Retaken 2026-11-08 for 2.8.0 declutter, mocked API
- `happy-hour-start.jpg`: Retaken 2026-11-08 for 2.8.0 declutter, mocked API
- `site/img/today-hero.jpg`, `today-parent.jpg`, `needs-you.jpg`: Retaken 2026-11-08 for 2.8.0 declutter, mocked API

Retaken 2026-11-08 after polish pass 5 (rail t@ and lime tile, 44px phone controls, Chat glyph, kid header), mocked API (`scripts/shots/declutter`, light, 1280x800 desktop or 390x844 phone at 2x resized to 600 wide, JPEG quality 82, focus ring cleared):
- `today.jpg`: Retaken 2026-11-08, polish pass 5
- `today-kid.jpg`: Retaken 2026-11-08, polish pass 5
- `needs-you.jpg`: Retaken 2026-11-08, polish pass 5
- `devices.jpg`: Retaken 2026-11-08, polish pass 5
- `trust-kid.jpg`: Retaken 2026-11-08, polish pass 5
- `recap.jpg`: Retaken 2026-11-08, polish pass 5
- `site/img/today-hero.jpg`, `today-parent.jpg`, `needs-you.jpg`: Retaken 2026-11-08, polish pass 5
