# Constrained-device performance — design

Date: 2026-11-10 · Branch: `feat/constrained-perf` (from `feat/declutter`, 2.8.0) · Last on the roadmap
Owner approved the playback 2026-11-10 ("good, ship it to the swarm").

## Intent
More families can run t@sk4ce on the box they already own, from modern hardware down to aging hardware.
**Every current feature stays.** Nothing is given up (owner).

## Device tiers
- **Must run well:** Raspberry Pi 4 2GB; old laptops (~4GB, dual-core x86).
- **Should run:** Raspberry Pi 3 B+ 1GB (*my guess, not contradicted*).
- **Stretch:** Raspberry Pi Zero 2 W 512MB (owner).
- **Testing (owner):** emulate each tier, not on real boards. Docker `--memory`/`--cpus` limits plus
  QEMU/binfmt arm64 (Pi Zero 2 W and Pi 3/4 run 64-bit OS). Ship a `scripts/tier.sh <tier>` (or compose
  profiles) that runs the full stack capped like the tier.

## What "runs well" means (owner: all of these)
On the emulated Pi 4 2GB tier (targets are *my guess*, enforced in CI):
- Parent and kid pages: first meaningful paint ≈1s on LAN after warm-up. API p95 < 300ms.
- Block/unblock takes effect ≤3s after a chore approval or a parent tap.
- Stays up for weeks: no memory growth across a 24h soak (compressed in CI to a sped-up soak), and steady
  RSS within budget.
- Memory budget for the whole stack on the Pi 4 2GB tier: ≤600MB RSS (*builder's call* to tune after
  profiling).
Lower tiers: same features, looser targets (*builder's call* after profiling; report them).

## Known facts (2026-10-24 measurements, see memory)
- Runtime at 0.5 CPU x86: backend ~80MB, frontend `next start` ~120MB, blocker (scapy) ~85MB.
- `next build` OOMs on boxes ≤2GB. **Small boxes always pull prebuilt images or binaries, never build
  on the box.** Prebuilt multi-arch GHCR images are already owner-approved. Confirm arm64 is published.

## Scope
1. **Tier harness + profiling (first).** Emulate each tier, profile CPU, memory, startup and the hot
   endpoints (Today, kid app, block state), and write a findings report
   `docs/perf/2026-11-profile.md`. Rank the biggest costs.
2. **Fix the biggest costs** without dropping features. Candidates (*builder decides from profiling*):
   SQLite WAL + pragmas, query/N+1 fixes and indexes, response caching for kid view, frontend bundle
   trimming and static rendering where possible, blocker idle CPU (scapy sniff loops), worker/thread
   counts tuned to cores, lazy-loading minigames assets.
3. **External database (owner, from 2026-11-07).** `DATABASE_URL` accepts Postgres (or similar) for
   families with their own DB server, a hosted version, or offloading a small box. Add a driver (psycopg 3).
   Remove SQLite-only code (~11 app files: backup copies the file; date functions in recap, bedtime, notify,
   and lock activity; 2 migrations). CI runs the test suite on both SQLite and Postgres.
4. **One-command move SQLite → Postgres** (owner): e.g. `task4ce db migrate-to postgres://…`. It must be
   safe: back up first, verify row counts, and leave SQLite untouched on failure.
5. **Compiled binary alongside Docker** (owner: welcome). *Builder's call* on approach (e.g. PyInstaller /
   Nuitka backend + static frontend export served by the backend). Ship it only if it measurably beats
   Docker on the low tiers; otherwise document why and skip it.
6. **CI perf gates:** the tier harness runs the targets above and fails on regression.

## Non-goals
- Dropping or "lite-mode" removing features.
- Real-hardware lab (emulation is enough for now).

## Anti-goals
- Any change that weakens the blocker's security (spoof resistance, fail-open policy, authz).
- Breaking existing SQLite installs. Upgrading must be invisible to families who don't opt into Postgres.

## Sequencing
This touches everything and is last on the roadmap. Phase 1 (harness, profiling report, Postgres support,
migrate command, CI gates) can start now on `feat/declutter`. Phase 2 (optimization fixes) happens after
rebasing onto the newest feature branch (Minigames → Presets → Goals → Penalties) so the profile includes
those features.

## Builder's calls (2026-11-10)
- **Tiers** (*builder's call*): `pi4-2g` (gate tier), `laptop-4g`, `pi3-1g`, `zero2w-512`. CPU caps approximate each
  board on x86 (Pi 4 ≈ 1.5 CPUs, old laptop ≈ 1.2, Pi 3 ≈ 0.8, Zero 2 W ≈ 0.6). QEMU arm64 runs the real arm64
  images with memory caps only: emulation is 5-20x slower, so its latency says nothing about a real board. Latency
  gates use native caps; arm64 proves boot, function and RSS.
- **Paint proxy** (*builder's call*): the box's share of first paint is HTML + JS/CSS delivered under the cap;
  rendering happens on the family's phone, so the harness times document + assets, not a headless browser.
- **Block latency** (*builder's call*): timed from the approval/parent tap API call to `/internal/state` changing.
  The push to the blocker is already covered by the lab e2e.
- **Postgres schema** (*builder's call*): the historic migration chain is SQLite-shaped (batch mode, string
  enums). An empty server DB gets the model schema plus a head stamp; later migrations run normally on both.
- **Driver** (*builder's call*): `psycopg[binary]` (wheels exist for amd64/arm64 and Python 3.15).
- **Backup** (*builder's call*): SQLite backups use SQLite's online backup API (WAL-safe; a plain file copy can miss
  the WAL). Server DBs get a gzip JSON dump of every table before an upgrade.
- **Migrate CLI** (*builder's call*): `scripts/db-migrate.sh <postgres-url>` on the box: stops the backend, runs
  `python -m app.cli migrate-to <url>` in a one-off container (SQLite opened read-only, one target transaction,
  per-table row counts verified before commit), then points `.env` at Postgres and restarts. Any failure restarts
  on the untouched SQLite.
- **Soak** (*builder's call*): CI runs a 10-minute mixed-load soak; fail if steady RSS grows >10% + 10MB.

## Left to the builder
Exact targets for lower tiers, which optimizations, the binary approach, the CLI shape, and tests.
