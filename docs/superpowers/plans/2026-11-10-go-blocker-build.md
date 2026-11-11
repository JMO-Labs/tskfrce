# Go Blocker Build Plan

Status: In progress
Date: 2026-11-10

## Phase 1: Contract Suite & Fixtures (PR-1)
Goal: Executable parity reference, green on Python blocker. No Go yet.

### P1-1: Contract suite structure
- [ ] Create `blocker/tests/contract/` directory
- [ ] Create `blocker/tests/contract/conftest.py` (fixtures: fake backend, docker bridge, tcpdump peer)
- [ ] Create `blocker/tests/contract/test_api.py` (F2–F8: auth, body cap, exact response strings)
- [ ] Create `blocker/tests/contract/test_backend.py` (F9–F14: call shapes, timing, vid field handling)

### P1-2: Shared golden fixtures
- [ ] Create `blocker/tests/fixtures/` with pcap files (DHCP, mDNS, DNS, VLAN/ARP, spoofed variants)
- [ ] Create `blocker/tests/fixtures/expected_json.py` (JSON outputs for golden comparison)

### P1-3: Contract suite asserts
- [ ] F23 spoof frames both directions every 2s
- [ ] F24 heals with true MAC, 4 rounds, none after
- [ ] F16–F17 infra refusal
- [ ] F44–F45 portal details
- [ ] F40–F43 formats (DHCP fingerprint, mDNS, DNS)
- [ ] F58 fail-open (table gone, heals seen within 10s of SIGTERM)

### P1-4: Verify contract suite on Python
- [ ] Run contract suite against Python blocker
- [ ] All asserts pass
- [ ] Commit and push

## Phase 2: Go Implementation (PRs 2-n)
Goal: Package-by-package port with ported unit tests. Each PR: tests green, `go test -race`, `go vet`, `staticcheck`, `govulncheck`.

### P2-0: Go setup
- [ ] Create `blocker/go.mod` pinned to go1.26.2, import essential libraries (mdlayher/packet, google/nftables, etc.)
- [ ] Create `blocker/Dockerfile.go` (FROM golang cross-compile, final scratch + busybox + udhcpc.sh)
- [ ] Create `blocker/Dockerfile.go.dockerignore`
- [ ] CI: add `go vet`, `staticcheck`, `govulncheck`, 3-arch cross-build, contract suite on both images

### P2-1: Config package (`internal/config`)
- [ ] Port `config.py` F1: env parsing, defaults, token/secrets.json fallback, empty token fail
- [ ] Unit tests: env override, secrets.json read, defaults
- [ ] Commit: "feat(blocker/go): implement config package"

### P2-2: API package (`internal/api`)
- [ ] Port `api.py` F2–F8: HTTP routes, auth, size cap, exact responses, no logging
- [ ] Constant-time token compare, MaxBytesReader for cap
- [ ] Unit tests: auth failures, body cap, malformed JSON, missing auth, unknown paths
- [ ] Commit: "feat(blocker/go): implement api package"

### P2-3: Store package (`internal/store`)
- [ ] Port `state_store.py` F15, F21: state storage, validation, MAC lowercasing
- [ ] Unit tests: MAC validation, invalid MACs reject, case normalization
- [ ] Commit: "feat(blocker/go): implement store package"

### P2-4: Backend client (`internal/backend`)
- [ ] Port `backend.py` F9–F14: HTTP client, 5s timeout, token header, best-effort logging
- [ ] vid field omit-when-None (not null)
- [ ] Unit tests: call shapes, missing fields omitted, error handling
- [ ] Commit: "feat(blocker/go): implement backend client"

### P2-5: Firewall package (`internal/firewall`)
- [ ] Port `firewall.py` F27–F31: nftables ruleset generation, atomic load, fail-open
- [ ] IP set vs MAC set authoritative keying
- [ ] netlink batch apply
- [ ] Unit tests: ruleset generation, set building, portal IP omission
- [ ] Golden comparison: render_ruleset Python vs netlink Go, normalize, compare
- [ ] Commit: "feat(blocker/go): implement firewall package"

### P2-6: ARP/NDP redirect (`internal/redirect`)
- [ ] Port `arp.py` F23–F26: ARP/NDP spoofing, 2s cadence, heal 4 rounds 1.2s apart
- [ ] Gateway MAC resolution (netlink then ARP/ND solicit)
- [ ] LAN facts detection
- [ ] Goroutine per active target, recovery on panic
- [ ] Unit tests: spoof frame format, heal sequence, MAC resolution
- [ ] Commit: "feat(blocker/go): implement redirect package"

### P2-7: Service core (`internal/service`)
- [ ] Port `service.py` F15–F22: orchestration, reconcile tick, apply under lock
- [ ] Startup: portal IP, forwarding, reconcile-once, then subscribe to ticks
- [ ] SIGTERM/SIGINT → stop all, heal, delete table
- [ ] Panic recovery: log, restart loop
- [ ] Commit: "feat(blocker/go): implement service package"

### P2-8: Resistance (`internal/resist`)
- [ ] Port `resist.py` F32–F35: packet sniffer, 30s windows, gateway reachability, test-block
- [ ] BPF program assembly and loading
- [ ] /test-block mutex serialization
- [ ] Unit tests: sniffer window reset, tally read, test-block overlay
- [ ] Commit: "feat(blocker/go): implement resist package"

### P2-9: Discovery (`internal/discovery`)
- [ ] Port `discovery.py` F36–F39: ARP sweep, NDP echo, vendor lookup, report_seen
- [ ] Vendor table: sorted uint32 OUI + uint16 name index, binary search
- [ ] Unit tests: ARP responder parsing, vendor lookup, deduplication
- [ ] Commit: "feat(blocker/go): implement discovery package"

### P2-10: Signals (`internal/signals`)
- [ ] Port `signals.py` F40–F43: DHCP sniff, mDNS query/answer, passive collection
- [ ] DHCP fingerprint format (option 55 comma-joined)
- [ ] mDNS A record validation (IP match, MAC match within 600s)
- [ ] Unit tests: DHCP parsing, mDNS answer validation, signal merging
- [ ] Commit: "feat(blocker/go): implement signals package"

### P2-11: Portal (`internal/portal`)
- [ ] Port `portal.py`, `hits.py`, `workaround.py` F44–F48: DNS, HTTP redirect, hit tallying, workaround matching
- [ ] DNS handling (A-type only, TTL 30, no TCP listener)
- [ ] HTTP 302 redirect
- [ ] Hit rate-limit (≤1 per 10s)
- [ ] Workaround domain matching (vpn, private_dns, proxy, tor)
- [ ] Unit tests: DNS response format, HTTP redirect, hit deduplication
- [ ] Commit: "feat(blocker/go): implement portal package"

### P2-12: VLANs & Sites (`internal/vlan`, `internal/sites`)
- [ ] Port `vlan.py`, `sites.py`, `udhcpc.sh` F49–F55: 802.1Q detection, passive sites, DHCP client integration
- [ ] Listener only (no creation)
- [ ] sync() with covered_vlans, lease validation
- [ ] Router trust check (private, /16–/30, no overlap)
- [ ] Unit tests: VLAN detection, lease validation, subnet checking
- [ ] Commit: "feat(blocker/go): implement vlan package"

### P2-13: Identity & Homework (`internal/identity`, `internal/homework`)
- [ ] Port `identity.py`, `homework.py` H1–H6: homework state API, DNS forwarding, set timeouts, conntrack cleanup
- [ ] POST /homework/activity in chunks of 500
- [ ] hw_out, hw_back sets with per-element timeouts
- [ ] Conntrack entry deletion on cut
- [ ] Unit tests: homework state parsing, set timeout encoding, activity chunking
- [ ] Commit: "feat(blocker/go): implement homework packages"

### P2-14: Main & integration (`cmd/blockerd`, integration)
- [ ] Create `cmd/blockerd/main.go`: config load, service start, signal handling
- [ ] fail-open subcommand
- [ ] GOMEMLIMIT setting for tier gates
- [ ] Build config: CGO_ENABLED=0, 3-arch cross-build
- [ ] Commit: "feat(blocker/go): add main and integrate packages"

## Phase 3: Measurement (after all packages)
Goal: Verify RSS/CPU/startup vs spec targets.

### P3-1: Build Go image
- [ ] `docker build -f blocker/Dockerfile.go -t blocker-go:test .`
- [ ] Verify 3 archs cross-compile (amd64, arm64, arm/v7)
- [ ] Verify image size ≤15MB compressed

### P3-2: Contract suite on Go
- [ ] `BLOCKER_IMAGE=blocker-go:test pytest blocker/tests/contract/`
- [ ] All asserts pass

### P3-3: Tier harness measurement (if `scripts/tier.sh` available)
- [ ] Run on Zero 2 W (512MB RAM) target: RSS idle ≤15MB, peak ≤25MB
- [ ] CPU idle ≤0.5% core
- [ ] Startup ≤1s to /health 200
- [ ] Run on Pi 3 (1GB RAM) target
- [ ] Commit: "perf(blocker): measure Go vs Python (RSS, CPU, startup)"

### P3-4: Soak & goroutine stability
- [ ] 10-min soak: RSS growth ≤2MB, goroutine count stable
- [ ] Measure with `docker stats`

## Phase 4: Verification & Polish
Goal: All checks passing locally before push.

### P4-1: Local CI suite
- [ ] `blocker/tests/contract/` green (both Python and Go images)
- [ ] `go test ./blocker/...` green with `-race`
- [ ] `go vet ./blocker/...` green
- [ ] `staticcheck ./blocker/...` green
- [ ] `govulncheck ./blocker/...` green
- [ ] `go fmt ./blocker/...` clean
- [ ] Fuzz smoke test (short run, no nightly)

### P4-2: Backend & frontend unaffected
- [ ] Backend pytest suite green
- [ ] Frontend build green
- [ ] No .venv deleted, package-lock.json synced

### P4-3: Files under 500 lines
- [ ] Audit all Go files for line count
- [ ] Split oversized packages (e.g., service, firewall)

### P4-4: Dockerfile cleanup
- [ ] Verify scratch base + busybox + udhcpc.sh only
- [ ] No .py files in image
- [ ] NET_ADMIN, NET_RAW only (test with `test_compose.py`)

## Phase 5: Push & PR
Goal: Green CI, ready for review.

### P5-1: Push branches
- [ ] Commit final polish
- [ ] `git push origin feat/go-blocker`

### P5-2: Create PRs
- [ ] PR-1 (if separate): contract suite + fixtures into feat/declutter
- [ ] PR-2: Go implementation (all packages) into feat/declutter
- [ ] PR bodies end with: "🤖 Generated with [Claude Code](https://claude.com/claude-code)"
- [ ] Do NOT merge, no version bump

## Known Deviations (Approved)
1. Startup fetch: get /state once at startup (closes ≤30s gap)
2. /state during test-block: answerable concurrently
3. Fail-open on panic: recover() in all goroutines, ExecStopPost subcommand

## Known Quirks (Keep v1)
- /24-only discovery
- IPv6-only devices never reported
- tcp/53 DNAT'ed to no listener
- Reverse DNS blocks scan
- First reconcile after 30s

## Security Anti-Goals (Non-negotiable)
- Spoof resistance: F23, F31 (MAC keyed), F24 (heal only with real MACs), F50/F52 (router trust)
- Fail-open: F58–F60 (SIGTERM/SIGINT heal + delete table)
- Authz: F3 (constant-time token), F2 (127.0.0.1 bind), F4 (64KiB cap)
- Privilege: NET_ADMIN + NET_RAW only
