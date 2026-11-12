# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/). Commit types map to versions as described in [CONTRIBUTING.md](CONTRIBUTING.md).

## [Unreleased]

### Added

- Multi-network: with `LAN_IFACE` empty (the installer default), the box finds and blocks devices on every network it is attached to, and shows the block page on each.
- Wi-Fi settings: Settings → Wi-Fi and the `/wifi-setup` captive page let you join or change the box's Wi-Fi without a cable.
- Blocked phones stay on Wi-Fi: the phone still shows "Connected". Plain `http://` sites show the block page; `https://` sites just close, because the box has no certificate for them.
- Auto-relink: a phone that forgets the network and returns with a new private Wi-Fi address keeps its owner and rules. A parent can undo a wrong match.
- Kid notification: a kid sees why their device is blocked.
- Guide for kids' phones: lock mobile data and the private Wi-Fi address (Family Link, Screen Time).
- Today screen: a Goals card, a "This week" on-time trend and when-done grid, a Suggestions card (dismiss, mute or hide), a system warnings strip, and update and power suggestions.
- Kids can have an optional birth month and year; Today suggests moving a kid up an age group.

### Fixed

- Block page now shows on every network in multi-network mode.
- Google search results are blocked for a blocked phone, using a per-device byte budget so refreshing cannot piece a page together.
- Nightly updater works; Wi-Fi API and setup screen fixes.

### Docs

- The box cannot block mobile data (Samsung "Switch to mobile data" sends apps over cellular while Wi-Fi shows connected); the fix is on the phone. UniFi Proxy ARP and client isolation can stop the box intercepting Wi-Fi devices. See [the home box notes](docs/blocker.md), [routers](docs/routers.md) and [Troubleshooting](docs/guide/06-troubleshooting.md).

## [2.13.0] - 2026-11-11

Everything built on `feat/declutter` since 2.6.0 (2.7.0 to 2.12.0 were branch versions, never released).

### Added

- Less parent work: trust mode, bedtime auto-approve and a weekly recap.
- Parent declutter: calm screens and shared widgets.
- Goals: kids save toward parent-priced goals (own or family), with suggestions, chip-ins, a mascot party on fulfilment, an extra-screen-time goal that grants free minutes, and a "Get out of jail free" card that cancels a penalty.
- Penalties with earn-back: small/medium/big or custom, make-up chores that shrink a penalty, family penalties that take from or raise a family goal.
- Homework mode: study-site allow lists while internet is otherwise paused.
- Setup presets: one "How strict?" choice (per kid if wanted) sets chores, hours and extras by age; switch later without overwriting a parent's edits.
- Minigames: chores earn quick games; 20 quick-fire games plus Hungry Cat, Math Dash, Pack the Box and Shelf Memory, upgrades, power-ups and a weekly board. Games sleep at each kid's bedtime and in family quiet hours. New look: Fluent 3D art and "living sticker" mascots (PixiJS, loaded only when a game opens).
- Constrained devices: optional Postgres (`DATABASE_URL`), one-command SQLite→Postgres move, tier harness and CI perf gate; CI runs the backend on SQLite and Postgres.

### Fixed

- The backend could not reach the blocker in the production compose (wrong loopback), so blocks waited for the 30s reconcile and Test block failed. The blocker now also listens on the Docker bridge gateway.


- Parent UI matches the declutter mocks (tskfrce#9): the chore header drops the type chip. The type tile, with a small bubble badge, now opens "Notes kids can send" and "Edit <type> type". `Chip`'s `icon` is optional, and the rewards history Declined chip has no ×. Glyph swaps: notification place rows `chat_bubble`, Points rules `stars`, Trust level chip `check`, teen Chat tab `chat`, group Devices row `devices`.
- Lab browser e2e no longer breaks when Dependabot bumps `@playwright/test`: the Playwright image tag in `lab/docker-compose.lab.yml` now comes from `frontend/package.json` (`bash scripts/lab.sh pw-version`, exported as `PW_VERSION`). The `lab` CI job runs on Node 22 and runs the static lab tests. (tskfrce#11, fixes the #71 `lab` failure)

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
