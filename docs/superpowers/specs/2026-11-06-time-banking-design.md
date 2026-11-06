# Time banking: design

Roadmap item 7a. Status: **draft for owner approval**.

## Why

Kids buy screen time with points, up to a daily max. If they skip screen time on a busy day, that room is lost. The owner wants unused room to roll over, so a kid can save up for a long Saturday. Parents set a cap on how much can be saved, and can turn rollover off.

## What the owner decided (2026-11-06)

- **Unused daily max** rolls over. This is the room to buy time, not free time: kids still pay points, and approval works as today.
- The bank **keeps growing day after day** up to a parent-set cap.
- Parents can **turn rollover off**.
- Defaults, per the turnkey rule: rollover is **on**, and the cap is **one day's max**. With a 60-minute max, a kid's biggest day is 120 minutes.

## How it works

- Every daily reset, each kid's bank changes by today's unused room:
  `bank = clamp(bank + (daily_max − bought_today), 0, cap)`.
  Buying beyond the daily max uses up bank, because `bought_today` can go above `daily_max`.
- Today's buy limit is `daily_max + bank`. All existing checks stay as they are: minimum balance, allowed hours, off windows, approval.
- `daily_max` is the kid's effective max from `screen_time.limit_for` (the family max combined with the kid's own max). **No daily max means nothing to bank.** The bank stays at 0 and the banking settings are hidden.
- `cap` is the family `screen_bank_cap` in minutes. **Empty means "same as the kid's daily max"**, which is the default. A per-kid cap is out of scope.
- Turning rollover **off** sets every bank to 0, so nothing surprising comes back later. Turning it back on starts from 0.
- If screen time itself is off, nothing banks.
- If the box missed resets (it was powered off), only the latest day is settled. Days the box was off don't add to the bank. *(My call: simplest, and it can't overshoot.)*

## Data

- `family_settings.screen_rollover` Boolean, default true (server_default "1").
- `family_settings.screen_bank_cap` Integer, nullable, 15–480 in steps of 15. Null means one day's max.
- A new `screen_banks` table: `kid_id` PK FK → users ON DELETE CASCADE, `minutes` int ≥ 0, `day` date (the last chore day settled). Settling skips if `day` is already the latest day, so a reset that runs twice doesn't double count. *(My call: a separate table, so the limits rows stay simple.)*
- One migration after the current head.

## Where it plugs in

- **Settle:** in the daily reset path, next to `chores.run_reset` in `lock/state.tick`. It uses the same family `reset_time` day boundary that screen time uses (`day_start_utc`).
- **Limit:** `screen_time.check` and the `left_today` and `max_today` values in GET `/kid/rewards` and the parent `/screen-time` both use `daily_max + bank`. The kid API adds `screen.saved` (bank minutes).

## UI (existing components and tokens only; light and dark × phone and desktop screenshots)

- **Parent, Kids & chores → Rewards → Screen time.** The setting is shown only when screen time is on and a daily max is set.
  - Switch: **"Save unused time"**, with the hint **"Minutes a kid doesn't buy today carry over, so they can save up for a bigger day."**
  - When the switch is on, a number field: **"Save up to"**, followed by "min", with the placeholder "Same as the daily max (60)".
  - The per-kid limits list shows each kid's saved minutes: "Saved: 40 min".
- **Kid rewards card.** Under the minutes picker, the kid sees **"You saved 40 min — today you can buy up to 100 min."** This only shows when the bank is above 0. The picker offers steps up to what is left today (each request stays 15–120 min).
- **Daily summary and weekly recap.** Not part of this item.

## Docs

- Parent guide 04: a short "Saving unused time" section.
- Kid guide 05: one line.
- Pages feature list: one line.
- Version **2.5.0**.

## Non-goals

- Banking bought-but-unused minutes (the box can't tell idle from use).
- A per-kid bank cap, bank expiry, or interest.
- Gifting between kids. That is fair-play/gifting, a separate item.

## Anti-goals

- Free time without points.
- A kid going above the cap, or a bank going below 0.
- Surprise behaviour for families who never touch it: their kids simply get a bit more room after quiet days. That is the intended default.

## Settled after the code check (my calls)

1. **Requests stay 15–120 minutes each.** `SCREEN_MINUTES` and the picker steps are unchanged. To use a big bank, a kid buys more than once a day, which is already allowed. The picker hides steps above what is left today. Raising the 120 cap per request can come later.
2. **When the bank settles.** Settling runs inside `tick`, *before* `run_reset` moves `last_reset_date`. It covers the old chore day's window, from that day's start to the new day's start, with an upper bound on `created_at`. If resets were missed, only the old `last_reset_date` day is settled. On a fresh install (`last_reset_date` is null), settling is skipped. `screen_banks.day` stores the settled day and is compared with the old `last_reset_date`, so a repeated tick never counts twice.
3. **Pending counts as used.** A request still pending at the reset counts as bought for that day, because `bought_today` counts pending and approved. If it is denied later, the bank is not re-credited. This is conservative and can never overshoot.
4. **The cap is enforced when read.** `limit = daily_max + min(bank, cap)`, with the cap taken from today's max. If a parent lowers the max, the extra stops counting at once. If the daily max is cleared, banking is off and the bank is zeroed at the next settle.
5. **Cap validation.** 15–480 minutes in steps of 15, the same as the daily max. PATCH accepts `null` to clear it back to "same as the daily max", which is the same carve-out as `max_minutes_per_day`.
6. **What each field means.**
   - `max_minutes` / the per-kid limit stay the base daily max.
   - `max_today` and `left_today` (kid API) include the bank.
   - A new `saved` field holds bank minutes. The kid API has `screen.saved`. The parent `/screen-time` has `saved` on each kid row.
   - The parent bar shows `bought_today` against `max + saved`, and the label reads "Saved: 40 min".

## Left to the builder

- Test shapes, following `test_screen_time.py` and `test_screen_price.py`.
- Whether the settle function lives in `services/screen_time.py` (which must stay under 500 lines) or a new `services/screen_bank.py`.
