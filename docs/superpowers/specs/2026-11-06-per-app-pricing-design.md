# Per-app pricing — design (proposal)

Roadmap item 5. Status: **proposal, awaiting owner approval** (owner opted out of questions: "propose").

## Why

The roadmap line was "gaming costs more, music is free". Today one family-wide price buys screen time
(`FamilySettings.screen_time_price`, points per 15 min, default 20), and buying unlocks **every** device the kid
has. A kid who wants 30 minutes of music on the speaker pays the same as 30 minutes on the console, and gets the console too.

## The hard limit: the box can't see apps

The box only redirects **paused** devices. While a device is unpaused the box sees none of its traffic
(`docs/blocker.md`, ADR 0001). The box does no traffic inspection (DPI) and never decrypts traffic. So it cannot tell Fortnite
from Spotify on the same phone, and it cannot meter "minutes of gaming".

What the box **does** know is the **device**, and devices already sit in **device groups** (Consoles, Tablets,
Speakers…). So "per-app pricing" becomes **per-device-group pricing**, which covers the real cases:

| Wish | How |
|------|-----|
| Gaming costs more | Consoles group price 40 instead of 20 |
| Music is free | Speakers group: turn off "Locked by chores" (exists today, `DeviceGroup.chore_lock`) |
| Buy time for one thing, not everything | Kid picks what the time is for |

Not covered: different prices for different apps on the **same** phone. Documented as a limit.

## Goals

1. A parent can set a price per device group. Empty means the group uses the family price.
2. When buying screen time, the kid picks **what it's for**: one group, or "All my devices".
3. Approving a request unlocks only the matching devices.
4. Nothing changes for families who never set a group price. They still see one option, "All my devices", at the family price.

## Non-goals

- Per-app or per-site metering, DPI, TLS interception, on-device agents.
- A free price (0). "Free" is the existing "Locked by chores" switch.
- Category passes over DNS ("music sites only while paused"), in the style of homework mode. That is possible later on top of homework mode
  (unmerged), and it has the same CDN-IP limits. Out of scope here.

## Anti-goals

- Kids paying for a group and getting devices they didn't pay for.
- A pricing grid parents must fill in before anything works.
- Silent price changes to pending requests (cost is fixed when the request is made, as today).

## Design

**Data** (one migration):
- `device_groups.screen_price`: Integer, nullable, 1–1000 (same bounds as the family price).
- `redemptions.device_group_id`: nullable FK to `device_groups.id`, `ON DELETE SET NULL`. Null means "All my devices".

**Price rules** (`backend/app/services/economy.py`):
- The group's price is `group.screen_price or family.screen_time_price`.
- The "All my devices" price is the highest price among the groups of the kid's lockable devices. Devices with no group count at the family
  price. *(My call: buying everything never costs less than buying the priciest part.)*
- `cost = minutes // 15 * price`, fixed at request time (unchanged).
- The daily minute cap, the minimum balance and the allowed hours (`screen_time.check`) count all purchases, whatever the group.
  *(My call: one daily cap.)*

**Unlock** (`_decide`): if `device_group_id` is set, add bonus `Override`s only for the kid's devices in that group. Otherwise add them
for all devices (today's behaviour). If the group was deleted before approval, fall back to all devices at the cost already
paid. *(My call.)*

**Options endpoint**: the kid rewards API returns `screen_options: [{group_id|null, name, icon, price}]`. It lists only groups
where the kid owns at least one lockable device, plus "All my devices". If there is only one distinct price and one group, show just
"All my devices".

**UI** (existing components and theme tokens only; light and dark, phone and desktop screenshots):
- Parent, device group edit: a "Screen time price" number field. The placeholder says "Family price (20)". Helper text:
  "Points per 15 minutes. Leave empty to use the family price."
- Parent, Settings → Screen time: one line under the family price, "Groups can have their own price", which links to Devices.
- Kid, buy sheet: a "What for?" choice (icon chips, one per option, with the price per 15 min) above the minutes picker. The total updates live.
- Parent, approval card and inbox: "30 min on Consoles · 80 pts" (or "on all devices").

## Docs

- Parent guide: a section on screen time prices, plus a troubleshooting entry: "Why can't I price YouTube differently from homework on the same
  tablet?"
- `docs/blocker.md` "What it can't see": a pointer to that entry.
- Pages feature list: one line. Version **2.3.0**.

## Left to the builder

- Test shapes (follow `tests/test_economy*.py`, `test_kid_rewards*.py`).
- Whether the options list is computed in `economy.py` or `screen_time.py` (the file must stay under 500 lines).

## As built

Shipped as 2.3.0. Deviations from the design above:

- **Shared devices.** A device that is in several groups counts at its highest group price, and approval unlocks it only
  for a request paid at that rate or more. Buying a cheaper group does not unlock it; the kid buys the pricier group or "All my
  devices". This came from a security fix (otherwise the cheapest group would unlock a pricey device) and replaces the plan's
  earlier expectation.
- **Deleted-group fallback is capped.** If the group is deleted before approval, the unlock covers all of the kid's devices
  whose price is at or below the rate paid, not every device.
- **Family price field** is wider so its placeholder text fits.
