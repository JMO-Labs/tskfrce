# Constrained-device performance — implementation plan

Spec: `docs/superpowers/specs/2026-11-10-constrained-devices-design.md` (binding; see "Builder's calls").
Branch: `feat/constrained-perf`. Strict TDD: write the failing test, watch it fail, make it pass. Files < 500 lines.
Commits: semantic, ending `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Commit only your own paths.

Run backend tests: `cd backend && .venv/bin/python -m pytest tests -q -n 8`.
On Postgres: add `TEST_DATABASE_URL=postgresql+psycopg://postgres:pg@localhost:55432/task4ce`.

## Phase 1

### Task 1 — Postgres support (DONE, d17a5ba2)
psycopg 3, dialect-aware presence upsert, `postgresql_where` on partial indexes, fresh server DB = create_all +
stamp head (alembic/env.py), conftest Postgres mode, prod compose passes `DATABASE_URL`.

### Task 2 — Portable pre-upgrade backup (`backend/app/utils/backup_db.py`) (DONE)
1. Test (`tests/test_backup_db.py`): SQLite file DB in WAL mode with an uncommitted-to-main-file row (open a
   second connection, insert, keep the WAL) → `main()` writes `DATA_DIR/backups/pre-upgrade-*.db` and the backup
   contains the row.
2. Implement with `sqlite3.connect(src).backup(sqlite3.connect(dest))`.
3. Test (Postgres only, skip without `TEST_DATABASE_URL`): `main()` with a server URL writes
   `pre-upgrade-*.json.gz` = `{table: [rows...]}` for every table in `Base.metadata.sorted_tables`.
4. Implement: `dump_json(engine, path)` in the same file using SQLAlchemy core selects, `default=str` for JSON.
5. Keep "no DB file yet → do nothing" behaviour.

### Task 3 — `migrate-to` (`backend/app/services/db_move.py` + `backend/app/cli.py`) (DONE)
`python -m app.cli migrate-to <url>`; exit 0 on success, 1 on any failure, message says SQLite is untouched.
1. `normalize(url)`: `postgres://` and `postgresql://` → `postgresql+psycopg://`. Test.
2. `move(src_url, dst_url)`:
   - refuse if src is not SQLite, or dst is SQLite; refuse if src is not at alembic head (tell user to start
     the app once); refuse if dst has any table.
   - back up src first (Task 2's SQLite backup to `backups/pre-migrate-*.db`).
   - open src read-only (`sqlite:///file:<path>?mode=ro&uri=true`).
   - in ONE dst transaction: `Base.metadata.create_all(conn)`; stamp `alembic_version` with the head revision;
     copy each table in `sorted_tables` order in batches of 500 rows; on Postgres `setval` every serial `id`
     sequence to `max(id)`; compare per-table `count(*)` src vs dst; any mismatch → raise → rollback.
   - return a per-table count dict.
3. Tests: copy logic against a SQLite→Postgres pair (Postgres-only), refusal cases (run on SQLite), mismatch
   rollback (monkeypatch the counter) leaves dst empty, src file bytes identical before/after (sha256).
4. CLI wiring + usage text.

### Task 4 — Box wrapper `scripts/db-migrate.sh <postgres-url>` (DONE)
Run from the install dir (where `.env` + `docker-compose.prod.yml` live). `set -eu`.
1. `docker compose stop backend` → `docker compose run --rm --no-deps backend python -m app.cli migrate-to "$1"`.
2. Success: copy `.env` to `.env.bak-<stamp>`, set/replace `DATABASE_URL=` line, `docker compose up -d`.
3. Failure: `docker compose up -d` (unchanged SQLite), print the error, exit 1.
4. Test `scripts/test-db-migrate.sh` with a fake `docker` on PATH (both paths). Add both files to the CI
   shellcheck line and run the test in the `installer` job. Document in `docs/` (find the self-hosting doc).

### Task 5 — CI matrix (`.github/workflows/ci-cd.yml`) (DONE)
`test` job: `strategy.matrix.db: [sqlite, postgres]`. Postgres leg: `docker run -d --name ci-pg -p 5432:5432
-e POSTGRES_PASSWORD=pg postgres:16-alpine`, wait for `pg_isready`, set `TEST_DATABASE_URL`, always remove the
container. Install `pytest-xdist` and run with `-n auto`.

### Task 6 — Tier harness (`perf/` + `scripts/tier.sh`) (DONE)
- `perf/docker-compose.tier.yml`: backend, frontend (prod runtime target), blocker on an `internal: true`
  bridge (never host network), images from `TASK4CE_IMAGE_PREFIX`/`TASK4CE_TAG` or local builds; `mem_limit`
  and `cpus` from env; `platform: ${TIER_PLATFORM}`. Project name `task4ce-tier` (never touch `task4ce-lab`).
- `perf/tiers/{pi4-2g,laptop-4g,pi3-1g,zero2w-512}.env`: per-service MEM/CPUS + targets.
- `perf/seed.py` (piped into `docker compose exec -T backend python -`): family, parent, 3 kids, 10 devices,
  20 chores, 30 days of runs/events; prints JSON `{parent_token, kid_token, internal_token}`.
- `perf/bench.py` (stdlib only): warm-up, then p50/p95 for Today, kid app and `/internal/state`; paint proxy
  for `/parent` and `/kid`; block latency (approve → `/internal/state` changes, 20 samples); idle CPU and RSS
  from `docker stats`; startup seconds. Writes `perf/results/<tier>-<arch>.json`; `--gate` compares to tier
  targets and exits 1 on miss.
- `--soak MINUTES`: mixed load, RSS sample per minute, fail on growth > 10% + 10MB.
- `scripts/tier.sh <tier> [up|bench|soak|gate|down] [--arm64]`: `--arm64` registers binfmt if missing, uses
  GHCR arm64 images and drops CPU caps.
- Unit tests for bench math (percentile, growth check, target compare) in `perf/test_bench.py`.

### Task 7 — CI perf gate (DONE)
Job `perf` on `ubuntu-latest`, needs `[lint, test]`: build the three images, `scripts/tier.sh pi4-2g gate`,
then `soak 10`; upload `perf/results`.

### Task 8 — Profile report `docs/perf/2026-11-profile.md` (DONE)
Run every tier native + pi4/zero2w arm64; rank the biggest costs; set lower-tier targets.

## Phase 2 (after rebase onto the newest open feature PR)
### Task 9 — Fix the ranked costs (from Task 8), each with a before/after number in the report. (DONE)
### Task 10 — Binary evaluation: build a PyInstaller backend, compare RSS/startup to Docker on pi3/zero2w; (DONE)
ship only if it wins, else document why not.
### Task 11 — Verification sweep, 5 polish passes, local CI on both DBs, version bump, PR.
