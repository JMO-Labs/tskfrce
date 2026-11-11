# Unattended updates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-update t@sk4ce box nightly, pulling minor/patch updates for stable channel or eval builds, with health check, rollback, and alerts. Respect kid sessions and timers. Require parent opt-in via Settings before updating.

**Architecture:** CI tags images with `:X.Y.Z` (release) or `:eval-X.Y` (eval build), plus floating major (`:X`) or eval (`:eval`) tags. `.env` stores `UPDATE_CHANNEL=stable|eval|off` (set by install.sh, can be toggled in Settings). A nightly systemd timer runs the updater: pull the channel tag, verify signature, check health, rollback on failure. unattended-upgrades reboots at 03:30 with a pre-reboot hook to skip if a kid is active. Backend API exposes version, channel switch, last update result, and a button to pull major versions.

**Tech Stack:** Bash (updater script, pre-reboot hook), systemd (timer/service), cosign (image verification), unattended-upgrades, FastAPI (Settings → Updates API), pytest.

**Spec:** `docs/superpowers/specs/2026-11-11-box-lifecycle-design.md` PR 1. Every decision is owner-approved.

## Global Constraints

- Channels: `stable` pulls `:X` (e.g. `:2`), `eval` pulls `:eval`, `off` pulls nothing.
- CI: release `vX.Y.Z` pushes `:X.Y.Z` and moves `:X`; eval build pushes `:eval-X.Y` and moves `:eval`. All images cosign-signed (keyless, GitHub OIDC).
- Updater: nightly 03:00–04:00, skip if `UPDATE_CHANNEL=off` or kid session/timer active, verify cosign, health check, rollback on failure with ntfy alert + Today note, success adds Today note.
- Eval boxes never resolve to stable or prod tags (explicit test).
- No SSH to beta box `taskfrce-beta1` (192.168.1.98).
- UI mockup only (no Settings → Updates screen build). Static HTML at `docs/mockups/box-lifecycle/updates.html`, light/dark, matches parent UI style, owner approval required.
- Files under 500 lines. Semantic commits. Minor bump. Ruff format/lint clean. Test suites passing.
- Commit trailer:
  ```
  Co-Authored-By: Claude Haiku 4.5 <noreply@anthropic.com>
  ```

## Review Focus

1. **Eval channel safety:** an updater unit test asserts `eval` tag never resolves to stable or prod (no `vX.Y.Z`, no `:X`).
2. **Kid session check:** updater finds active kid session via backend API or `.env` file flag; does not run if active.
3. **Cosign verification:** fails hard if signature is invalid; refuses the image.
4. **Health check:** same `wait_healthy` logic as `install.sh`; rollback if timeout or failure.
5. **Digest tracking:** old digests saved before pull; used for rollback if needed.
6. **Pre-reboot hook:** skips reboot if kid session is active; tries again next night.
7. **Off channel:** Settings → Updates switch off → `UPDATE_CHANNEL=off` → updater skips → no updates pulled.

---

### Task 1: CI image tagging and cosign signing

**Files:** `.github/workflows/ci-cd.yml`, `.github/workflows/security.yml` (or extend ci-cd.yml).

- [ ] On release (`v*` tag): build image, push `:X.Y.Z` and move `:X` tag, cosign sign with keyless (GitHub OIDC).
- [ ] On eval build (manual or branch): push `:eval-X.Y` and move `:eval`, cosign sign.
- [ ] Test locally: check that a pushed image can be verified with `cosign verify --certificate-identity-regexp '.*github.*' --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' <image>`.
- [ ] Commit `ci: image tagging and cosign signing`.

### Task 2: Updater script and systemd service/timer

**Files:** `install/update-check.sh` (updater script, under 300 lines), `install/update-check.service`, `install/update-check.timer`, `install.sh` (add service/timer install), `backend/tests/test_updater.py` (unit test for eval channel).

- [ ] Write failing test: `test_eval_channel_never_stable` asserts that a pulled `:eval-*` tag never matches a stable pattern (no `vX.Y.Z`, no `:X`).
- [ ] Implement `update-check.sh`:
  - Load `.env` UPDATE_CHANNEL.
  - Skip if `off` or if kid session/timer is active (check backend health or a `.kid_session_active` file).
  - Pull the channel tag (`:X` for stable, `:eval` for eval).
  - Run `cosign verify` against this repo's workflow identity; exit hard if it fails.
  - Read old digests from `.digests.json` (or skip if not present).
  - Run `docker compose pull` then `docker compose up -d`.
  - Run `wait_healthy` health check (max 120 s).
  - If unhealthy: rollback by reverting `.env` image digest, recompose, send ntfy alert and Today note "Update to X.Y failed", exit.
  - If healthy: add Today note "Updated to X.Y".
- [ ] Create systemd service (runs update-check.sh, restarts on-failure) and timer (03:00–04:00, RandomizedDelaySec=3600 s).
- [ ] Extend `install.sh` to install service/timer and enable them.
- [ ] Run the test and check `shellcheck` on update-check.sh.
- [ ] Commit `feat(box): updater script and systemd timer`.

### Task 3: Unattended-upgrades pre-reboot hook

**Files:** `install/pre-reboot-hook.sh`, `/etc/apt/apt.conf.d/50unattended-upgrades` (or create in install.sh).

- [ ] Create pre-reboot hook: if kid session is active, exit 1 (skip reboot); else exit 0.
- [ ] Set unattended-upgrades `Automatic-Reboot "true"` at 03:30 UTC, with `Pre-Reboot-Hook "/usr/local/bin/pre-reboot-hook.sh"`.
- [ ] Run shellcheck on the hook.
- [ ] Commit `feat(box): unattended reboot with kid-session skip`.

### Task 4: Backend API for Settings → Updates

**Files:** `backend/app/api/settings.py` (or new `backend/app/api/updates.py`), `backend/tests/test_updates.py`.

- [ ] Write failing tests:
  - GET `/api/updates` returns `{version: "X.Y.Z", channel: "stable|eval|off", last_result: "success|failed|pending", major_available: "3" | null}`.
  - PATCH `/api/updates` with `channel: "off"` writes `UPDATE_CHANNEL=off` to `.env`.
  - PATCH with `pull_major: "3"` sets tag to `:3` and runs updater immediately.
  - GET shows last update timestamp and error message if last result was failed.
- [ ] Implement using existing `.env` patterns; read version from where past releases bumped it.
- [ ] Run tests and keep the suite passing.
- [ ] Commit `feat(api): settings updates endpoint`.

### Task 5: HTML mockup for Settings → Updates

**Files:** `docs/mockups/box-lifecycle/updates.html`.

- [ ] Create a static HTML mockup matching existing parent UI style (look at `frontend/src/v2` and `docs/mockups/` for color tokens, fonts, button styles).
- [ ] Show: current version (e.g. "2.13.0"), auto-update switch (on/off), last update result ("Updated to 2.13.0" or "Update to 2.13 failed, still on 2.12"), and major-available button ("Version 3 available — Update").
- [ ] Support light and dark mode via `prefers-color-scheme`.
- [ ] Keep it under 200 lines.
- [ ] **Owner approval required before merging.**
- [ ] Commit `docs: mockup for settings updates screen`.

### Task 6: Version bump and integration

**Files:** Version file (check `git log --grep "chore(release)"` to find it), `backend/tests/`, `frontend/tests/`, local CI job equivalents.

- [ ] Bump minor version (e.g. 2.13.0 → 2.14.0) unless it conflicts with in-flight work; if so, note it in the PR.
- [ ] Run backend test suite (pytest, foreground, ~7 min) and frontend tests (jest).
- [ ] Run `shellcheck` on all new shell scripts in `install/`.
- [ ] Verify ruff format/lint on touched Python files.
- [ ] Commit `chore(release): 2.14.0`.

---

## Pending (not in PR 1)

- [ ] Owner approval of mockup before Settings → Updates screen is built (PR 2 or later).
- [ ] Real-box integration test: beta box `taskfrce-beta1` must not be touched; test on a dev box if available.
