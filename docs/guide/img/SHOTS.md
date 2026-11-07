# Screenshots

Referenced by the guide and README. v3 look, light mode, JPEG (quality ~82), at most 1400 px wide: desktop shots at 1280 px, phone shots taken at 390 px (2x) and saved 600 px wide.

Taken with Playwright from a demo family (kids Bobby and Susan), read-only: every write request was aborted. Kid screens were rendered as a kid session whose reads go through the parent "view as" header.

| File | Screen and state |
|---|---|
| `today.jpg` | Parent **Today**, desktop, Bobby's day with overdue and to-do chores. |
| `today-kid.jpg` | Parent **Today** on a kid with nothing done yet (Susan, 0 of 7). |
| `needs-you.jpg` | Parent **Today**, desktop, **Needs you** tab. The demo had nothing waiting, so four sample requests were injected into the `/today` response. |
| `setup-account.jpg` | Setup wizard step 1 "Make your parent account", with the step list visible. |
| `setup-family.jpg` | Setup wizard step 2 "Your family" (step 1 filled in locally; nothing is sent before step 2's Next). |
| `setup-hours.jpg` | Setup wizard step 7 "When can devices be online?" with the new starting schedule (07:00–20:00 Sun–Thu, 08:00–22:00 Fri–Sat). Retaken 2026-11-06 for 2.4.0; 1280×900 capture cropped to 1280×740 from the top. |
| `setup-devices.jpg` | Setup wizard step 6 "Whose devices are these?", devices assigned to kid chips and Guest. |
| `devices.jpg` | **Devices** page with one device open (owners, right now, lock and test block buttons). |
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
| `happy-hour-start.jpg` | Parent **Today** (phone): the **Start Happy Hour** sheet (60 min, ×2, all kids). |
| `trust-kid.jpg` | Kid page (phone): **Trust mode** card, Trusted level, and **Approved on their own** with **Wasn't done**. Less parent work 2.7.0. |
| `wasnt-done.jpg` | Kid page (phone): the **Wasn't done?** sheet with **Also lower trust level** ticked. |
| `setup-extras.jpg` | Setup wizard step 8 "Optional extras" (phone): trust mode per kid and bedtime auto-approve, all off. |
| `extras.jpg` | **Settings → Family** (phone): the **Extras** card with bedtime auto-approve on. Retaken 2026-11-07 (renamed from `less-tapping.jpg`) from a mocked API. |
| `recap.jpg` | **Your week** (phone): **Worth a look** list and the **This week** card. |
| `kid-trust-chip.jpg` | Kid **Me** (phone, Little look): the Proven level chip and its friendly line. |

Retaken 2026-11-07 after the polish passes: `trust-kid.jpg`, `wasnt-done.jpg`, `extras.jpg`, `recap.jpg`. These four came from a mocked API (Playwright `page.route`, parent logged in with a fake token), phone 390x844 at 2x, light, viewport only, resized to 600 px wide, JPEG quality 82. The real-backend shot process was not used.
