# Escape lab: exhaustive real-device blocking tests

Status: draft for owner approval · 2026-11-12 · branch `lab/device-harness` · lab only, not CI

## Goal

Prove, with real devices on the real home network, that a paused device cannot reach the internet by
any means a kid could try, and that the box alerts when someone tries. Give Claude a closed loop:
run every escape → score → change blocker → deploy to beta box → re-run, until the score stops improving.

## Setup

| Node | How Claude drives it | Network |
|---|---|---|
| Beta box `taskfrce-beta1` | ssh `ubuntu@192.168.1.98`; blocker internal API | `wlo1` 10.10.40.150 (Homenet5) |
| Android `kidphone` (Android 15, root) | `sudo droidns run adb …` on .196 | netns `droid`, Wi-Fi MAC `c4:8b:66:54:72:0d` |
| Ubuntu laptop (root) | ssh | Homenet5 Wi-Fi |
| iPad (phase 2) | MacBook ssh → Xcode/WebDriverAgent/`pymobiledevice3` | Homenet5 Wi-Fi |
| Canary on Beast (phase 1) | ssh `root@192.168.1.96` | `canary.jmolabs.dev` via existing CF tunnel (HTTP/WS only) |
| Escape VPS (later) | ssh | raw public IP: UDP/ICMP/alt-port/DNS-auth rows |

## Decisions (owner, 2026-11-12)

- The canary uses the existing Cloudflare tunnel on Beast. A VPS comes later, only for the raw-protocol
  rows marked (srv).
- Claude may deploy blocker builds to the beta box freely; it is eval-only.
- The laptop joins in phase 3. The iPad joins in phase 4, through the MacBook.
- The router/AP is UniFi. Isolation and proxy-ARP rows are toggled by the owner when the runner prompts.

## Canary security ("locked to us")

The canary must never become an open proxy or a public data sink. Layered defenses:

1. **Cloudflare WAF rule** (owner adds it in the dashboard): `http.host eq "canary.jmolabs.dev" and
   ip.src ne <home public IP>` → Block. All test traffic leaves through the home IP, so lab leaks still
   arrive.
2. **Secret path prefix** (32 random bytes, stored in `/etc/tskfrce-lab/canary.secret` and in Beast
   appdata, mode 600). Any other path returns 404 with an empty body.
3. **The canary only logs:** time, token, path, CF-Connecting-IP and user agent. It never fetches
   anything, executes anything or stores request bodies (it reads and discards at most 64 KB).
4. **The websocket tunnel endpoint** (`wstunnel`) sits behind the same secret prefix and is
   `--restrict-to` the canary's own echo port only. It can never reach the internet or the LAN.
5. **Container hardening:** non-root, read-only filesystem, no capabilities, on a private network
   shared only with cloudflared, no LAN ports published.
6. **Log retention:** 7 days, then rotated out.

## Deciding pass or fail

A scenario runs in three steps. Each one checks a different thing:

1. **Baseline (unpaused)**: the probe must **succeed**. If it fails, the probe itself is broken, so the
   result is `INVALID`, not a pass. This avoids false "blocked" results.
2. **Paused**: the probe must **fail**.
3. **Unpaused again**: the probe must succeed within 60 s, so blocking doesn't damage the device.

Three independent checks (oracles) for the paused step:

- **Device oracle:** the probe exits 0 only if it got a reply that is genuinely from the internet:
  - a TLS certificate that validates, or
  - a known content hash, or
  - a canary nonce echoed back.

  A box portal or gate reply never counts as a leak. A reply that is real but truncated (for example
  the 16 KB gate cap) is recorded as a partial leak, with its byte count.
- **Canary oracle:** the escape server logs every request carrying the run's unique token, over HTTP,
  DNS (authoritative zone), UDP, ICMP and every tunnel type. A token in the log is proof of a leak in
  the upload direction, whatever the device saw.
- **Alert oracle:** after each run, read the box's signals, alerts and "got around the lock" badge.
  Compare them to what each scenario expects, which catches both missed alerts and false alerts.

Verdicts:
- `BLOCKED`
- `LEAK`
- `PARTIAL` (with bytes per minute achievable)
- `ALERT_MISS`
- `ALERT_FALSE`
- `INVALID`
- `SKIP` (platform can't do it)

## Escape matrix

Platforms: **A** = Android, **L** = laptop, **i** = iPad. Every row runs on each platform marked.
`(srv)` means the row needs the escape server.

### 1. DNS
| id | Trick | Plat |
|---|---|---|
| dns.static | Static DNS server 8.8.8.8 / 1.1.1.1 / 9.9.9.9 | A L i |
| dns.router | Query the router directly, bypassing the box | A L i |
| dns.dot | Android Private DNS on port 853 (dns.google, one.one.one.one, custom) | A L |
| dns.doh.browser | Chrome Secure DNS, Firefox TRR, Edge | A L |
| dns.doh.iplit | DoH to an IP literal (`https://1.1.1.1/dns-query`) | A L i |
| dns.doq | DNS over QUIC (UDP 853) | A L |
| dns.altport | DNS on 5353/5053/443 to a custom resolver (srv) | A L |
| dns.profile | iOS DNS configuration profile (DoH/DoT) | i |
| dns.tunnel | DNS tunnel (iodine/dnstt) through the box's real-answer resolver (srv). **Blocked devices get real DNS answers, so this is a high-risk path** | A L |
| dns.hosts | Hosts-file pinning plus a direct IP connection | A L |

### 2. Transport and protocol
| id | Trick | Plat |
|---|---|---|
| tx.https / tx.http | Plain web | A L i |
| tx.quic | HTTP/3 over UDP 443 | A L i |
| tx.iplit | HTTPS to a bare IP | A L i |
| tx.ech | Encrypted Client Hello (Cloudflare ECH test) | A L |
| tx.altports | TCP/UDP on 22, 53, 123, 443, 853, 3478, 5228, 8080, high ports (srv) | A L |
| tx.icmp | ICMP echo plus an ICMP tunnel (srv) | A L |
| tx.ntp | NTP 123 as a carrier (srv) | L |
| tx.v6.global / tx.v6.ula / tx.v6.privacy | IPv6 via SLAAC, privacy addresses, static v6 | L A i |
| tx.v6.only | IPv4 turned off, IPv6 only | L |
| tx.longlived | A stream or websocket opened **before** the pause keeps flowing | A L i |
| tx.push | FCM 5228 / APNs 5223: does a chat message arrive while paused | A i |

### 3. Riding the probe gate (PR #162)
| id | Trick | Plat |
|---|---|---|
| gate.budget | Many parallel 16 KB connections to www.google.com. Measure bytes per minute and whether search results are readable | A L |
| gate.front | SNI www.google.com with a different Host header (youtube, translate.goog, googleusercontent): domain fronting through Google's front end | A L |
| gate.sni_spoof | SNI www.google.com sent to a non-Google IP (srv) | L |
| gate.probes | Abuse the captive-probe URLs to fetch content (connectivitycheck, captive.apple.com, msftconnecttest) | A L i |
| gate.portal | Can the portal on :80 be used to reach anything upstream | A L i |

### 4. VPNs, tunnels and proxies
| id | Trick | Plat |
|---|---|---|
| vpn.wg | WireGuard on 51820, 443 and 53 (srv) | A L i |
| vpn.ovpn | OpenVPN TCP 443 / UDP 1194 (srv) | A L |
| vpn.ikev2 | IKEv2/IPsec 500/4500 (built-in OS client) (srv) | A L i |
| vpn.ssh | `ssh -D` SOCKS proxy over 22 and 443 (srv) | L |
| vpn.ss | Shadowsocks / v2ray / trojan on 443 (srv) | A L |
| vpn.warp | Cloudflare WARP / 1.1.1.1 app | A L i |
| vpn.tor | Tor, obfs4, snowflake (WebRTC plus fronting) | A L |
| vpn.psiphon | Psiphon (multi-transport, fronted) | A L |
| vpn.relay | iCloud Private Relay | i |
| vpn.browser | Opera VPN, Edge Secure Network | A L |
| proxy.http | HTTP CONNECT proxy, web proxies, Google Translate as a proxy | A L i |

### 5. Layer 2 / ARP (the core of how the box intercepts traffic)
| id | Trick | Plat |
|---|---|---|
| l2.static_arp | Permanent ARP entry pointing at the real router's MAC | L A(root) |
| l2.ignore_garp | Ignore gratuitous ARP (`arp_accept=0`, arptables) | L A(root) |
| l2.counter_spoof | Kid ARP-spoofs the box or the router back | L |
| l2.direct_mac | Send frames to the router's MAC while keeping the box's IP route | L |
| l2.ra | Rogue IPv6 router advertisement, or a preferred v6 default route | L |
| l2.isolation | AP client isolation / proxy ARP on: does interception still work (setting toggled by the owner) | A L |

### 6. Identity
| id | Trick | Plat |
|---|---|---|
| id.randmac | Per-network random MAC; Android "non-persistent" re-randomizes on every reconnect | A i |
| id.newmac | Change the MAC by hand mid-pause | L A(root) |
| id.forget | Forget the network and rejoin | A L i |
| id.hostname / id.dhcpid | Change the hostname or DHCP client ID | A L |
| id.staticip | Static IP, including an unused one and the parent device's IP | A L |
| id.clone_parent | Clone an unpaused parent device's MAC (parent device online and offline) | L A(root) |
| id.other_ssid | Switch Homenet5 ↔ Homenet2 | A L i |

### 7. Box resilience and timing
| id | Trick | Plat |
|---|---|---|
| box.restart | Restart the blocker container or the whole box: measure the fail-open window and re-block time | all |
| box.race | Rapid pause/unpause, plus a pause applied during DHCP renewal | A L |
| box.flood | Kid floods ARP or DHCP, or generates connection churn: does blocking hold, does the box stay up | L |
| box.many | 30 fake MACs on the network (laptop macvlans): does enforcement scale | L |
| box.reboot_dev | Device reboots while paused | A L i |

### 8. Collateral (unpaused devices must be untouched)
| id | Check | Plat |
|---|---|---|
| col.parent | Unpaused device: throughput and latency through the box vs direct, no loss | A L i |
| col.v6 | Unpaused device's IPv6 works | A L i |
| col.testblock | The "Test block" button's verdict matches reality in each scenario | A L |

## Runner

- `lab/devices/escape.py`: stdlib Python, one file. Scenarios live in `lab/devices/scenarios.toml`
  (stdlib `tomllib`). Each scenario has: `id`, `platforms`, `setup`/`probe`/`teardown` shell commands
  per platform, `expect_alert`, and `needs_server`.
- Each platform has a driver: a function that runs a shell command on that client (adb, ssh, mac-ssh).
- Pause/unpause goes through the blocker internal API on the box over ssh.
- Each run writes `lab/devices/runs/<ts>/results.json` plus `report.md` (a score table and a diff
  against the previous run). The `runs/` folder is gitignored.
- Flags: `--only dns.*`, `--platform A`, `--repeat N`. Timing rows run 5 times, and flaky results count
  as LEAK.

## The honing loop

1. Run the full matrix and rank the LEAK and PARTIAL rows by severity: how easy the trick is for a kid
   × how much it leaks.
2. For the worst row, find the root cause in the blocker and make a fix on a `fix/escape-<id>` branch,
   following test-driven development.
3. Deploy to the beta box with `TASK4CE_REF=<full sha>` (cached branch tarballs are stale). Grep the
   container to confirm the change is there.
4. Re-run the full matrix to catch regressions. Keep the fix only if the score improves and nothing
   else gets worse.
5. Repeat until no LEAK rows remain. Rows that can't be fixed by design get recorded in the "What it
   can't do" section of `docs/blocker.md`.

## Phasing

1. Runner, Android driver, rows that need no server, alert oracle.
2. Canary on Beast through the CF tunnel (HTTP/WS rows, plus WS-carried WireGuard/v2ray); then a VPS for the raw rows.
3. Laptop driver, layer 2 / identity / box-resilience rows.
4. iPad via the MacBook.
5. Honing loop.

## Not covered

- Mobile data and hotspots (the box is home Wi-Fi only).
- Physical access to the box.
- Sibling devices.
