# Device escape lab

Locks a real device on the beta box, tries to get around the lock, scores the result. Lab only, never CI.
Spec: `docs/superpowers/specs/2026-11-12-escape-lab-design.md`; plan: `docs/superpowers/plans/2026-11-12-escape-lab-p1.md`.

Needs: Android emulator up in the `droid` netns (`droidns`), ssh key `~/.ssh/id_gen_key` to the beta box.

```
bash lab/devices/android-kit.sh                      # once: push curl/q/helpers to the emulator
python3 lab/devices/escape.py --list                 # scenarios
python3 lab/devices/escape.py --selftest             # verdict logic, no device
python3 lab/devices/escape.py --only 'tx.*'          # subset (fnmatch on id)
python3 lab/devices/escape.py                        # full no-server matrix (~25 s settle per row)
```

Flags: `--settle N` (s after lock, default 25), `--base-wait N`, `--platform A`.
Output: `lab/devices/runs/<ts>/{results.json,report.md}` (gitignored; report diffs against the previous run).
Files: `boxctl.py` (runs inside the backend container: lock/unlock/status), `escape.py` (runner),
`scenarios.toml` (rows; `skip = "why"` marks rows the platform cannot do), `android-kit.sh`.
The runner always unlocks the device on exit.

## Tunnel + canary

`scenarios-tunnel.toml` rows (`canary.*`) hit our own locked-down canary (`canary.jmolabs.dev`, secret path,
WAF allows only the home IP; wstunnel at `tunnel.jmolabs.dev` is restricted to the canary port). The kit step
pushes `wstunnel`, `canary.sh` and the secret (from `~/.config/tskfrce-lab/canary.secret`, override with
`CANARY_SECRET_FILE`) to `/data/local/tmp/kit/canary.secret` (chmod 600). Never print or commit the secret.

`canary.sh hit <https|h3|http80|ws|alt:PORT> <token>` exits 0 only if the reply is exactly `canary:<token>`.
Each probe invents a fresh token, so a portal/gate/cached reply cannot match. `http80` is the exception:
Cloudflare 301s port 80 to https, so it passes only if the redirect URL equals `https://canary.jmolabs.dev/<secret>/t/<token>`
(proves the CF edge answered, not the origin). `ws` runs the wstunnel client against the CF IP (SNI/Host set;
the cert cannot be verified by IP, so trust is the exact token reply through the secret-gated tunnel).
Server-side confirmation: every attempt is appended to the device file `/data/local/tmp/canary.log`
(`transport token rc`); after a run, check from the host that `GET /<secret>/seen/<token>` is `{"seen": 1}` for
each rc=0 line (the runner's teardown runs on the device, so the host-side check is manual).
Cloudflare serves the alt HTTPS ports 8443, 2053, 2083, 2087, 2096 for the hostname (all verified).

`gate.budget` is content-aware: for ~100 s it fetches `https://www.google.com/complete/search?q=zoroastrian+calendar`
(`Accept-Encoding: identity`) and exits 0 only if the suggestion text `zoroastrian calendar converter` is in the
bytes, 3 (with `bytes=N`) if only bytes came back, 1 if nothing. The HTML search page is JS-gated for curl, so the
plain-text suggest API stands in for "search result".

## Identity

`scenarios-identity.toml` (`id.*` rows, except the old SKIP stubs in `scenarios.toml`): does a paused device stay paused
when it changes its network identity? The kid move is a host hook calling `droidns` (`mac random|hw|<mac> [host [vendor]]`,
`rejoin [host [vendor]]`, `static IP GW`). Run only these rows with
`python3 lab/devices/escape.py --scenarios lab/devices/scenarios-identity.toml --only 'id.*'` (plain `--only 'id.*'` also hits the
old stubs and `id.forget`).

- A MAC change makes a NEW box device row, so the runner's alert oracle (device 46 only) cannot see it. Each row's
  `host_teardown` writes `runs/identity-obs/<id>.{log,json}`: new device rows (hint_of_id/reason, override), events and
  parent notifications since the row started, the move log, and `restore=ok|FAIL`. It then restores `droidns mac hw` and
  deletes the lab-created private-MAC rows (only macs the row itself used).
- Probe: unlocked baseline is one shot; locked it loops and prints `leaks=ok/tries first_ok last_ok` (seconds after the move;
  `last_ok` is time-to-block). rc 0 (LEAK) if any shot got through. A failed move sets a marker so the row returns rc 2 (PROBE_ERROR), never a vacuous pass.
- `id.randmac.unpaused` is INVERTED: BLOCKED = stayed online (pass), LEAK = lost connectivity (fail).
- `restore_probe = "true"`: the device still wears the rotated MAC at the runner's restore check; the real check is `restore=` in the obs log.
- Clone/static rows check the target is OFFLINE in the box list (and silent to ping) before acting; otherwise they abort as PROBE_ERROR.
- boxctl extras: `list`, `since <iso>`, `mine <mac>`, `delete <mac>` (refuses unless MAC is locally-administered and first_seen is today).
- Caveats: hints only match KID-OWNED candidates (`apply_hint`), device 46 is unassigned, so relinking cannot happen in this lab until it is
  assigned to a kid; hint needs the old device quiet >= 2 min. Hook timeout is a fixed 120 s in escape.py (storm runs its rotations in the background).

## Apps (real kid apps)
`bash lab/devices/apps-kit.sh` installs Aurora Store, Fennec (Firefox), Orbot (F-Droid / Guardian Project repo, sha256 checked
against the repo index) and WireGuard (official APK, pinned sha256), and pushes `app-probe.sh`.
`apps-kit.sh aurora PKG...` drives Aurora Store (anonymous login, uiautomator) to install genuine Play builds; do it with the box
UNLOCKED and while holding `runs/.lock`. Rows: `scenarios-apps.toml` (`--only 'app.*'`).
Oracle: `app-probe.sh PKG SECS` = force-stop, launch, scroll, then per-UID rx bytes read from the netd eBPF map
(`dumpsys netstats --full --uid`, section `mAppUidStatsMap`, live; the 2 h `UID stats` history and `/proc/net/xt_qtaguid` are
useless on Android 15). rc 0 = rx > 300 KB, 3 = 20-300 KB, 1 = less. Screenshot: `/sdcard/escape-PKG.png`.
Notes: app UID is `appId=` in `dumpsys package`; rx includes loopback and any traffic the app made, so look at the screenshot.
Unlocked baselines (40 s): Roblox 46.8 MB, TikTok 6.7 MB; YouTube/Chrome baselines too low or blocked by first-run dialogs, so thresholds are unvalidated.
Emulator needs `-gpu guest` (SwiftShader crashes on Chromium-based apps); Brawl Stars / Among Us do not fit the 6 GB data disk.
