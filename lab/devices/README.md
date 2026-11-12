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
