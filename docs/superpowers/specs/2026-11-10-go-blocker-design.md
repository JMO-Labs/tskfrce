# Go blocker — design (draft)

Date: 2026-11-10 · Branch: `feat/constrained-perf` · Status: **approved 2026-11-10** (owner answers below)
Parent spec: `2026-11-10-constrained-devices-design.md`. Owner decision 2026-11-10: very small boxes (Pi Zero 2 W 512MB,
Pi 3 1GB) get a compiled binary. **Approved scope: rewrite only the blocker, in Go.** Backend (FastAPI) and frontend stay.

## Owner decisions (2026-11-10)
1. **Homework merges now** (PR #88 into `feat/declutter`). Go is built against the stack *with* homework: H1–H6 are in
   scope for Go v1, not deferred.
2. **Production reachability bug: option 1.** The blocker also binds the `task4ce` bridge gateway address; the backend's
   `BLOCKER_URL` points there. Token still required. Shipped as a separate hotfix PR to `main`, not part of this project.
3. **Exit bar approved** as written. **`install.sh` picks Go automatically on boxes under 1.5GB RAM** once Go is opt-in
   ready (contract + lab green), before the global default switch.
4. **Bare binary: deferred** until there is a full native stack (backend + frontend). Ship only the `blocker-go` image
   now; drop the release binaries and systemd unit from this project's scope (keep the `fail-open` subcommand).
5. **The three deviations are approved** (startup fetch, `/state` during test block, fail-open on panic).

## Intent
Cut the blocker from ~58MB RSS (scapy; `docs/perf/2026-11-profile.md`; OOM-killed at a 130MB cap under QEMU arm64) to
~15MB, as one static binary that runs in Docker or under systemd. **Every behaviour stays. No security property gets
weaker.** Python stays the default until parity is proven.

## Non-goals
- Policy changes. The blocker is policy-free: penalties, per-app pricing, schedules, chores and MAC-rotation matching
  (`backend/app/api/internal.py:_note_new_address`, `app/lock/hints.py`, `app/lock/identity.py`) live in the backend and
  reach the blocker only as the `blocked` MAC list. Neither `feat/penalties` nor `feat/per-app-pricing` touches `blocker/`.
- Changing the backend↔blocker contract, env variables, or compose security posture.
- Fixing known blocker limitations during the port. Parity first; fixes later, in both implementations (see "Parity quirks").

## Anti-goals (security)
None may weaken. Each maps to a parity item and a test.
- **Spoof resistance.** Enforcement keyed on MAC (F27, F31). Two-way redirection (F23). Never spoof gateway/box/portal
  IPs, never enforce on infrastructure MACs (F15–F17). Heal only with real resolved MACs (F24). Untrusted inputs checked:
  DHCP router inside leased subnet (F50, F52), VLAN ARP sender (F55), DHCP `chaddr == ether src` (F40), mDNS A record
  matching source IP and MAC (F42).
- **Fail-open.** SIGTERM/SIGINT heal every device and delete the nft table (F58–F60). A failed rule load never crashes
  the service (F29). The ruleset never holds an invalid portal target (F28). New for Go: a goroutine panic must not leave
  the table loaded with nothing enforcing or healing (see "Go-specific safety").
- **Authz.** `X-Internal-Token` compared in constant time, must be non-empty (F3). API binds `127.0.0.1` by default
  (F2). Bodies capped at 64KiB (F4). Requests not logged (F8). MACs validated before the firewall (F11, F21).
- **Privilege.** Only `NET_ADMIN` and `NET_RAW`, never privileged (`blocker/tests/test_compose.py`). No new listening
  ports, no new outbound destinations.

## Feature parity list (Python on `main` as of `4ceab3db`; paths under `blocker/`)

### Config (`config.py`)
- F1 Env: `BACKEND_URL` (`http://backend:8000`), `INTERNAL_TOKEN` (fallback `{DATA_DIR}/secrets.json` key
  `INTERNAL_TOKEN`; startup fails if empty), `LAN_IFACE` (empty = auto), `DATA_DIR` (`/data`), `BLOCKER_PORT` (7777),
  `BLOCKER_BIND` (`127.0.0.1`), `BLOCKER_URL_HOST`, `SCAN_INTERVAL` (20), `RECONCILE_INTERVAL` (30), `RESIST_INTERVAL`
  (15), `PORTAL_REDIRECT_URL` (`http://task4ce.local/kid`), `MIRROR_IFACE` (empty). Intervals are floats.

### Blocker HTTP API (`api.py`)
- F2 Listens on `BLOCKER_BIND:BLOCKER_PORT`; Python's HTTPServer handles one request at a time.
- F3 `/state` and `/test-block` need `X-Internal-Token` (`hmac.compare_digest`). Missing/wrong → `403
  {"error":"forbidden"}`. Auth checked before the body is read.
- F4 Body > 64KiB (by `Content-Length`) → 400 "The request body is too large.". Invalid JSON is null → 400 "The request
  body must be a JSON object.".
- F5 `GET /health` → `200 {"ok":true}`, no auth.
- F6 `POST /state {"blocked":[mac...]}`. Non-list → 400 "'blocked' must be a list of MAC addresses.". MACs lowercased,
  checked against `^([0-9a-f]{2}:){5}[0-9a-f]{2}$`; failure → 400 "'<mac>' is not a valid MAC address.". Success →
  `200 {"ok":true,"count":n}`.
- F7 `POST /test-block {"mac":str}`. Malformed → 400 "The request body must be a JSON object with a 'mac' text value.".
  Invalid MAC → 400. Success → 200 with the result (F35).
- F8 Unknown method/path → `404 {"error":"not found"}`. Exact path match (query string → 404). All responses JSON with
  Content-Length. No access log.

### Backend client (`backend.py`)
- F9 Base `BACKEND_URL` + `/api/v1/internal`. Every call sends `X-Internal-Token`, 5s timeout, best-effort (log, never raise).
- F10 `POST /devices/seen`: always `mac, ip, ipv6, hostname, vendor` (nulls allowed). `mdns_name`, `model`, `dhcp_fp`,
  `vid` **omitted when None, never null** (backend reads missing `vid` as "keep old"). `mdns_name`, `model`, `dhcp_fp`
  cut to 255 chars.
- F11 `GET /state` → `{"blocked","listen_only","covered_vlans"}`. Unreachable/malformed → keep last state.
- F12 `POST /devices/resisting {"resisting":[sorted macs]}` every `RESIST_INTERVAL`, **even when empty** (clears flags;
  heartbeat: backend stamps `blocker_last_seen` on `/state`, `/resisting`, `/hits`, `/workarounds`; offline after 90s).
- F13 `POST /devices/hits {"hits":{mac:n}}` then `POST /devices/workarounds {"found":{mac:[sorted cats]}}`, only when
  non-empty, same tick, that order (`service.py:_resist_once`).
- F14 `POST /vlans {"vlans":[{"vid","macs","subnet"}]}` every 60s, only when non-empty (`vlan.py`).

### Enforcement core (`service.py`, `state_store.py`)
- F15 `_apply` = one serialized compute→apply under one lock, re-reading the store inside it. Runs on every store change,
  on `_on_seen` for a blocked MAC, around a test block, and on every reconcile (even unchanged).
- F16 Refuses infrastructure MACs: gateway v4/v6, box, every VLAN site's gateway and box (`SiteManager.infra`). Logs a warning.
- F17 Strips unsafe target IPs: gateway v4/v6, portal/box, site gateway IPs. Duplicate device IPs stay enforced.
- F18 `listen_only`: blocked set empty, rules still applied, discovery keeps running.
- F19 Address freshness: last-known addresses kept (dodging device goes quiet). After `ADDR_TTL` (600s) an address drops
  only if another MAC reported it more recently.
- F20 Segments: a MAC is redirected on every VLAN where seen within `ADDR_TTL`; latest segment uses vetted live
  addresses, older ones re-stripped (`_by_segment`).
- F21 Store holds the authoritative blocked set; validates/lowercases MACs (ValueError → 400). Callbacks run outside the lock.
- F22 Reconcile: `GET /state` every `RECONCILE_INTERVAL`, **first fetch after one interval, not at startup**. Applies
  `listen_only`, `sites.sync(covered_vlans)`, sets blocked.

### ARP/NDP redirection (`arp.py`)
- F23 Per active target (blocked, has IP), every 2s: ARP reply to the device "gateway IP is at box MAC"; if gateway MAC
  known, ARP reply to the gateway "device IP is at box MAC". Per IPv6 address with a v6 gateway: NDP NA (R=1,S=0,O=1,
  target-LL), plus reverse NA (R=0) to the gateway if its MAC is known.
- F24 Heal on removal: 4 rounds, 1.2s apart, **from the same loop that spoofed** (no spoof after a restore). Round
  skipped if re-blocked meanwhile. Truthful ARP to device and gateway, truthful NAs. A family heals only if its real
  gateway MAC is known; never guesses or broadcasts.
- F25 LAN facts: v4 gateway from default route; v6 gateway = next hop of route to `2000::` pinned to `LAN_IFACE`.
  Gateway MACs via ARP/ND (scapy `getmacbyip`, sends a request if needed). While unresolved, re-detect every 30s; keep
  last good facts on failure.
- F26 Portal/box IP = IPv4 of `LAN_IFACE or "eth0"`, read once at startup.

### Firewall (`firewall.py`)
- F27 Table `inet task4ce`, loaded atomically (`add table; flush table; table {...}` in one `nft -f`). Sets `blocked_v4`,
  `blocked_v6`, `blocked_mac`. Prerouting nat (prio -100) DNATs udp/53 + tcp/53 from blocked v4 to `portal:53`, tcp/80 to
  `portal:80`. Forward filter (prio 0): LAN-accept, return-drop, MAC-drop, 443-drop, IP-drop, in `render_ruleset` order.
  LAN CIDRs: RFC1918, `fe80::/10`, `fc00::/7`.
- F28 No portal IP → all DNAT rules omitted; drops still apply.
- F29 Load failure logged, service continues; previous table stays (atomic).
- F30 Startup sets `ip_forward` and IPv6 `all/forwarding` to 1; failure only warns.
- F31 MAC set is the authoritative key; IP sets drive the portal and add defence in depth.

### Resistance and test block (`resist.py`, `service.py:test_block`)
- F32 Sniffer runs only while targets are watched; restarts when the set changes. BPF:
  `ether dst <box> and (ether src <gw...> or <kids...>)`.
- F33 30s windows per MAC. Watched device → box counts `to_box`. Gateway MAC → box counts `from_gateway` when IP dst is a
  watched (canonicalized) IP and IP src is outside LAN CIDRs. "Resisting" = `from_gateway >= 20` in the window. Reported
  set = base LAN ∪ all sites.
- F34 Test block: validate MAC, overlay on the enforced set (store untouched), reset tally, wait 10s, read tally, remove
  overlay, re-apply.
- F35 Result `reason`: `unseen` (no IP), `device` (`from_gateway > 0`), `ok` (`to_box > 0`), `quiet`. `ok` → `quiet` if the
  device has IPv6 but no v6 gateway MAC. Also carries deprecated `offline`, `router_resisted`, exact `TEST_MESSAGES` strings.

### Discovery (`discovery.py`, `identity.py`)
- F36 Every `SCAN_INTERVAL + uniform(0, min(2, 0.1×interval))`s: broadcast ARP sweep of the **/24 from the interface
  address** (2s timeout), then NDP echo to `ff02::1` (2s, multi-answer). NDP failure only logged.
- F37 Only ARP responders reported. IPv6 addresses attached per MAC, max 8. Reverse-DNS hostname, cut to 255.
- F38 Vendor = 24-bit OUI in `data/oui.csv`; locally-administered bit → "Private MAC".
- F39 Each device → `report_seen` (sync) → `on_seen` (signals, address tracking, segments; re-apply if blocked).

### Passive signals (`signals.py`)
- F40 DHCP: sniff udp 67/68, BOOTREQUEST only, `chaddr[:6] == ether src`. Fingerprint = option 55 in order, comma-joined.
  **Exact format required** (backend hints and identity matching use it).
- F41 mDNS: sniff udp/5353. Every 300s send a multicast PTR query (raw L3, `224.0.0.251`, ttl 255, sport/dport 5353) for
  `_device-info._tcp`, `_companion-link._tcp`, `_airplay._tcp`.
- F42 mDNS answer accepted only if a response with an A record equal to the IP source (`.local` stripped), and the single
  MAC seen for that IP within 600s equals ether src. Model from TXT `model=`, fallback `md=`.
- F43 Signals reported only for MACs discovery knows, only when new/changed, merged with cached values and last `Seen`
  (incl. `vid`).

### Captive portal (`portal.py`, `hits.py`)
- F44 DNS on UDP `0.0.0.0:53`, reads ≤512 bytes. Drop if sport 53, response, opcode ≠ 0, qdcount ≠ 1, or unparsable.
  A → box IP, TTL 30, `aa=1`, `ra=1`, `rd` copied. Other types → NOERROR, no answer. No TCP DNS listener even though
  tcp/53 is DNAT'ed (quirk kept).
- F45 HTTP on `0.0.0.0:80`, concurrent, 5s timeout. Every method → `302 Location: PORTAL_REDIRECT_URL`,
  `Content-Length: 0`. Not logged.
- F46 Hits: client IP → MAC via the enforced IP→MAC map; ≤1 hit per MAC per 10s; drained on the resist tick.

### Workarounds (`workaround.py`, `data/workaround_domains.txt`)
- F47 Each portal DNS query name matched against `vpn`, `private_dns`, `proxy`, `tor` (exact or subdomain); longest suffix
  wins; `ignore` cancels.
- F48 Grouped per MAC via the enforced IP→MAC map, cap 1,000 MACs between drains, categories sorted.

### VLAN detection and sites (`vlan.py`, `sites.py`, `udhcpc.sh`)
- F49 Detector **only listens**: 802.1Q frames on `LAN_IFACE` and `MIRROR_IFACE`, vid 1–4094. Counts distinct source MACs,
  votes a /24 per vid. ARP sender IP counts only if `hwsrc == ether src`, private v4, not unspecified/link-local. Never
  creates device rows.
- F50 `sync(covered_vlans)` only when `LAN_IFACE` set. Reuse `<lan>.<vid>` or `br0.<vid>`, else create `<lan>.<vid>` and
  record it. Link up; `busybox udhcpc -i <if> -s /app/udhcpc.sh -b -p /run/blocker/udhcpc-<if>.pid` if no address. New
  sites wait ≤15s for a lease; existing passive sites only re-check.
- F51 No lease/router → passive, never enforces. With a lease: own discovery (`vid` set), redirection (v4 only; router
  MAC via ARP who-has), resistance watch.
- F52 DHCP routers untrusted: used only inside the leased subnet and not the box's own IP. `udhcpc.sh` applies a lease only
  if private, prefix /16–/30, no overlap with another interface's route; never adds a default route; records the router in
  `/run/blocker/<if>.router`.
- F53 Teardown: heal + stop the watch, kill udhcpc via pidfile, delete the interface **only if the box created it**.
- F54 Site gateway and box MAC/IP feed infrastructure exclusions (F16–F17).
- F55 See F49 (ARP trust check).

### Concurrency and lifecycle (`service.py`)
- F56 Each subsystem in its own daemon thread; an exception kills only that thread/iteration; process keeps running.
- F57 Startup: portal IP, forwarding, resistance watch, then reconcile, resist, discovery, VLAN (only if LAN/mirror iface
  set), DHCP, mDNS, DNS portal, HTTP portal, API.
- F58 SIGTERM/SIGINT → `stop()`: stop watch, stop sites (heal), stop redirections (heal; ≤~6.8s per thread), **always**
  delete the table (`finally`), shut down API.
- F59 Heal finishes inside Docker's default 10s stop grace.
- F60 No state on disk; only reads `secrets.json`. Restart rebuilds from `/state`.

### Homework mode (unmerged `feat/homework-mode`, ~1,000 blocker lines) — parity target H
- H1 `/state` and `GET /internal/state` gain `homework: {mac: {allow[], block[], until}}`. ≤1,000 names per list, names
  ≤253 chars, `until` ISO with timezone.
- H2 Portal DNS forwards allowed names to `UPSTREAM_DNS` (fallback `/etc/resolv.conf`, ignoring 127.x). Replies accepted
  only from a connected socket with matching txid and question; only A records owned by the name or its CNAME chain count.
- H3 `hw_out` (`ether . ipv4`) and `hw_back` (`ipv4 . ipv4`) sets with per-element timeouts (300–3600s, never past `until`).
  Accept rule before drops; tcp/80 `return` before portal DNAT. Table reloaded with `delete table`, not `flush`.
- H4 Conntrack entries deleted on cut (`conntrack` CLI).
- H5 `POST /homework/activity` in chunks of 500.
- H6 Gate follow window 10s; cap 5,000 names per session.

Go need not have H to ship opt-in. Go **must** have H before becoming default if homework has merged. Without H, Go ignores
`homework` and kids in homework mode are fully blocked: fails closed (not a security issue) but a feature regression.

### Parity quirks (keep in Go v1; fix later in both)
/24-only discovery (F36); IPv6-only devices never reported (F37); tcp/53 DNAT'ed to no listener (F44); reverse DNS blocks
the scan (F37); first reconcile after 30s (F22).

## Backend↔blocker contract (frozen)
F1–F14, plus H1 and H5 once homework merges. Backend side: `backend/app/lock/blocker_client.py` (push 5s, test-block
20s) and `backend/app/api/internal.py` (Pydantic: ipv6 ≤8, strings ≤255, `vid` 1–4094, ≤1,000 MACs per report, hits
1–10,000, fixed workaround categories). The contract suite below is the executable copy.

**Production bug found (verified in `docker-compose.prod.yml` on `main` and this branch, independent of Go).** The backend
runs on the `task4ce` bridge; `BLOCKER_URL` defaults to `http://127.0.0.1:7777` (`backend/app/core/config.py:58`), which
inside the container is its own loopback. The blocker binds `127.0.0.1` on the host. So backend pushes and Test block
cannot reach the blocker in production: blocking waits for the 30s reconcile, and Test block returns 503. The lab sets
`BLOCKER_URL`/`BLOCKER_BIND` explicitly, so CI misses it. Fixed separately (owner decision).

## Go design

### Layout (*builder's call*)
- `go.mod` at `blocker/` so `//go:embed` reads `blocker/data/oui.csv` and `workaround_domains.txt` directly (one data copy).
- `cmd/blockerd/main.go` + `internal/{config,api,backend,store,service,redirect,firewall,resist,discovery,identity,signals,
  portal,workaround,hits,vlan,sites}`, mirroring the Python modules one to one for side-by-side review.
- `Dockerfile.go` + `Dockerfile.go.dockerignore` (keeps `.py`, `.venv` out).

### Libraries (no cgo, static, pure Go)
| Need | Choice | Rejected |
|---|---|---|
| L2 capture/send | `github.com/mdlayher/packet` (AF_PACKET, attaches BPF) | `gopacket/pcap` (cgo, libpcap); `gopacket/afpacket` (cgo) |
| Packet filters | Hand-assembled `golang.org/x/net/bpf` programs, unit-tested in `bpf.VM` on fixture frames | libpcap compiler (cgo) |
| Decode/build | `github.com/gopacket/gopacket/layers` (pure Go) via `DecodingLayerParser` | mdlayher `arp`/`ndp`/`ethernet` also fine (*builder's call*) |
| DNS | `golang.org/x/net/dns/dnsmessage` | `miekg/dns` (bigger, server unneeded) |
| nftables | `github.com/google/nftables` (netlink, atomic batch, sets, concatenations, timeouts) | `nft` CLI (not static); kept as documented fallback |
| Routes/neigh/links/VLANs | `github.com/vishvananda/netlink` | `ip` CLI |
| Conntrack (H4) | `github.com/ti-mo/conntrack` | `conntrack` CLI |
| VLAN DHCP client | Phase 1: keep `busybox udhcpc` + `udhcpc.sh`. Phase 2 (*builder's call*): `insomniacslk/dhcp/nclient4` with lease_ok ported | — |
| HTTP/JSON/logs/rDNS | stdlib `net/http`, `encoding/json`, `log/slog`, `net.Resolver` (pure Go, 2s) | — |

Build: `CGO_ENABLED=0 GOOS=linux GOARCH={amd64,arm64,arm} GOARM=7 go build -trimpath -ldflags "-s -w -buildid="`.
Toolchain pinned in `go.mod`.

### Mapping decisions
- Threads → goroutines, one per redirect target; F24 spoof→heal ordering stays inside it. `context` cancellation; blocking
  reads unblocked by closing the socket (no 0.5s poll loops), so idle = asleep.
- Vendor table: sorted `[]uint32` OUI prefixes + `[]uint16` index into deduped names, binary search (<0.5MB vs ~5MB map).
- Gateway MAC (F25): netlink neighbour table first, else raw ARP/ND solicit with 2s wait.
- mDNS query (F41): raw frame with sport 5353; **never bind :5353** (avahi clash).
- Firewall as a value: pure function of `(v4, v6, macs, lan_cidrs, portal_ip, port[, hw pairs])` → rule description,
  applied via netlink and printable as nft text for golden comparison and debug.

### Go-specific safety
- `recover()` wrapper on every goroutine: log and restart the loop (matches F56). A panic never ends the process with the
  table loaded and nothing healing.
- Fatal path runs fail-open (delete table) before exit.
- `blockerd fail-open` subcommand deletes the table; systemd `ExecStopPost=` runs it so OOM/SIGKILL still fail open. In
  Docker, `restart: unless-stopped` + atomic reload on next start = today's behaviour.
- `/test-block` serialized behind a mutex; `/state` stays answerable during it (deviation 2).
- `http.MaxBytesReader` caps bodies (covers chunked; strictly safer than Python's `Content-Length` check).
- `subtle.ConstantTimeCompare` on the token; empty token rejected at startup.

### Proposed deviations from strict parity (owner question)
1. Fetch state once at startup (closes the ≤30s gap after restart/switch).
2. Answer `/state` during a test block.
3. Fail-open on panic and via `ExecStopPost`.

## How parity is proven
0. **Contract suite first, green on Python before any Go.** `blocker/tests/contract/` (pytest, black-box, selected by
   `BLOCKER_IMAGE=`): blocker on a Docker bridge with a recording fake backend, scripted router and kid, `tcpdump` on a
   peer. Asserts F2–F8 statuses/bodies (auth before body, size cap, exact strings); F9–F14 call shapes and timing (`vid`
   absent not null, `resisting` sent when empty, hits/workarounds only non-empty); F23 spoof frames both directions every
   2s; F24 heals with true MAC, 4 rounds, none after; F16–F17 infra refusal; F44–F45 portal details; F40–F43 formats;
   F58 fail-open (table gone, heals seen within 10s of SIGTERM).
1. **Shared golden fixtures** in `blocker/tests/fixtures/` (pcaps: DHCP, mDNS, DNS, VLAN/ARP, spoofed variants + expected
   JSON), read by both pytest and `go test`.
2. **Firewall equivalence** in a CI netns: Python `render_ruleset` via `nft -f` vs Go netlink apply, both read back with
   `nft -j list table inet task4ce`, normalized and compared over property-generated inputs.
3. **Ported unit tests**: every `blocker/tests/test_*.py` case as a Go table test; `go test -race`; native fuzzing of the
   DNS/DHCP/mDNS/VLAN parsers and API JSON (short in CI, long nightly).
4. **Lab e2e matrix**: `lab/docker-compose.lab.yml` takes `BLOCKER_DOCKERFILE`; CI `lab` job runs `impl: [python, go]`
   over `tests/lab/*` and the browser e2e. Go image ships busybox `sh`/`ip` so the lab entrypoint works unchanged.
5. **Tier harness + soak**: `scripts/tier.sh zero2w-512 gate` and `pi3-1g` with `BLOCKER_IMPL=go`, `BLOCKER_MEM=32m`.
   Soak adds a blocker gate: RSS growth ≤2MB, stable goroutine count.

**Exit criteria for Go as default** (owner question): contract suite green on both; Go lab matrix green 10 consecutive CI
runs; tier + soak gates pass on Zero 2 W and Pi 3; H parity if homework merged; 4 weeks on the owner's box with zero
fail-open or bypass regressions.

## Packaging
- **Image** `ghcr.io/jmo-labs/tskfrce/blocker-go` from `blocker/Dockerfile.go`: `FROM --platform=$BUILDPLATFORM golang:<pinned>`
  cross-compiling via `TARGETARCH`/`TARGETVARIANT` (no QEMU); final `FROM scratch` + binary + static busybox (`sh`, `ip`,
  `udhcpc`) + `/app/udhcpc.sh`. Root with only NET_ADMIN/NET_RAW (as today). Platforms amd64, arm64, arm/v7. CI `docker`
  matrix adds `blocker-go`; Trivy covers it.
- **Bare binary**: release assets `task4ce-blocker-linux-{amd64,arm64,armv7}`, `SHA256SUMS`, provenance attestation, and
  `packaging/task4ce-blocker.service` (`User=task4ce-blocker`; `AmbientCapabilities=CAP_NET_ADMIN CAP_NET_RAW
  CAP_NET_BIND_SERVICE` + matching bounding set; `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`;
  `RuntimeDirectory=blocker`; `EnvironmentFile=/etc/task4ce/blocker.env` 0600; `ExecStopPost=… fail-open`;
  `Restart=always`). Forwarding via `/etc/sysctl.d/90-task4ce.conf` (F30 only warns, so parity holds).

## Rollout
1. PR 1: contract suite + fixtures, green on Python. No Go.
2. PR 2…n: Go package by package with ported tests; `Dockerfile.go`; CI `go vet`, `staticcheck`, `go test -race`,
   `govulncheck`, fuzz smoke, 3-arch cross-build, contract suite on both images. Lab matrix: Go non-blocking until green.
3. Opt-in: `docker-compose.prod.yml` gains `blocker-go` (`profiles: ["blocker-go"]`, same env, host network, same caps).
   Users set `COMPOSE_PROFILES=blocker-go`; `install.sh --blocker=go`. **Python stays default.** `test_compose.py` asserts
   both keep host network, exactly two caps, no data volume. Docs: `docs/blocker.md`, `blocker/README.md`.
4. Switch default once exit criteria pass (owner sign-off); later remove Python.
5. Rollback any time: change `COMPOSE_PROFILES`, `docker compose up -d`. Old container heals and deletes the table on
   SIGTERM; stateless, so no migration.

## Targets (*builder's call* to tighten after first measurement)
| Metric | Python today | Go target |
|---|---|---|
| RSS idle (10 devices, 0 blocked) | ~58MB | **≤15MB** |
| RSS peak (lab load, 10 blocked) | 58–83MB | **≤25MB**, `GOMEMLIMIT=24MiB` |
| Zero 2 W container cap | 70m | 32m |
| Idle CPU, Zero 2 W tier | part of stack's 1.5–3.3% | **≤0.5% of a core** |
| Time to `/health` 200 | seconds | **≤1s** |
| Binary / compressed image | ~150MB+ image | **≤12MB / ≤15MB** |
| 10-min soak growth | stack +10% +10MB | **≤2MB**, goroutines stable |

## Risks
- **VLAN tags on AF_PACKET**: kernel/NIC strip 802.1Q on receive. Use `PACKET_AUXDATA` (`tp_vlan_tci`) and the BPF VLAN
  ancillary load. Add a lab VLAN journey (none today).
- **netlink vs text ruleset drift** (e.g. implicit `meta iiftype ether` for `ether saddr` in inet; anonymous interval
  sets). Covered by golden comparison.
- **Homework is a moving target.**
- **Dual maintenance** until Python is removed; the contract suite prevents silent drift.

## Builder's calls (recorded)
Module layout; `gopacket/layers` vs mdlayher; busybox udhcpc in phase 1; vendor table encoding; debug goroutine count on
`/health` (localhost only); exact `GOMEMLIMIT`.

## Critical files
`blocker/{service,arp,firewall,api,sites,resist,signals,portal}.py`, `backend/app/api/internal.py`,
`backend/app/lock/blocker_client.py`, `docker-compose.prod.yml`, `lab/docker-compose.lab.yml`,
`.github/workflows/ci-cd.yml`, `docs/perf/2026-11-profile.md`, homework diff on `feat/homework-mode`
(`blocker/homework.py`, `upstream.py`, `hw_wiring.py`).
