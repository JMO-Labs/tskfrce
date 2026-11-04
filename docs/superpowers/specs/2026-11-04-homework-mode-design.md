# Homework mode — design

Date: 2026-11-04 · Status: draft for owner review

## Intent

A paused kid (chores not done, outside online hours) still has homework due.
Today the blocker cuts the whole internet, so homework stops too. Homework mode
lets a paused device reach homework sites while everything else stays paused.

**The rule that matters most (owner):** homework mode must never stop a kid
from finishing their homework. It is deliberately **permissive**. Parents keep
kids on track by **watching activity**, not by strict filtering.

## Decided by the owner

- **Turning it on:**
  - The parent turns homework mode on from the app.
  - A kid can also **ask** for it from their page, and the parent approves.
- **Allowed sites:** a built-in **starter list**, plus **sites each family
  adds** (for example the school portal).
- **"Allow everything in a session":** pages load fonts, sign-in pages, file
  hosts and embedded videos from other sites. These must work without parents
  listing them.
- **YouTube** can be part of homework, so it is not banned outright.
- **Monitoring:** parents can see what a device is doing during homework mode,
  and **block a site straight from that activity list**.
- **Ending:** whichever comes first:
  - the parent ends it manually
  - a timer the parent set runs out
  - it switches off automatically when the next scheduled item starts, for
    example bedtime or an "off" window

## Goals

1. A paused device in homework mode can use starter-list and family-added sites
   **and everything those sites pull in**, with no parent setup beyond turning
   it on.
2. The parent sees, live, which sites each homework-mode device is using. From
   that list they can block a site or end homework mode.
3. The kid can request homework mode. The parent approves it with a duration.
4. When homework mode ends (manual, timer or schedule), the device goes back to
   fully paused within seconds.

## Non-goals

- **Strict, page-accurate filtering.** That means telling YouTube apart from
  Google Classroom on shared Google servers, or inspecting encrypted traffic.
  No TLS interception, ever.
- **Per-app pricing and categories.** That is a separate planned feature.
- **IPv6 for homework traffic.** Homework mode works over IPv4. Paused devices
  already get no IPv6 answers from the box, so they fall back to IPv4.
- Changing how normal (non-homework) pausing works.

## Anti-goals

- Homework sites half-loading because a helper domain is missing. This is the
  failure the owner cares about most.
- Homework mode becoming **invisible** free internet. Whatever it lets through
  must show up in the parent's activity list.
- Activity data leaving the home. It stays on the box and is never sent to the
  domain helper or any cloud service.

## Current state (from code recon)

- **Blocker data path.** The blocker (`blocker/`) puts the box in the traffic
  path of paused devices via ARP and NDP spoofing in both directions
  (`arp.py:81-102`). IP forwarding is on (`firewall.py:100-110`). nftables then
  drops everything a paused device sends to the internet (`firewall.py:66-88`),
  and DNATs its DNS and HTTP to the portal (`firewall.py:57-65`, IPv4 only).
- **Portal DNS.** It answers **every** A query with the box IP and returns
  empty AAAA answers (`portal.py:14-38`). It never forwards upstream.
- **Blocker state.** The blocker learns state as a set of MAC addresses, by
  push (`lock/blocker_client.py` → `blocker/api.py /state`) and by poll
  (`/api/v1/internal/state`). `StateStore` holds `set[str]`.
- **Pause decisions.** `lock/rules.py:block_reason` decides who is paused.
  `Override` (`models/lock.py:109-122`) already carries `action` lock or
  unlock, `source`, and `expires_at`. It fans out per device, kid or group
  through `/{devices|kids|groups}/{id}/override` and `hooks/useOverride.ts`.
- **Parent controls.** Lock and unlock live in
  `frontend/src/v2/manage/DeviceDetail.tsx:193-200`: "Lock now", "Unlock 30
  min", "Back on schedule".
- **Kid requests.** Kids can already ask for screen time from their page. This
  uses `Redemption` with kind `screen_time` (`models/reward.py`), and the
  parent sees it in "Needs you".
- **Existing exceptions.** There is no domain allowlist anywhere today.
  `exempt` and `guest` are whole-device exceptions.

## The design

### 1. How traffic gets through (blocker)

For a device in homework mode, the box stops answering every DNS lookup with
itself. Instead it **decides per name**:

- **Allowed name.** The name is on the starter list or family list, or was
  picked up by session follow (below), and is not on the family block list.
  The box forwards the lookup to the real upstream resolver: the box's own
  resolver, or the router. It returns the real answer, and adds each returned
  IPv4 address to an nftables set of allowed `(device MAC, destination IP)`
  pairs.
  - Each pair has a timeout of `max(DNS TTL, 5 min)`, refreshed on every
    lookup.
  - In the `forward` chain, an `accept` rule for these pairs goes **before**
    the existing MAC and saddr drops. Return traffic is already allowed by the
    LAN rules, or by an equivalent rule for the reply direction.
- **Anything else.** The box answers with the box IP, exactly as today, so the
  kid lands on the portal page.

**Session follow** is how "allow everything in a session" works:

- When a homework-mode device looks up an allowed name, every other name that
  device looks up in the next **10 seconds** is also allowed.
- A followed name stays allowed for the rest of that homework session, for that
  device.
- This lets a page's fonts, sign-in, file hosts and embedded YouTube load with
  no list maintenance.

**My call, on the known leak:**

- Big providers share server addresses. Allowing an address for Classroom can
  also let YouTube or Search through. And a kid who opens an allowed site and
  quickly opens another can get that one followed in.
- Both leaks are **accepted**, because the owner chose permissive behaviour
  plus monitoring.
- Every followed name appears in the activity list, marked "pulled in by
  <site>".

**My calls, on the traffic rules:**

- **What passes.** An allowed `(device, IP)` pair passes **any protocol and
  port**, TCP and UDP. That includes QUIC/HTTP3, which browsers use for Google
  and YouTube. This is the permissive choice.
- **Hard-coded IPs.** Traffic to an IP the device never looked up through the
  box stays blocked.
- **The follow window refreshes.** It restarts on every allowed lookup, so
  while a kid is actively using an allowed site, the sites that page pulls in
  keep being followed.
- **Attribution.** "Pulled in by" credits the most recent allowed name that
  device looked up.
- **Start delay.** The portal answers with a 30 s TTL today, so a device may
  take up to about 30 s, plus any OS DNS cache, to start resolving for real.
  That is accepted, and the UI says "may take up to a minute".
- **Ending.** The blocker clears that device's allowed set **and deletes its
  conntrack entries**. That cuts open connections, so the device is fully
  paused again within seconds.

**Name matching:**

- A list entry `example.com` allows `example.com` and any subdomain.
- Entries are stored lowercase without a trailing dot.
- The family block list always wins over the allow list and session follow.

### 2. Turning it on and off (backend)

- Homework mode is a new `Override` action, `homework`. It reuses expiry, undo,
  per-device, per-kid and per-group fan-out, and the existing push to the
  blocker.
- `block_reason` still treats the device as paused, so all existing pause
  logic, alerts and UI keep working. The state sent to the blocker now carries,
  per paused MAC, whether homework mode is on.
- `expires_at` is the earliest of:
  - the parent's timer (default **60 min**, my call)
  - the start of the next scheduled item from the hours rules
- The parent can end it at any time, which deletes the override.
- **My calls, on edge cases:**
  - With no next scheduled item, the timer is the only cap.
  - Homework mode can only be set on a device that is currently paused. On a
    device that is online, the API returns 409, and the UI hides the button.
  - For a kid or group, it applies to that target's currently paused devices.
- If the schedule changes while homework mode is on, recompute `expires_at`.
- **State payload:** both the push body and `/internal/state` gain a field
  `homework`. It maps a MAC to `{allow: [names], block: [names], until: ts}`.
  Alternatively it is a family-level list plus MACs; the builder may choose.
  The blocker's `StateStore` grows accordingly.

### 3. Lists

- **Starter list:** a curated file in the repo, versioned with the code. Seed
  it with common homework services **and their known helper domains**:
  - Google Classroom, Docs, Drive and Forms, plus Google sign-in and static
    hosts
  - Microsoft 365 and Teams for Education, plus Microsoft sign-in
  - Khan Academy
  - Canvas, Schoology, Clever, PowerSchool, Seesaw, Quizlet, IXL, Desmos
  - Wikipedia and Britannica

  Session follow is the safety net for anything the list misses. **YouTube is
  not on the starter list (my call).** It works when embedded on a homework
  page, through session follow, and a family can add it.
- **Family allow list:** the parent adds and removes domains in settings. The
  parent can also add a domain from the activity list.
- **Family block list ("never during homework"):** filled from the activity
  list's **Block** button, and editable in settings.
- **My call, on what blocking does:**
  - The blocker stops resolving the name.
  - It removes from the device's allowed set only the addresses that no
    still-allowed name has resolved to. Shared addresses stay.
  - It deletes conntrack entries for the removed addresses.
  - Why: removing every address of a blocked name would also cut allowed sites
    on the same shared servers. Blocking `youtube.com` could break Google
    Classroom, which would break the top rule.
  - Known limit: a blocked site served from the same addresses as an allowed
    site may keep working. The UI says so in one line under the Block button.
- **My call, on who manages the lists:** both lists are **family-wide** (not
  per kid or device), and **only parents** can edit them.

### 4. Monitoring (activity list)

- **What is recorded.** For each homework-mode device, the blocker records each
  name the device looks up while homework mode is on:
  - first seen and last seen
  - number of lookups
  - whether it came from a list (starter or family) or from session follow, and
    if so which site pulled it in
  - "Active minutes": the count of distinct minutes in which the name was
    looked up or had allowed traffic. This is an approximation; the builder
    chooses the signal.
- **Where it is kept.** The blocker posts this to the backend in batches
  (internal API, same token as today). The backend stores it per device and
  session. It is kept on the box for **7 days** (my call), then deleted.
- **What the parent sees.** In the device or kid view, a live list sorted by
  active minutes, e.g. "classroom.google.com 25 min · youtube.com 8 min
  (pulled in by classroom.google.com)".
  - Each row has **Block** and **Add to allowed** buttons.
  - There is an **End homework mode** button.
- **What it shows.** Only names and times. No page content and no URLs: the box
  only sees names.

### 5. Kid request

- The kid page shows **"Ask for homework time"** when the kid is paused. It
  reuses the existing request pattern.
- **My call, on storage:** a small new request record (kid, requested at,
  status, approved minutes), not a `Redemption`. Redemptions are priced in
  points and homework is free. It shows in "Needs you" like the others.
- The parent sees the request in "Needs you". They can approve with a duration
  (default 60 min, capped by the next scheduled item) or decline.
- The kid page shows that homework mode is on, and until when.

## Constraints

- IPv4 only for homework traffic, as decided above. The existing IPv6 handling
  is unchanged.
- **Private DNS is a known gap, not a bug.** Some devices have browser secure
  DNS or Android Private DNS forced on. They may bypass the box's answers and
  get dropped on 443. Name the gap in the troubleshooting guide: "turn off
  Private DNS on the kid's device".
- **The upstream resolver** is the box's own, from the host's resolver config,
  or the LAN gateway. The blocker runs with host networking, so it can reach
  either.
- Files under 500 lines. Semantic commits. CI must pass. The lab e2e suite
  should gain a homework-mode test:
  - an allowed name resolves and its traffic passes
  - a non-allowed name hits the portal
  - a session-followed helper passes
  - a blocked name stops
  - expiry restores the full pause

## Left to the builder

- Exact nftables layout: concatenated `ether_addr . ipv4_addr` set with
  timeouts, or per-device sets.
- How the blocker forwards DNS upstream (stub forwarder in `portal.py`, or a
  library), its timeouts, and its caching.
- The shape of the batched activity upload, and how "active minutes" is
  counted.
- Exact contents of the starter list, and how it is shipped (repo file baked
  into the backend image).
- UI layout and copy, following the v3 design system and the existing lock
  controls.
- Migration details for the new override action and the list tables.
