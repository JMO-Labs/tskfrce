# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). Commit types map to versions as described in [CONTRIBUTING.md](CONTRIBUTING.md).

## [Unreleased]

### Added

- `CONTRIBUTING.md`: branch flow (feature branch → PR into `dev`; `dev` → `main` released by the owner only), the exact local lint/test commands CI runs, and the Conventional Commits + semver rules. ([#80](https://github.com/JMO-Labs/tskfrce/pull/80))
- `backend/tests/test_contributing_doc.py`: fails when a CI command in `.github/workflows/ci-cd.yml` and `CONTRIBUTING.md` no longer match.

### Changed

- README and `docs/engineering.md` test commands now match CI (`ruff ... backend blocker examples` from the repo root, `npm test -- --ci`).

## [1.0.0]

First tagged release (`v1.0.0`).

[Unreleased]: https://github.com/JMO-Labs/tskfrce/compare/v1.0.0...dev
[1.0.0]: https://github.com/JMO-Labs/tskfrce/releases/tag/v1.0.0
