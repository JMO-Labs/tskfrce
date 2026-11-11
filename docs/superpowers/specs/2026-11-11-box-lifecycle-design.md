# Box lifecycle: updates, reset, Wi-Fi setup

Amends `2026-11-04-easy-onboarding-design.md`, which listed auto-updates as a
non-goal and left the hotspot (build step 3) unbuilt. Every decision below was
approved by the owner on 2026-11-11 (grilling session).

## Facts (beta box taskfrce-beta1, 2026-11-11)

- The Wi-Fi chip is an Intel Comet Lake CNVi (`wlo1`). It supports AP mode, and
  `managed` + `AP` can run at the same time on one channel.
- The regulatory domain is unset (`country 00`), so 5 GHz AP is blocked. The
  hotspot is 2.4 GHz only.
- The network stack is netplan + systemd-networkd. NetworkManager is not
  installed.
- `unattended-upgrades` is enabled (security fixes only, no auto-reboot).
- `.env` has `TASK4CE_TAG=eval-2.13`. Nothing auto-pulls today.

## Non-goals

- Bluetooth setup. Wi-Fi QR codes are native on iOS and Android, and Bluetooth
  on iOS needs an app.
- Third-party geo-IP lookups such as ipinfo.
- Restoring from a backup file. The export ships; restore waits until someone
  asks for it.

## PR 1: Unattended updates (minor bump)

**Channels.** `.env` gets `UPDATE_CHANNEL=stable|eval|off`. `install.sh` sets
`eval` when the tag starts with `eval-`, and `stable` otherwise. Existing
installs get the timer on their next `install.sh` run.

| Channel | Pulls | Notes |
|---|---|---|
| `stable` | `:<major>` (for example `:2`) | minor and patch apply automatically |
| `eval` | floating `:eval` | moved by hand when an eval build is cut; **never prod**, so beta telemetry survives |
| `off` | nothing | set by the parent switch in Settings |

**CI.** A release `vX.Y.Z` pushes `:X.Y.Z` and moves `:X`. An eval build pushes
`:eval-X.Y` and moves `:eval`. Every pushed image is signed with cosign
(keyless, GitHub OIDC).

**Updater** (a systemd timer, nightly at 03:00–04:00 local time):

1. Skip if `off`, or if any kid session or timer is active. Retry the next
   night.
2. Pull the channel tag. Run `cosign verify` against this repo's workflow
   identity. **If it fails, refuse the image.**
3. If the digest is unchanged, exit.
4. Record the current digests, run `compose up -d`, then run the health check
   (same as `install.sh` `wait_healthy`).
5. If unhealthy, roll back to the recorded digests. Send the parent an ntfy
   alert and add a Today note: "Update to 2.x failed, still on 2.y, will retry
   tomorrow". Eval boxes also send an `update_failed` telemetry event.
6. If healthy, add a Today note: "Updated to 2.x".

**Major versions.** These never apply automatically. Settings → Updates shows
"Version 3 available" with an **Update** button, which moves the box to `:3`
and runs the updater immediately.

**OS.** `unattended-upgrades` stays on security fixes only. Add
`Automatic-Reboot "true"` at 03:30. A pre-reboot hook skips the reboot while a
kid session is active.

**Settings → Updates:** the current version, the auto-update switch (on by
default), the last result, and the major-version button.

## PR 2: Reset (minor bump)

| Action | Wipes | Keeps |
|---|---|---|
| **Reset app** | family data: kids, chores, devices, history, parent PIN. Goes back to the setup wizard. | Wi-Fi, box ID/domain, `UPDATE_CHANNEL`, telemetry config |
| **Factory reset** | everything Reset app wipes, plus saved Wi-Fi. Re-arms the sticker claim code; the setup hotspot starts on the next boot. | box ID/secret, `UPDATE_CHANNEL`, telemetry config |

- **Entry points:** Settings → "Start over" (enter the parent PIN, then type
  `RESET`), and `sudo tskfrce-reset [--factory]` on the box for parents who are
  locked out.
- **Order:** flush the blocker's nftables rules (unblock all devices) → wipe →
  restart. Eval boxes send a `box_reset` event.
- **Backup:** the reset screen offers "Download backup first" (a JSON export).
  The box keeps no hidden copy.
- **Forgot PIN:** entering the sticker claim code on the login page lets the
  parent set a new PIN. No data is lost.

## PR 3: Wi-Fi setup and management (minor bump)

**Stack.** `prep-box.sh` and the image install NetworkManager and set netplan's
`renderer: NetworkManager`. All Wi-Fi actions are `nmcli` calls, with no
hostapd or dnsmasq. The switch is done while wired `eno2` is up as a lifeline.

**Setup mode** (spec §2, otherwise unchanged):

- The hotspot is `t@sk4ce-<first4>`, WPA2, 2.4 GHz channel 6, with a captive
  portal.
- **Live join:** the hotspot stays up while the box joins home Wi-Fi (the chip
  supports managed + AP concurrently). The captive page shows "Connected!" or
  "Wrong password" live. If concurrent mode fails on real hardware, fall back to
  §2's drop-and-retry after 60 s.
- **Fallback:** if saved Wi-Fi is unreachable for 5 minutes, the hotspot comes
  back.

**Settings → Wi-Fi:** scan, pick a network, enter the password. The box tries
it and rolls back to the previous network if the join fails within 60 s.

**Country:**

- The hotspot always starts as `US`.
- Once online, the domain service's existing boot or IP-report reply returns
  Cloudflare's `CF-IPCountry` header. The box saves it and runs
  `iw reg set <cc>` for the next hotspot.
- IP-mode boxes (no domain service) stay on `US`, with a country dropdown in
  Settings → Wi-Fi.

## Process

1. Write a dead-simple plan per PR, in order PR 1 → 2 → 3.
2. Get mockup approval for Settings → Updates (PR 1), Start over and Forgot PIN
   (PR 2), and the captive page plus Settings → Wi-Fi (PR 3) before building
   the UI for each.
3. Feature pipeline per PR: build, verification sweep, polish passes, local CI,
   then the PR.
4. **Beta guard test:** an updater unit test asserts that an `eval` channel
   never resolves to a stable tag.

## Amendments (owner, 2026-11-11, later the same day)

Found during the build. These override anything above.

- **A1 Forgot PIN.** The sticker code resets the PIN. After that, all parents get an alert (ntfy and a
  Today note), every session ends (`token_epoch` is bumped), and PIN recovery locks until a parent
  re-arms it. `sudo tskfrce-reset --pin` on the box always works.
- **A2 Networks.** Any mix of networks: wired only, Wi-Fi only, both, or several VLANs. Nothing assumes
  one. An interface counts only if it is physical Ethernet, Wi-Fi or a VLAN and has a private IPv4
  address (10/8, 172.16/12, 192.168/16). Excluded: `lo`, `docker*`, `br-*`, `veth*`, `virbr*`, VPNs
  (`wg*`, `tailscale*`, `tun*`), the hotspot subnet 10.42.0.0/24, link-local addresses and CGNAT
  (100.64/10). `LAN_IFACE` becomes optional: unset means auto-detect.
- **A3 Blocker binding.** DNS (:53) and the portal (:80) bind each LAN address, never `0.0.0.0` and
  never the hotspot subnet. They are re-evaluated every 30 s and when a link changes.
- **A4 Hotspot.** The hotspot owns 10.42.0.1. The edge's captive page is `/wifi-setup`, served only to
  10.42.0.0/24 clients. Only factory-image boxes (with an edge) have it. Settings → Wi-Fi works
  everywhere.
- **A5 Network tags.** Each network gets an automatic label ("Wired", the SSID, or `VLAN <id>`) that
  parents can rename. Devices show the label as a chip, with a filter. Settings → Networks has an
  "Enforce here" switch per network, on by default.
- **A6 Every network reported.** The box reports all of its LAN addresses with labels. The registry
  keeps one DNS record per network (`<id>`, `<id>-2`, …) plus `last_seen`, and removes stale records.
- **A7 Permanent sticker QR.** "Open my box" becomes `https://taskfrce.jmolabs.dev/find?c=<code>`.
  On one network it redirects. On several it shows a button and a QR per network. If the box has not
  been seen for 15 minutes, it shows setup help (cable, or the setup Wi-Fi and the password on the
  sticker) and a "Try again" button.
- **A8 `/find` hardening.** Rate-limited per visitor IP. An unknown code and an offline box get the
  same page. The box ID is never shown. QR codes are drawn by an inlined MIT-licensed JS library,
  with no external calls.
- **A9 Shipping.** A3 and A4 go in PR 3 (#130). A2, A5, A6, A7 and A8 are PR 4 (Python blocker first).
