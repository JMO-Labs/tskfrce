# Bypass alerts — design

Roadmap item 4. Status: approved by owner 2026-11-05.

## Why

Parents want to know when a kid tries to get around a pause, not only when it works. Today the box already
catches some tricks (escaping the redirect, a new address minutes after a pause, leaving Wi-Fi, box unplugged).
The owner asked: "think of some common attempts and see if we can detect" them. This design lists the common
attempts, says which the box can see, and adds detection for the ones it can.

## What the box can see (the hard limit)

The box ARP-redirects **only paused devices**. So it sees:

- all traffic from a paused device (it dies at the box, or passes for homework sites);
- every DNS question a paused device asks (the portal resolver answers them);
- LAN broadcast/multicast from every device: DHCP requests (fingerprint, hostname), mDNS (name, model), ARP.

It does **not** see traffic from devices that are not paused. Anything that needs that is out of scope.

## Common attempts and verdict

| # | Attempt | Works today? | Detectable? | This design |
|---|---------|--------------|-------------|-------------|
| 1 | Forget network / new private Wi-Fi address | Mostly no | Yes | Exists: `lock/hints.py apply_hint` matches name/model/fingerprint, copies owners and the manual lock, sends `device_hint`; `_note_new_address` adds a hostname-based `device_bypass` alert. No change. |
| 2 | Copy another device's address (MAC clone of a parent's phone) | Yes | Partly: same MAC, different DHCP fingerprint or mDNS model | **B. "Pretending to be" alert** |
| 3 | Guess a parent's password in the app | Rate-limited, never alerted | Yes: failed logins | **C. Password-guess alert** |
| 4 | VPN app, private DNS (DoT/DoH), proxy site, Tor while paused | No (all dropped) | Yes: DNS names and ports from the paused device | **D. "Tried a workaround" note** |
| 5 | Static ARP / router-hardcode on a laptop | Usually no | Yes | Exists (resist → `bypass`) |
| 6 | Mobile data, hotspot, neighbour's Wi-Fi | Yes | Only that it left | Exists (`left_wifi`) |
| 7 | Unplug the box | Yes | Yes | Exists (`box_offline`) |
| 8 | Use a sibling's or spare device | Yes | No (not paused, box can't see it) | Docs only |
| 9 | Change device clock / timezone | No (server time) | n/a | Docs only |

## Goals

- B–D below, each a parent alert or note with plain-language copy and a "what to do" line.
- Update `docs/blocker.md` "What can kids try" table, guide `06-troubleshooting.md`, ADR 0001 known limits, and the
  Pages feature list.

## Non-goals

- Seeing traffic of unpaused devices (would mean redirecting every device: slow, risky for the whole home).
- Deep packet inspection, TLS interception, per-app detection.
- Blocking anything new. These are alerts; enforcement is unchanged.

## Anti-goals (would make it a failure)

- False alarms that accuse a kid of cheating when a phone just rotated its private address (iOS/Android do this).
  Copy must say "may", never "cheated".
- Alert spam: one alert per device per pause per kind.
- Any new public port, cloud service, or data leaving the house beyond the existing generic notifications.

## A. Same device, new address — already built

Builder check found this exists (`backend/app/lock/hints.py`). It already auto-assigns and keeps the newcomer
paused. No work in this design beyond docs (row 1 of the blocker table).

## B. "May be a different device" (MAC clone)

- Hook: `_apply` in the device-seen path (`backend/app/api/internal.py`), where stored `model`/`dhcp_fp` are
  overwritten today. Before overwriting, compare.
- **Model** changes from a non-empty value to a different non-empty value on an assigned device → event
  `identity_change` + inbox `device_bypass` (already SECURITY via `KIND_EVENT` → `resisting`):
  "**<device> may be a different device**" / "It now says it's a <new model>, not a <old model>. Someone may
  have copied its address. Tap to check."
- **Fingerprint-only** change → event `identity_change` logged, no alert (OS updates change it). (my call)
- The new value is stored as today, so the alert fires once per change. No "That's fine" button, no timestamps,
  no new column. (my call, ponytail)

## C. Password guessing

- In the login route (`backend/app/api/auth.py`), on a failed login resolve the typed username/email to a user
  first. Unknown names are ignored (no counting of made-up names).
- Count failures per user id in memory (one uvicorn process, like `core/ratelimit`; resets on restart, fine
  for an alert). 5 failures within 15 minutes on a **parent** account → new inbox kind `password_guess` to all
  parents, mapped to push event `resisting` (SECURITY, skips quiet hours): "**Someone is guessing <name>'s
  password**" / "5 wrong passwords in 15 minutes. If it wasn't you, change it in Settings." At most once per
  account per hour.
- No device naming from the request IP (proxy/tunnel IPs make it unreliable). (my call)
- Existing rate limit stays.

## D. "Tried a workaround" (attempts that fail)

- Blocker, paused devices only, **DNS names only**: `blocker/portal.py run_dns` has the sender address; map IP→MAC
  with the same resolver `HitCounter` uses, and check the qname against `blocker/data/workaround_domains.txt`
  (suffix match, bundled, categories `vpn`, `private_dns`, `proxy`, `tor`). Count like `HitCounter`
  (MAC → set of categories), drained and reported with the existing periodic report.
- Ports (WireGuard to a raw IP etc.) are **not** in this design: the resist sniffer counts frames by MAC/IP only;
  adding L4 parsing is a bigger change for little gain. Documented as a limit. (my call)
- Backend: event `workaround_try` with the category. Dedupe once per device per category per pause, where a
  pause is the device's current `blocked_since` value.
- Notification (owner: alert once per pause): new inbox kind `workaround_try`, normal priority (respects
  quiet hours), mapped to a push event that is on by default and not in `SECURITY` (builder picks or adds one):
  "**<device> tried a VPN**" / "It didn't work — the pause is still on."
- Homework mode (when merged) keeps DNS on the portal resolver, so the same check covers it.

## Data and migrations

- One migration: `device_events.kind` CHECK gains `identity_change`, `workaround_try`; inbox `KINDS` CHECK gains
  `password_guess`, `workaround_try`.
- `device_activity.ALERT_KINDS = KINDS[:6]` is positional: replace with an explicit tuple including the new kinds.
  Add them to `FILTERS["bypass"]`.
- Keep new inbox kinds out of `KID_KINDS` / kid push.
- No new tables or columns.

## UI

- No new screens. New event rows on the device activity list and inbox, using existing row components and icons.
- Light/dark × phone/desktop screenshots per the standing visual gate; existing theme tokens only.

## Docs

- `docs/blocker.md` table: rows 1–4, 8, 9 with the new behaviour; "What it can't do" unchanged.
- `docs/guide/06-troubleshooting.md`: "I got a 'may be a different device' alert", "'tried a VPN' — what now?".
- ADR 0001: known limits add "devices that aren't paused are invisible to the box".
- `site/index.html` feature list: one line.

## Left to the builder

- Exact domain list contents (start from public VPN/DoH provider lists; no runtime download).
- Where the score function lives (suggest `backend/app/services/bypass.py`, ≤150 lines).
- Test shapes, following existing `test_internal*.py` and blocker `tests/`.

## Owner decisions (2026-11-05)

- Design approved.
- "Tried a workaround": **alert once per device per category per pause**, normal priority, respects quiet hours.

## As built

Deviations from the design above:

- The alert body never echoes the device model. The old and new model show only in the device's Activity tab.
- Fingerprint-only changes are not logged (software updates change them). Only model changes count.
- "May be a different device" is throttled to one alert per device per 24 h, keyed on alerts actually sent.
- Password guessing: 5 wrong passwords in 15 minutes on a parent account (sign-in or change-password), one security alert per account per hour. Kid accounts and unknown usernames never trigger it.
- New "Your password" card in Settings → Parents, with a hardened change-password endpoint that returns 400 on a wrong current password. The alert's "Change password" button opens it.
- "Tried a workaround" notification setting, on by default.
