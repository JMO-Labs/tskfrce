# Onboarding phase 1: box hostname and HTTPS — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A wired box with a box ID and secret is reachable at
`https://<box-id>.taskfrce.jmolabs.dev`, with a real certificate it renews
itself. Boxes installed with `install.sh` keep working unchanged.

**Architecture:**
- A tiny **Cloudflare Worker** (`registry/`) authenticates boxes. It sets their
  A record to the box's LAN IP. It sets and clears the ACME DNS-01 TXT record,
  using lego's `httpreq` protocol. It also serves `/find`.
- On the box, a new **`edge`** container runs Caddy and lego, plus one POSIX
  shell loop. The loop reports the LAN IP, issues and renews the certificate,
  and reloads Caddy.
- `edge` only runs when `.env` turns on the `edge` compose profile.

**Tech stack:**
- Cloudflare Workers + KV, TypeScript, vitest, wrangler
- Caddy 2 (alpine), lego v4, POSIX sh, shellcheck
- docker compose profiles

**Spec:** `docs/superpowers/specs/2026-11-04-easy-onboarding-design.md` (sections 3 and 8, phase 1)

## Global Constraints

- Base domain: `taskfrce.jmolabs.dev`. Box hostname: `<box-id>.taskfrce.jmolabs.dev`.
  DNS zone: `jmolabs.dev` on Cloudflare.
- Box ID format: `^[a-z0-9]{6}$`. Box secret: 32 random bytes as hex. The
  Worker stores only `sha256(secret)` hex.
- The Worker must only touch names that are **exactly one label** under
  `taskfrce.jmolabs.dev`, and only the caller's own box ID. It must never touch
  other records in the `jmolabs.dev` zone.
- A records point only at **private IPv4**: `10/8`, `172.16/12`, `192.168/16`.
  Anything else → 400.
- The Worker stores only box ID → {lanIp, publicIp, seenAt}. No family data, ever
  (anti-goal).
- `/find` reveals a LAN IP only when the visitor's `CF-Connecting-IP` equals
  that box's stored `publicIp`. It never lists boxes.
- Each box gets its own Let's Encrypt cert and key. No shared wildcard.
- Box HTTPS: port **443** → frontend `127.0.0.1:3000`; port **2443** → ntfy
  `127.0.0.1:2586`. Same cert. Plain `:3000` keeps working.
- `.dev` is HSTS-preloaded. Never generate an `http://…taskfrce.jmolabs.dev` URL.
- Files < 500 lines. Semantic commits ending with the session trailer lines.
  CI (lint, test, lab, installer, security-scan) must pass.

## Review Focus

1. **LAN IP changes after a DHCP renew.** The box must re-report within 5
   minutes, or the hostname points at a dead IP. Task 4 tests "reports only when
   the IP changed" and the 300 s check interval.
2. **Let's Encrypt or the Worker unreachable at first boot.** `edge` must keep
   retrying with backoff, and must not crash-loop or block the rest of the
   stack. `:3000` still works. Task 4 tests the retry path.
3. **A box asking for another box's name.** `/api/acme/*` with
   `fqdn=_acme-challenge.<other-id>…` → 403. Task 2 test.
4. **Wrong or missing credentials** → 401 with no Cloudflare API call made.
   Task 1 test.
5. **A public or garbage IP sent to `/api/ip`** → 400, with no DNS change.
   Task 1 test.

---

### Task 1: Worker scaffold, box auth, `POST /api/ip`

**Files:**
- Create: `registry/package.json`, `registry/tsconfig.json`, `registry/wrangler.toml`
- Create: `registry/src/index.ts` (router, ≤ 80 lines)
- Create: `registry/src/auth.ts`
- Create: `registry/src/cf.ts` (Cloudflare DNS API calls)
- Test: `registry/test/ip.test.ts`, `registry/test/helpers.ts`

**Interfaces:**
- Produces:
  - `type Env = { BOXES: KVNamespace; CF_API_TOKEN: string; CF_ZONE_ID: string; BASE_DOMAIN: string }`
  - `handle(req: Request, env: Env, cfFetch: typeof fetch): Promise<Response>`.
    The default export is `{ fetch: (req, env) => handle(req, env, fetch) }`.
  - `authBox(req: Request, env: Env): Promise<string | null>`. It returns the box
    ID or null.
    - It parses `Authorization: Basic base64(id:secret)` and checks `id`
      against the box ID regex.
    - It compares `sha256hex(secret)` with KV `box:<id>` using a constant-time
      compare.
  - `upsertRecord(env, cfFetch, type: 'A' | 'TXT', name: string, content: string): Promise<void>`.
    It uses `ttl: 60` and `proxied: false`. It lists by `type` + `name`, then
    PUTs the first match or POSTs a new record.
  - `deleteRecord(env, cfFetch, type: 'TXT', name: string, content: string): Promise<void>`
  - `isPrivateV4(ip: string): boolean`
- Test helpers: `fakeKV()` (a Map-backed `get`/`put`), `fakeCf()` (records
  calls and returns `{success:true,result:[]}`), `basic(id, secret)`.

- [ ] **Step 1: Scaffold.**
  - `package.json` scripts: `"test": "vitest run"`, `"typecheck": "tsc --noEmit"`.
  - devDeps: `wrangler`, `vitest`, `typescript`, `@cloudflare/workers-types`.
  - `wrangler.toml`:
    - `name = "taskfrce-registry"`
    - `main = "src/index.ts"`
    - `routes = [{ pattern = "taskfrce.jmolabs.dev/*", zone_name = "jmolabs.dev" }]`
    - `[[kv_namespaces]] binding = "BOXES"` (id is filled in by the owner at deploy)
    - `[vars] BASE_DOMAIN = "taskfrce.jmolabs.dev"`, `CF_ZONE_ID = ""`
  - Run `npm install` in `registry/`.
- [ ] **Step 2: Write failing tests** in `registry/test/ip.test.ts`:
  ```ts
  test('valid box + private IP upserts A record and stores seen', async () => {
    // KV: box:abc123 = sha256hex('s3cret')
    const res = await handle(post('/api/ip', {ip:'192.168.1.40'}, basic('abc123','s3cret'), '203.0.113.9'), env, cf)
    expect(res.status).toBe(204)
    expect(cf.calls.some(c => c.method==='POST' && c.body.name==='abc123.taskfrce.jmolabs.dev' && c.body.content==='192.168.1.40' && c.body.type==='A')).toBe(true)
    expect(JSON.parse(await env.BOXES.get('seen:abc123'))).toMatchObject({lanIp:'192.168.1.40', publicIp:'203.0.113.9'})
  })
  test('wrong secret -> 401, no CF call', ...)        // basic('abc123','nope')
  test('missing auth -> 401, no CF call', ...)
  test('bad box id format -> 401', ...)                // basic('ABC!!!','s3cret')
  test.each(['8.8.8.8','172.32.0.1','300.1.1.1','x'])('ip %s -> 400, no CF call', ...)
  test('GET /api/ip -> 405', ...)
  ```
  `post()` sets the header `CF-Connecting-IP`.
- [ ] **Step 3: Run** `cd registry && npm test`. Expected: FAIL (`handle` not defined).
- [ ] **Step 4: Implement** `auth.ts`, `cf.ts`, and the `index.ts` router. The
  Cloudflare API base is `https://api.cloudflare.com/client/v4/zones/${CF_ZONE_ID}/dns_records`,
  with header `Authorization: Bearer ${CF_API_TOKEN}`. Unknown paths → 404.
- [ ] **Step 5: Run** `npm test && npm run typecheck`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(registry): box auth and LAN IP reporting worker`

### Task 2: `POST /api/acme/present` and `/api/acme/cleanup` (lego httpreq)

**Files:**
- Modify: `registry/src/index.ts` (add 2 routes)
- Test: `registry/test/acme.test.ts`

**Interfaces:**
- Consumes: `authBox`, `upsertRecord`, `deleteRecord` (Task 1).
- Request body (lego httpreq default mode): `{"fqdn": "_acme-challenge.<id>.taskfrce.jmolabs.dev.", "value": "<token>"}`.
  Strip the trailing dot from `fqdn` before checking it.

- [ ] **Step 1: Write failing tests:**
  ```ts
  test('present for own name creates TXT', ...)   // fqdn '_acme-challenge.abc123.taskfrce.jmolabs.dev.' -> 200; cf POST type TXT, content value
  test('present for another box -> 403, no CF call', ...)   // fqdn '_acme-challenge.zzz999.taskfrce.jmolabs.dev.'
  test('present for apex/other zone name -> 403', ...)      // '_acme-challenge.jmolabs.dev.', '_acme-challenge.abc123.evil.dev.'
  test('cleanup deletes the matching TXT only', ...)        // fakeCf list returns two TXT; only the one with matching content is DELETEd
  test('bad auth -> 401', ...)
  ```
- [ ] **Step 2: Run** `npm test`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** Allowed name = exactly
  `` `_acme-challenge.${id}.${BASE_DOMAIN}` ``. Present → `upsertRecord('TXT', …)`
  but **always POST**. ACME can need two TXT values at once, so do not PUT over
  an existing one. Add an `alwaysCreate` flag to `upsertRecord`, or call create
  directly. Cleanup → `deleteRecord`.
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(registry): ACME DNS-01 present/cleanup for boxes`

### Task 3: `GET /find?id=<box-id>`

**Files:**
- Create: `registry/src/find.ts` (HTML response, ≤ 80 lines)
- Modify: `registry/src/index.ts`
- Test: `registry/test/find.test.ts`

**Interfaces:**
- Produces: `findPage(id: string | null, visitorIp: string | null, env: Env): Promise<Response>`.
  It always returns 200 `text/html` and does no CF API calls.

- [ ] **Step 1: Write failing tests:**
  ```ts
  test('same public IP shows http://<lan>:3000 link', ...)  // seen:abc123 {lanIp:'192.168.1.40', publicIp:'203.0.113.9'}, visitor 203.0.113.9 -> body contains 'http://192.168.1.40:3000'
  test('different public IP reveals nothing', ...)           // visitor 198.51.100.7 -> body lacks '192.168.1.40', contains 'not found on this network'
  test('no id -> asks for the code on the sticker, no lookup', ...)
  test('unknown id -> not found text', ...)
  test('id is HTML-escaped / regex-checked', ...)            // id '<script>' -> treated as invalid, no '<script>' echoed
  ```
- [ ] **Step 2: Run** and confirm FAIL.
- [ ] **Step 3: Implement.** Copy for a match: "Found your box. Open it here:"
  plus the link, then one paragraph: "Your router blocks the box's web address
  (DNS rebinding protection). The link above still works, or allow
  `taskfrce.jmolabs.dev` in your router's settings." No match: "No box with
  that code was found on this network. Make sure your phone is on your home
  Wi-Fi."
- [ ] **Step 4: Run** `npm test && npm run typecheck`. Expected: pass.
- [ ] **Step 5: Commit** `feat(registry): find-my-box page`

### Task 4: `edge` container (Caddy + lego + loop)

**Files:**
- Create: `edge/Dockerfile`, `edge/Caddyfile`, `edge/edge.sh` (POSIX sh, ≤ 120 lines)
- Test: `edge/test-edge.sh` (stubs `curl`, `lego`, `caddy`, `ip` on `PATH`; ≤ 150 lines)
- Modify: `.github/workflows/ci-cd.yml`
  - Add `edge/edge.sh edge/test-edge.sh` to the shellcheck line (installer job).
  - Add a step `bash edge/test-edge.sh` to the same job.

**Interfaces:**
- env in: `BOX_ID`, `BOX_SECRET`.
- env with defaults:
  - `BASE_DOMAIN=taskfrce.jmolabs.dev`
  - `REGISTRY_URL=https://taskfrce.jmolabs.dev`
  - `ACME_EMAIL=boxes@jmolabs.dev`
  - `LEGO_SERVER=https://acme-v02.api.letsencrypt.org/directory`
  - `CHECK_SECS=300`
  - `RENEW_SECS=43200`
- Data dir `/data` (volume `edge_data`); lego `--path /data/lego`.
- Cert files: `/data/lego/certificates/${BOX_ID}.${BASE_DOMAIN}.crt` and `.key`.
- `edge.sh` functions (each testable when called with `EDGE_ONCE=1`):
  - `lan_ip`: prints `ip -4 route get 1.1.1.1` → `src` field.
  - `report_ip`:
    - POSTs `{"ip":"…"}` to `$REGISTRY_URL/api/ip` with basic auth
      `$BOX_ID:$BOX_SECRET`.
    - Skips if the IP equals `/data/last_ip`; writes the file on success.
  - `issue_or_renew`:
    - If there is no cert: `lego … run`; otherwise `lego … renew --days 30`.
    - Env `HTTPREQ_ENDPOINT=$REGISTRY_URL/api/acme`,
      `HTTPREQ_USERNAME=$BOX_ID`, `HTTPREQ_PASSWORD=$BOX_SECRET`.
    - Flags `--dns httpreq --accept-tos --email $ACME_EMAIL --server $LEGO_SERVER -d $BOX_ID.$BASE_DOMAIN`.
    - Returns 0 if the cert file changed.
  - main:
    1. Wait until a cert exists. Each pass: `report_ip`, then `issue_or_renew`,
       then a backoff sleep of 30 → 60 → … capped at 900 s.
    2. Start `caddy run --config /etc/caddy/Caddyfile &`.
    3. Loop every `CHECK_SECS`: `report_ip`. Every `RENEW_SECS`:
       `issue_or_renew`, and if it changed,
       `caddy reload --config /etc/caddy/Caddyfile --force`.
- `Caddyfile`:
  ```
  { auto_https off
    admin localhost:2019 }
  https://{$BOX_ID}.{$BASE_DOMAIN}:443 {
    tls /data/lego/certificates/{$BOX_ID}.{$BASE_DOMAIN}.crt /data/lego/certificates/{$BOX_ID}.{$BASE_DOMAIN}.key
    reverse_proxy 127.0.0.1:3000 }
  https://{$BOX_ID}.{$BASE_DOMAIN}:2443 {
    tls …same…
    reverse_proxy 127.0.0.1:2586 }
  ```
- Dockerfile: `FROM caddy:2-alpine`, `apk add --no-cache curl`. Copy the lego
  binary from `goacme/lego:v4` (`COPY --from=goacme/lego:v4 /lego /usr/local/bin/lego`).
  Copy `edge.sh` and `Caddyfile`. `ENTRYPOINT ["/edge.sh"]`.

- [ ] **Step 1: Write the failing test** `edge/test-edge.sh`. Each case writes
  stubs into a temp `bin/` that log their argv to a file, then runs
  `EDGE_ONCE=1 sh edge/edge.sh <function>` and asserts on the log:
  - `report_ip` posts to `/api/ip` with `-u abc123:s3cret` and `"ip":"192.168.1.40"`.
  - A second `report_ip` with the same IP makes **no** curl call.
  - A changed IP (stub `ip` now prints `.41`) → posts again.
  - `issue_or_renew` with no cert calls `lego … run` with `--dns httpreq` and
    `-d abc123.taskfrce.jmolabs.dev`, and exports `HTTPREQ_ENDPOINT=https://taskfrce.jmolabs.dev/api/acme`.
  - `issue_or_renew` with an existing cert calls `lego … renew --days 30`.
  - The backoff helper `next_backoff 30` prints 60, and `next_backoff 900`
    prints 900.
  - Missing `BOX_ID` → exits non-zero with the message `BOX_ID and BOX_SECRET are required`.
- [ ] **Step 2: Run** `bash edge/test-edge.sh`. Expected: FAIL (no edge.sh).
- [ ] **Step 3: Implement** `edge.sh`, `Caddyfile` and `Dockerfile` per the Interfaces above.
- [ ] **Step 4: Run** `bash edge/test-edge.sh && shellcheck edge/edge.sh edge/test-edge.sh && docker build -t edge-test edge`. Expected: all pass, and the image builds.
- [ ] **Step 5: Commit** `feat(edge): HTTPS front with self-renewing box certificate`

### Task 5: Compose, image publishing, `enable-hostname.sh`

**Files:**
- Modify: `docker-compose.prod.yml`. Add the service:
  ```yaml
  edge:
    image: ghcr.io/jmo-labs/tskfrce/edge:${TASK4CE_TAG:-latest}
    build: { context: ./edge }
    profiles: ["edge"]
    network_mode: host
    environment:
      BOX_ID: ${BOX_ID:?}
      BOX_SECRET: ${BOX_SECRET:?}
    volumes: [edge_data:/data]
    restart: unless-stopped
  ```
  Also add `edge_data:` to `volumes:`.
- Modify: `.github/workflows/ci-cd.yml`. Add `edge` to the `build-and-push`
  matrix `service` list.
- Create: `scripts/enable-hostname.sh` (POSIX sh, ≤ 80 lines).
  - Usage: `scripts/enable-hostname.sh <box-id> <box-secret> [env-file=.env]`.
  - It sets or replaces these keys in the env file (others kept, file mode 600):
    - `BOX_ID`, `BOX_SECRET`
    - `BOX_URL=https://<id>.taskfrce.jmolabs.dev`
    - (`NTFY_PUBLIC_URL` is left as install.sh wrote it)
    - `COMPOSE_PROFILES`: `edge` appended if missing, e.g. `blocker` → `blocker,edge`
  - It validates the box ID against `^[a-z0-9]{6}$` and the secret against
    64 hex chars.
- Modify: `blocker/tests/test_compose.py`. Add a test.
- Create: `scripts/test-enable-hostname.sh`. Add it, and `enable-hostname.sh`,
  to the shellcheck line and as a run step in the installer job.

- [ ] **Step 1: Write failing tests.**
  - `test_compose.py::test_prod_edge_is_opt_in_host_net`:
    - `svcs["edge"]["profiles"] == ["edge"]`
    - `network_mode == "host"`
    - `"edge_data:/data" in volumes`
    - no `cap_add`, not privileged
  - `scripts/test-enable-hostname.sh`:
    - On a temp `.env` holding `COMPOSE_PROFILES=blocker` and
      `BOX_URL=http://192.168.1.5:3000`, running the script gives exactly
      `BOX_URL=https://abc123.taskfrce.jmolabs.dev` and
      `COMPOSE_PROFILES=blocker,edge`. Other keys are unchanged and the file
      mode is 600.
    - Running it twice is idempotent (no duplicate keys, no `edge,edge`).
    - Bad ID `ABC` → non-zero exit, file untouched.
- [ ] **Step 2: Run** `cd blocker && python -m pytest tests/test_compose.py -q` and `bash scripts/test-enable-hostname.sh`. Expected: FAIL.
- [ ] **Step 3: Implement** the compose service, the matrix entry and the script.
- [ ] **Step 4: Run** both test commands, plus `shellcheck scripts/enable-hostname.sh scripts/test-enable-hostname.sh` and `docker compose -f docker-compose.prod.yml config -q` (with a dummy `SECRET_KEY` and `INTERNAL_TOKEN` exported). Expected: pass.
- [ ] **Step 5: Commit** `feat(compose): opt-in edge service and enable-hostname script`

### Task 6: Registry docs, box registration script, CI job

**Files:**
- Create: `registry/README.md` (≤ 80 lines). Owner deploy steps:
  1. `npx wrangler kv namespace create BOXES`, then paste the id into `wrangler.toml`.
  2. Set `CF_ZONE_ID` (the `jmolabs.dev` zone id) in `wrangler.toml` `[vars]`.
  3. `npx wrangler secret put CF_API_TOKEN`, with a token scoped to **Zone ›
     DNS › Edit on jmolabs.dev only**.
  4. `npx wrangler deploy`.
  5. Register each box with `scripts/new-box.sh`.
- Create: `registry/scripts/new-box.sh`. It generates a box ID (6 chars,
  `[a-z0-9]`) and a 32-byte hex secret. It runs
  `npx wrangler kv key put --binding BOXES "box:<id>" "<sha256hex(secret)>" --remote`,
  then prints `BOX_ID=…` and `BOX_SECRET=…` once, for the box's `.env` or
  sticker.
- Modify: `.github/workflows/ci-cd.yml`, `lint` job. Add the step
  `cd registry && npm ci && npm run typecheck && npm test`. The registry is
  small, so it doesn't need a new required check.
- Modify: `docs/guide/02-install.md`. Add 2 lines: prepared boxes open at
  `https://<box-id>.taskfrce.jmolabs.dev`, and `/find` is the fallback.

- [ ] **Step 1: Write** the README, `new-box.sh` (shellcheck clean) and the CI step.
- [ ] **Step 2: Run** `shellcheck registry/scripts/new-box.sh` and `cd registry && npm ci && npm test`. Expected: pass.
- [ ] **Step 3: Commit** `docs(registry): deploy and box registration steps; run registry tests in CI`

### Task 7: Owner-run end-to-end check on the beta box (manual)

These steps are not code. The executor gives the owner this checklist, and the
owner runs it. Deploying the Worker and minting secrets are outward actions, so
the owner does them.

- [ ] Deploy the Worker (README steps 1–4). Check that `curl -s https://taskfrce.jmolabs.dev/find`
  returns the "enter the code" page.
- [ ] `registry/scripts/new-box.sh` → note `BOX_ID` and `BOX_SECRET`.
- [ ] On the wired beta box: `scripts/enable-hostname.sh <id> <secret>`, then
  `docker compose -f docker-compose.prod.yml up -d`.
- [ ] Within about 2 minutes, `docker compose … logs edge` shows the IP
  reported and the cert obtained.
- [ ] From a phone on home Wi-Fi, `https://<id>.taskfrce.jmolabs.dev` loads
  the app with a valid lock icon. `http://<lan-ip>:3000` still works.
- [ ] Change the box's DHCP lease (or `ip addr` swap). The A record updates
  within 5 minutes.
- [ ] From a phone on mobile data, `/find?id=<id>` says "not found on this
  network".
- [ ] Verify the script's printed next-steps text, then revert: remove `BOX_ID`, `BOX_SECRET`,
  `EDGE_TOKEN` and `BOX_URL` from `.env`, set `BOX_URL` back to `http://<lan-ip>:3000`, and
  confirm the LAN URL still works.
- [ ] Pause a test device. Its browser is redirected to
  `https://<id>.taskfrce.jmolabs.dev/kid` and that page loads. `PORTAL_REDIRECT_URL`
  now uses the HTTPS hostname, and traffic to the box itself must not be
  dropped.

## Later plans (not this one)

- **Phase 2:** claim code, kid enrollment tokens, PWA manifest and service
  worker, and the parent "add to home screen" step.
- **Phase 3:**
  - factory image, sticker QR codes, setup-mode hotspot and captive portal
  - Avahi `<box-id>.local` advertisement and NTP on the image (spec section 3,
    fallback 2)
  - the setup success page's plain `http://<lan-ip>:3000` link

  Phase 3 starts with an AP-mode hardware spike.
