# Contributing

## Branch flow

- Branch from `dev` (for example `feat/my-change` or `docs/contributing`).
- Open your pull request into `dev`.
- Only the owner merges and releases `dev` → `main`. Never push to `main`.

CI (`.github/workflows/ci-cd.yml`) runs on PRs into `main`, `dev` and `feat/**`, pushes to `main`/`dev`, `v*` tags, the merge queue and manual runs. Backend tests run on both SQLite and Postgres, and a `perf` job checks the Pi 4 2GB tier. The `lab` job runs only in the merge queue, on release tags and on manual runs, so run the lab checks below locally before opening a PR into `dev`.

Dependabot minor and patch updates merge on their own once CI is green; major updates wait for a human.

## Local checks

These are the commands CI runs, verbatim. Run them from the repo root unless noted.

CI versions: Python 3.11, Node 18 for frontend lint, Node 22 for frontend jest/build and the registry.

### Lint (Python 3.11, Node 18)

```bash
pip install -r backend/requirements.txt ruff
ruff format --check backend blocker examples && ruff check backend blocker examples
cd frontend && npm ci
npm run lint
npm run type-check
```

### Backend tests (Python 3.11)

```bash
cd backend && python -m pytest tests -q
```

### Frontend tests (Node 22)

```bash
cd frontend && npm ci && npm test -- --ci
```

### Registry (Node 22)

```bash
cd registry && npm ci && npm run typecheck && npm test
```

### Optional / heavy (Linux + Docker)

```bash
cd frontend && npm ci && npm run test:standalone
cd blocker && RUN_INTEGRATION=1 python -m pytest tests/lab -v
bash scripts/lab.sh up
bash scripts/lab.sh e2e
bash scripts/lab.sh down
bash scripts/test-install.sh
```

## Commits

Use [Conventional Commits](https://www.conventionalcommits.org/):
`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `perf:`, `ci:`.
Mark breaking changes with `!` (for example `feat!:`) or a `BREAKING CHANGE:` footer.

## Versioning

We follow [Semantic Versioning](https://semver.org/) (semver): `MAJOR.MINOR.PATCH`, tagged `vX.Y.Z` (current `v1.0.0`).

- `fix:` → patch
- `feat:` → minor
- breaking change → major
