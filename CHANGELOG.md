# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). Commit types map to versions as described in [CONTRIBUTING.md](CONTRIBUTING.md).

## [Unreleased]

## [2.6.0]

Covers all work since `v1.0.0`. Versions 1.1.0 through 2.6.0 were bumped in `frontend/package.json` by `chore(release)` commits but never tagged. `v2.6.0` is tagged on `main` at `54b404f` so the tags match what shipped. The docs changes listed here reach `main` with the next `dev` → `main` merge, without a further version bump.

### Breaking

- Deleting a chore now deletes it fully (`feat(chores)!`).
- Legacy app frontend removed (`refactor(frontend)!`).
- Legacy app backend and its tables removed (`refactor!`).

### Added

- About 300 features across frontend, integrations, kid view, blocker, API, UI, chat, devices, setup, chores, today, notifications, lock and settings. Run `git log v1.0.0..v2.6.0` for the full list.
- `CONTRIBUTING.md`: branch flow (feature branch → PR into `dev`; `dev` → `main` released by the owner only), the exact local lint/test commands CI runs, and the Conventional Commits + semver rules. ([#80](https://github.com/JMO-Labs/tskfrce/pull/80))
- `backend/tests/test_contributing_doc.py`: fails when a CI command in `.github/workflows/ci-cd.yml` and `CONTRIBUTING.md` no longer match.

### Fixed

- About 500 bug fixes since `v1.0.0`.

### Changed

- README and `docs/engineering.md` test commands now match CI (`ruff ... backend blocker examples` from the repo root, `npm test -- --ci`).

## [1.0.0]

First tagged release (`v1.0.0`).

[Unreleased]: https://github.com/JMO-Labs/tskfrce/compare/v2.6.0...dev
[2.6.0]: https://github.com/JMO-Labs/tskfrce/compare/v1.0.0...v2.6.0
[1.0.0]: https://github.com/JMO-Labs/tskfrce/releases/tag/v1.0.0
