# Escape lab: phase 1 + 2a plan

Spec: `docs/superpowers/specs/2026-11-12-escape-lab-design.md`. Branch `lab/device-harness`. Lab only, never CI.
Rules: stdlib Python 3.12 only, every file under 300 lines, `ruff format` + `ruff check` clean (repo `ruff.toml`).

## Known facts (verified 2026-11-12)

- adb runs as `sudo -n /usr/local/sbin/droidns run /home/user/Android/Sdk/platform-tools/adb <args>`. Device `emulator-5554`; `adb root` works.
- Beta box ssh: `ssh -o BatchMode=yes -i ~/.ssh/id_gen_key ubuntu@192.168.1.98`. Backend container `task4ce-backend-1`, API `http://127.0.0.1:8000/api/v1` (inside container).
- Parent token: inside the backend container, `jwt.encode({"sub": str(parent.id), "type": "access", "exp": now+10min}, app.core.auth.SECRET_KEY, "HS256")`. The parent is the first active `User` with `role == UserRole.PARENT`. DB session: `app.core.database.SessionLocal()`.
- Endpoints: `GET /devices` (list; each item has `id`, `mac`, `resisting`, `alerts`, `override`); `POST /devices/{id}/override` body `{"action":"lock"}` or `{"action":"unlock"}`; `GET /devices/{id}/activity` (has `counts` and `events`).
- The emulator MAC is `c4:8b:66:54:72:0d` (box device id 46). Android itself sits behind emulator NAT at 10.0.2.15.

## Task 1: `lab/devices/boxctl.py` (runs INSIDE the backend container)

The runner pipes it in: `ssh … 'docker exec -i task4ce-backend-1 python - <cmd> <mac>' < lab/devices/boxctl.py`.
Commands (print one JSON object to stdout, exit 1 on error):
- `lock MAC` → find the device by MAC (case-insensitive), POST the override lock, print `{"ok":true,"id":N}`
- `unlock MAC` → same, with unlock
- `status MAC` → print `{"device": <devices item>, "activity": <activity json>}`

Use urllib for the HTTP calls to `127.0.0.1:8000` with the minted token. No other deps.
Check: run `status c4:8b:66:54:72:0d` against the box and confirm it prints id 46.

## Task 2: `lab/devices/escape.py` (runner, on this host)

- `adb(*args, timeout)` → `subprocess.run` with the droidns prefix; returns `(rc, stdout)`.
- `box(cmd, mac)` → ssh + boxctl as above; returns the parsed JSON.
- Platform `A` runs scenario shell through `adb shell <cmd>` (already root).
- Load `lab/devices/scenarios.toml` with `tomllib`. Scenario fields: `id`, `title`, `category`, `platforms` (list), `setup`, `probe`, `teardown` (shell strings, optional except `probe`), `expect_alert` (bool, default false), `repeat` (int, default 1), `timeout` (s, default 20).
- Flow for each scenario × platform:
  1. `box unlock`, wait 10 s, `setup`, run `probe`. If probe rc ≠ 0, the verdict is `INVALID` (the probe is broken); run teardown and continue.
  2. `box lock`, wait `settle` (default 25 s; a CLI flag), run `probe` `repeat` times. Any rc == 0 means `LEAK`. Rc 3 means `PARTIAL` (the probe prints bytes on its last stdout line).
  3. `box status`: compare `resisting`/`alerts` and the activity events since step 2 against `expect_alert`. A mismatch on a non-LEAK row gives `ALERT_MISS` (expected an alert, none came) or `ALERT_FALSE` (an alert with `expect_alert=false` and the probe blocked).
  4. `box unlock`, then poll the probe every 5 s for up to 60 s. If it never succeeds, add the flag `NO_RESTORE`.
  5. Run `teardown` (always, in `finally`).
- Probe exit codes: 0 = reached the real internet (verified), 1 = blocked, 3 = partial, anything else = error. The probe itself must verify authenticity (see Task 3). Box portal or gate answers must give 1.
- CLI: `--only GLOB` (fnmatch on id), `--platform A`, `--settle N`, `--list`.
- Output: `lab/devices/runs/<YYYYmmdd-HHMMSS>/results.json` (a list of `{id, platform, verdict, flags, detail, duration}`) and `report.md`: a counts table by verdict, then a table of rows that are not BLOCKED, then a diff against the newest previous run (rows whose verdict changed).
- Add `lab/devices/runs/` to `.gitignore`.
- Self-check: `python lab/devices/escape.py --list` lists every scenario. Add a `demo()` behind `--selftest` that unit-checks the verdict logic with fake probe results (no device).

## Task 3: Android probe kit + `lab/devices/scenarios.toml` (no-server rows)

- `lab/devices/android-kit.sh` (run once, idempotent): `adb root`, then push static x86_64 binaries to `/data/local/tmp/kit/`. Sources:
  - `curl`: static build with HTTP/3 + DoH from the github release `stunnel/static-curl`, x86_64 musl.
  - `kdig` or `q`: a static DoT/DoQ/DoH DNS client; the github `natesales/q` release linux amd64 works.

  Download into a fresh dir under the session scratchpad and verify each binary runs with `--version` on the device. Add `ca-bundle.crt` from curl.se to the kit.
- The verification helper `/data/local/tmp/kit/real.sh URL EXPECT` is pushed by the kit. It runs curl with `--cacert`, `-sS -m 10`, and exits 0 only if TLS validated **and** the body contains EXPECT. A box portal or gate fails both checks.
- Fill `scenarios.toml` with every spec row marked `A` that needs no server. Use these targets:
  - `https://www.cloudflare.com/cdn-cgi/trace` (expect `fl=`)
  - `https://example.com` (expect `Example Domain`)
  - `https://1.1.1.1/cdn-cgi/trace` (IP literal)
  - `https://cloudflare-quic.com` with `--http3-only`
  - `https://crypto.cloudflare.com/cdn-cgi/trace` (expect `sni=encrypted` for ECH)
- DNS rows use `q` with `@tls://1.1.1.1`, `@https://dns.google/dns-query`, `@quic://dns.adguard-dns.com`, and the system resolver via `ping -c1 -W3 host` (bionic, so it respects Private DNS).
- For Private DNS: `setup` = `settings put global private_dns_mode hostname; settings put global private_dns_specifier dns.google`; `teardown` resets the mode to `opportunistic`.
- For Chrome rows: `am start -a android.intent.action.VIEW -d URL com.android.chrome`, wait 8 s, `uiautomator dump /sdcard/u.xml`, then grep the page title text. Chrome first-run must be dismissed once in the kit (`am set-debug-app`/`--no-first-run` flags via `/data/local/tmp/chrome-command-line`).
- Gate rows (`gate.budget`, `gate.front`): curl `https://www.google.com/search?q=test` with 20 parallel connections. Exit 3 + byte count if any bytes of real results arrive. `gate.front`: `--connect-to ::www.google.com:` with `-H 'Host: www.youtube.com'`, then the same with `translate.goog`.
- `tx.longlived`: setup starts `curl` streaming `https://speed.cloudflare.com/__down?bytes=500000000` in the background, writing its byte count to a file. The probe checks whether the file still grows 30 s after the lock.
- `id.*` rows needing root on Android: `ip link set wlan0 address …` is not meaningful behind emulator NAT. Mark these `platforms=["L"]` for phase 3, except `id.forget` (`cmd wifi` reconnect).

## Task 4: canary (`lab/canary/`) on Beast

- `server.py`: stdlib `http.server` ThreadingHTTPServer on :8080.
  - Secret from env `CANARY_SECRET`. Only paths starting with `/<secret>/` are served; anything else gets 404 with an empty body.
  - `GET|POST /<secret>/t/<token>` logs a JSON line `{ts, token, method, path, ip: CF-Connecting-IP, ua}` to stdout and replies `canary:<token>`. It reads and discards up to 64 KB of the body.
  - `GET /<secret>/seen/<token>` → `{"seen": n}`.
  - Tokens are kept in memory with a 7-day expiry.
- `Dockerfile`: `python:3.12-alpine`, non-root user.
- `docker-compose.yml`:
  - service `canary`: `read_only: true`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, no ports;
  - service `wstunnel`: `ghcr.io/erebe/wstunnel` server with `--restrict-to canary:8080` and `--restrict-http-upgrade-path-prefix <secret>`;
  - both on the external docker network that `Unraid-Cloudflared-Tunnel` uses (look it up with `docker inspect`).
- Deploy to `root@192.168.1.96:/mnt/user/appdata/escape-canary/`. Generate the secret there with `openssl rand -hex 32` into a `.env` file with mode 600. Copy it to this host at `/home/user/.config/tskfrce-lab/canary.secret` (mode 600).
- Then STOP and report the service URLs (`http://canary:8080`, `http://wstunnel:8080`) for the owner to add as tunnel public hostnames, plus the WAF rule.

## Order

Tasks 1, 2 and 4 are independent. Task 3 needs Task 2's CLI. Claude verifies every task end to end on the real emulator and box.
