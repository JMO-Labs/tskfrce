# Constrained-device profile, November 2026

Spec: `docs/superpowers/specs/2026-11-10-constrained-devices-design.md`. Harness: `scripts/tier.sh <tier> gate`
(see `perf/`). Seeded family: 1 parent, 3 kids, 10 devices, 20 chores, 31 days of runs, 400 device events.

## How it was measured

- **Native x86 tiers**: CPU and memory capped per container (`perf/tiers/*.env`). Latency numbers come from here.
- **arm64 (QEMU)**: real GHCR arm64 images, memory caps only. Boot, function and RSS only; emulation is
  5-20x slower than a board, so its latency means nothing.
- **API p95**: 200 requests per endpoint, 4 concurrent clients, after 20 warm-up requests.
- **Paint**: the box's share of first paint, which is the HTML plus its 21-22 same-origin JS/CSS files.
- **Block**: time from a parent tap (override) to `/internal/state` flipping, 20 samples.
- **RSS**: `docker stats` after warm-up (idle) and at peak under load.
- **Before** = phase 1 images, built before any optimisation (Pi 4 row: the harness's first run). **After** = this branch.

## Results per tier (native)

| Tier (CPU, memory cap) | Worst API p95 | `/internal/state` p95 | Paint | Block max | Idle RSS total | Peak RSS | Startup |
|---|---|---|---|---|---|---|---|
| Pi 4 2GB (1.5, 600MB), before | 204ms | 204ms | 17ms | 0.04s | 260MB | 273MB | 15s |
| **Pi 4 2GB, after** | **109ms** | **30ms** | 14ms | 0.02s | **230MB** | 239MB | 13s |
| Old laptop 4GB (1.2, 900MB), before | 162ms | 98ms | 14ms | 0.07s | 269MB | 280MB | 13s |
| **Old laptop, after** | **166ms** | **47ms** | 14ms | 0.02s | **235MB** | 244MB | 11s |
| Pi 3 1GB (0.8, 450MB), before | 270ms | 200ms | 25ms | 0.09s | 258MB | 270MB | 15s |
| **Pi 3 1GB, after** | **268ms** | **82ms** | 20ms | 0.06s | **232MB** | 242MB | 13s |
| **Pi Zero 2 W 512MB (0.6, 320MB), after** | **312ms** | **95ms** | 27ms | 0.08s | **231MB** | 243MB | 21s |

Every tier passes its gate (see Targets). The slowest endpoint is now always the parent **Today** (`/today`).

Per service on Pi 4, after (before): backend 114MB (120), frontend 58MB (57), blocker 58MB (83). Idle CPU is
1.5-3.3% of the tier for the whole stack.

**Soak (Pi 4, 10 minutes of mixed load):** 267 to 272MB (+2%), well inside the gate (+10% + 10MB).

**arm64 under QEMU (Pi 4 caps, GHCR `latest`, before):**
- Startup was 135s. Backend 201MB and frontend 217MB, both inflated by QEMU user-mode emulation.
- The blocker was OOM-killed at a 130MB cap. scapy also failed one socket call under QEMU (`[Errno 92]`).
- arm64 images are published for backend, frontend and blocker (confirmed in the GHCR manifests).
- Small boxes pull these images and never build on the box.

## Biggest costs, ranked

1. **Docker engine on the smallest boards.** dockerd + containerd + one shim per container is roughly 100MB
   or more on a small board (estimate; this dev host's engine is inflated by dozens of containers). On a
   512MB Zero 2 W that is the largest single cost after the backend. Not changed: a native (venv + systemd)
   install is a new install path and needs an owner decision.
2. **Backend RSS, about 115MB.** This is FastAPI, SQLAlchemy and pydantic plus our models.
   - Fixed: apprise and segno now load on first use (−6MB at start, and less import time).
   - Left: everything else is the core of the app.
3. **Blocker RSS, 83MB.** `scapy.all` loads every protocol.
   - Fixed: `blocker/scapy_lite.py` imports only the layers the blocker reads, all before any sniffer starts, so
     frames dissect as before.
   - Result: 83 to 58MB under load; import RSS 88 to 71MB.
4. **`/internal/state` N+1.** The blocker polls it, and every lock tick runs the same code. It counted chores
   per device and lazy-loaded owners and groups per device.
   - Fixed: per-kid counts are memoised per pass and relations are eager-loaded.
   - Queries for 8 devices: 34 to 7. p95 dropped 2-7x (Pi 4: 204 to 30ms).
5. **Parent Today CPU (25 queries, about 15ms per request on a fast core).** It is the p95 ceiling under
   concurrent load with one worker. It is within target on every tier, so it is left as is (no
   response-caching complexity).
6. **SQLite fsync per commit.** `synchronous=NORMAL` under WAL removes the fsync. This matters on SD cards, not
   on the harness SSD, so the harness does not measure it. The file stays consistent; a power cut can drop at
   most the newest commit.
7. **Startup**: 11-21s native, mostly image start and imports. It happens once per boot; no change.

## Targets (gated in CI on Pi 4; lower tiers set from these runs)

| Tier | API p95 | Block | Paint | RSS budget |
|---|---|---|---|---|
| Pi 4 2GB, old laptop 4GB | 300ms | 3s | 1000ms | 600MB |
| Pi 3 1GB | 600ms | 3s | 2000ms | 450MB |
| Pi Zero 2 W 512MB | 1000ms | 5s | 3000ms | 320MB (caps 165/85/70MB) |

CI (`perf` job) runs the Pi 4 gate, then a 10-minute soak, before images publish.

## Compiled binary: not shipped

A PyInstaller one-dir backend measured 123MB RSS against 117MB for a plain venv. It also started 0.1s slower
and is 118MB on disk. It does not beat Docker on its own. The win on low tiers comes from dropping the Docker
engine, which a plain venv + systemd install also gives without a per-arch binary build matrix.
