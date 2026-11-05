# Onboarding phase 2, part 2: PWA, setup and kid screens, docs

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

Part 1 (`2026-11-05-onboarding-p2-claim-enroll.md`) holds the header, **Global Constraints**,
**Review Focus** and the plan rulings. They bind every task here. Tasks 7A–14 need Tasks 1–7
merged on the branch.

**Screenshot rule (all UI tasks).** Add cases to `frontend/e2e/onboarding-shots.spec.ts`
(created in Task 8) and run it on the lab box:
`cd frontend && npx playwright test --project=phone-light --project=phone-dark
--project=desktop-light --project=desktop-dark onboarding-shots`. The PNGs land in
`e2e-artifacts/screens/<project>/onb-*.png`. Put them next to the named mockup (serve the
mockups with `python3 -m http.server` in `docs/superpowers/specs/2026-10-24-v3-redesign-mockups`)
and fix any drift in spacing, type, color or icons. No new mockups: the v3 mockups are the
style reference. Attach light and dark shots to the PR; the owner reviews them. The lab is plain HTTP. Shots that need a secure page use
`page.addInitScript(() => Object.defineProperty(window, 'isSecureContext', { value: true }))`.

---

### Task 7A: Publish generic kid alerts to the upstream ntfy

**Files:**
- Modify: `backend/app/services/push.py` (stays < 200 lines). Config is done (Task 3).
- Modify: `backend/app/api/kid_enroll.py` (`DELETE /kids/{id}/phones/{pid}` rotates
  `kid.alert_topic`)
- Test: `backend/tests/test_push_upstream.py`

**Interfaces:**
- Consumes: `User.alert_topic` (Task 5), `alert_for` (Task 7), `inbox.KID_KINDS`,
  `settings.NTFY_UPSTREAM_URL` / `NTFY_UPSTREAM_TOKEN` (Task 3).
- Produces:
  - `push.GENERIC: dict[str, str]`, one line for each of the 11 `KID_KINDS`: `chore_new` "You
    have a new chore", `due_soon` "A chore is due soon", `missed_deadline` "A chore is
    overdue", `chore_approved` "A chore was approved", `chore_sent_back` "A chore needs
    another look", `points_taken` "Your points changed", `lock_warning` "Screen time ends
    soon", `chat_message` "You have a new message", `redemption_decided` "A reward request
    was answered", `badge_earned` "You earned a badge", `level_up` "You reached a new level".
    No fallback: `queue` only handles `KID_KINDS`, so it reads `GENERIC[kind]`; the
    completeness test guards it.
  - `push.queue(...)` keeps the LAN item exactly as today (only when `enabled()` and
    `push_topic`). It also appends, when `NTFY_UPSTREAM_URL` and `u.alert_topic` are set,
    `{"topic": u.alert_topic, "title": "t@sk4ce", "message": GENERIC[kind], "priority": …,
    "_up": True, "_row": row}`. Nothing else: no `click`, no tags, no name.
  - `push.send(item)` pops `_up` before posting (`_after_commit` strips only `_row`, so
    `_up` must never reach ntfy). `_up` items go to `f"{NTFY_UPSTREAM_URL.rstrip('/')}/"`
    with `Authorization: Bearer {NTFY_UPSTREAM_TOKEN}` when set; the rest to `NTFY_URL` as
    today. Each item
    has its own try/except, so an upstream error only logs `"Upstream push failed"` (never
    the topic).
  - The LAN-only gate in `queue` (`if not enabled()`) no longer stops upstream items.

- [ ] **Step 1: Write failing tests** (monkeypatch `push._spawn` to run inline and
  `httpx.post` to record calls):
  ```python
  def test_upstream_payload_is_generic(db, kid, cfg):  # kid.full_name "Sam", chore "Clean Sam's room"
      push.queue(db, kid.id, "chore_new", "New chore: Clean Sam's room", "Due 5 pm"); db.commit()
      up = [c for c in calls if c.url == "https://ntfy.sh/"][0]
      assert up.json == {"topic": kid.alert_topic, "title": "t@sk4ce",   # exact: no "_up"
                         "message": "You have a new chore", "priority": 3}
      assert "Sam" not in str(up) and "Clean" not in str(up)
  def test_every_kid_kind_has_generic_text(): assert inbox.KID_KINDS <= push.GENERIC.keys()
  def test_lan_send_unchanged(...): ...          # LAN item still has the real title/body and click
  def test_upstream_down_lan_still_sent(...): ...  # upstream post raises -> LAN post still made
  def test_token_header_only_when_set(...): ...
  def test_self_hosted_url_used_as_is(...): ...  # monkeypatch "https://ntfy.example.net/" (skips the validator) -> posts to "https://ntfy.example.net/", never "…net//"
  def test_upstream_off_when_empty(...): ...
  def test_no_alert_topic_no_upstream(...): ...
  def test_remove_phone_rotates_topic(client, kid, db, parent_headers): ...  # DELETE -> topic changed; /kid/session on the other phone returns the new one
  ```
- [ ] **Step 2: Run** `python -m pytest tests/test_push_upstream.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `python -m pytest tests -q` and ruff. Expected: pass.
- [ ] **Step 5: Commit** `feat(push): generic kid alerts through an upstream ntfy server`

### Task 8: PWA shell: manifests, icons, service worker, offline page

**Files:**
- Create: `frontend/public/manifest.webmanifest`, `frontend/public/kid.webmanifest`
- Create: `frontend/public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`,
  `apple-touch-icon.png` (180×180), plus `frontend/scripts/make-icons.sh` (ImageMagick,
  ≤ 30 lines, so they can be made again)
- Create: `frontend/public/sw.js` (≤ 40 lines), `frontend/public/offline.html` (≤ 80 lines)
- Create: `frontend/src/v2/pwa.ts` (≤ 60 lines)
- Modify: `frontend/pages/_app.tsx` (manifest `<link>` in its `<Head>` with
  `key="manifest"`; call `registerSw()` and `listenInstallPrompt()` in the existing effect)
- Modify: `frontend/pages/_document.tsx:27-30` (apple-touch-icon → `/icons/apple-touch-icon.png`;
  add `apple-mobile-web-app-capable`, `mobile-web-app-capable`,
  `apple-mobile-web-app-title` = `t@sk4ce`, status bar style `default`)
- Modify: `frontend/pages/kid.tsx` (`<link rel="manifest" href="/kid.webmanifest" key="manifest" />`)
- Modify: `frontend/next.config.js` `headers()`: `/sw.js` → `Cache-Control: no-cache`;
  `/:file*.webmanifest` → `Content-Type: application/manifest+json`
- Create: `frontend/e2e/onboarding-shots.spec.ts`; Modify: `frontend/playwright.config.ts`
  (screen projects' `testMatch: ['screens.spec.ts', 'onboarding-shots.spec.ts']`)
- Test: `frontend/tests/v2/pwa.test.ts`, `frontend/tests/v2/manifest.test.ts`

**Interfaces:**
- Manifests: `id`, `name` `"t@sk4ce"`, `short_name` `"t@sk4ce"`, `start_url` and `id` `/`
  (parent) or `/kid` (kid), `scope` `/`, `display` `standalone`, `background_color` and
  `theme_color` = the light value already in `_document.tsx` (`#E6EFF1`), and icons 192/512
  `any` plus 512 `maskable`. Dark status bars come from the existing `theme-color` media
  tags. No new colors.
- Icons: made from `public/logo_short_med_light.png` on `#E6EFF1`. The mark fills 80% of
  the `any` icons and 60% of the maskable one (safe zone).
- `sw.js`: `CACHE = 't4ce-shell-v1'`. Install caches `['/offline.html', '/icons/icon-192.png']`.
  Activate deletes other caches and calls `clients.claim()`. Fetch: only when
  `request.mode === 'navigate'`, `respondWith(fetch(request).catch(() =>
  caches.match('/offline.html')))`. Everything else (including `/api/*` and `/ws/*`) is
  untouched. Never cache family data.
- `offline.html`: inline CSS with the same light/dark token values as `polish.css`, under
  `prefers-color-scheme`. Copy: title "Can't reach your t@sk4ce box", body "Make sure this
  phone is on your home Wi-Fi, then try again.", button "Try again" (`location.reload()`).
- `pwa.ts`:
  - `registerSw(env?: { secure: boolean; sw?: ServiceWorkerContainer; prod: boolean }) -> Promise<void>`:
    registers `/sw.js` only when secure, supported and production; swallows errors.
  - `listenInstallPrompt(): void`: once, on `beforeinstallprompt`, calls `preventDefault()`
    and keeps the event.
  - `installPrompt(): InstallPromptEvent | null`
  - `onInstallPrompt(cb: () => void): () => void`
  - `type InstallPromptEvent = Event & { prompt(): Promise<void> }`

- [ ] **Step 1: Write failing tests.**
  - `pwa.test.ts`: registers when `{secure:true, prod:true}`; no call when insecure, dev, or no
    `serviceWorker`; a rejected `register` does not throw; `listenInstallPrompt` keeps a
    dispatched `beforeinstallprompt` event and notifies subscribers once.
  - `manifest.test.ts` (reads files with `fs`): both manifests parse; `start_url` `/` and
    `/kid`; distinct `id`; every icon file exists, with PNG width/height (IHDR bytes 16–23)
    equal to its declared `sizes`; one icon has `purpose: 'maskable'`.
  - `sw` test in `pwa.test.ts`: evaluate `public/sw.js` with a fake `self` that records
    listeners. A `navigate` request → `respondWith` called; a `cors` request to
    `/api/proxy/kid/today` → not called.
- [ ] **Step 2: Run** `cd frontend && npx jest tests/v2/pwa.test.ts tests/v2/manifest.test.ts`.
  Expected: FAIL.
- [ ] **Step 3: Implement.** Run `sh scripts/make-icons.sh` once and commit the PNGs.
- [ ] **Step 4: Run** the jest files, `npm run lint && npm run type-check`. Then add a shots
  case `offline page` (`page.goto('/offline.html')`) and `home screen icons` (render
  `/icons/icon-512.png` and the maskable icon inside a 50% circle mask via
  `page.setContent`). Run the screenshot command. No new mockups; the owner reviews the shots.
  Expected: pass; light and dark PNGs saved.
- [ ] **Step 5: Commit** `feat(pwa): installable parent and kid pages with offline fallback`

### Task 9: Claim gate in the setup wizard

**Files:**
- Create: `frontend/src/v2/setup/claim.ts` (≤ 50 lines)
- Create: `frontend/src/v2/setup/ClaimGate.tsx` (≤ 120 lines)
- Modify: `frontend/pages/_app.tsx` (`useState(captureClaim)` lazy initializer, so it runs in
  the first client render before any page effect, redirect or request)
- Modify: `frontend/pages/setup.tsx` (gate before step 1; `claim_code` in `POST /setup`)
- Modify: `frontend/src/v2/types.ts` (one line, `SetupStatus.claim?: boolean`; stays < 500)
- Test: `frontend/tests/v2/claim.test.ts`, `frontend/tests/v2/claimGate.test.tsx`; Create
  `frontend/tests/v2/ssr.test.ts` (`@jest-environment node`; Task 10 adds to it)

**Interfaces:**
- Consumes: `GET /setup` `claim`, `POST /setup/claim`, `SetupIn.claim_code` (Task 2).
- Produces:
  - `CLAIM_KEY = 'task4ce-claim'` (sessionStorage)
  - `captureClaim(): null`: returns null at once when `typeof window === 'undefined'` (the
    `useState` initializer also runs on the server). Else, when `location.hash` has
    `claim=`, save it, then `history.replaceState(null, '', pathname + search)`.
  - `readClaim(): string | null`, `clearClaim(): void`
  - `settleClaim(status?: SetupStatus): void`: `clearClaim()` when `status?.needed === false`
    (QR 2 scanned on a box already set up must not leave the code in storage).
  - `groupClaim(raw: string): string`: upper-case, keep the alphabet only, 10 max, dash after 5.
  - `<ClaimGate onClaimed={(code: string) => void} />`
- Gate layout: the login page look (mockup `06-login.html`): `p-auth-container`,
  `<AuthBrand />`, `p-auth-form-side`, `p-auth-form`, `p-auth-error`. Copy:
  - title "Enter your box code"
  - sub "It's on the sticker on your box, under **Open my box**."
  - field label "Box code", placeholder `K7M2Q-XA9PB`, `autoCapitalize="characters"`,
    `autoComplete="off"`, `spellCheck={false}`
  - button "Continue"
  - 403: the server's detail; 429: the server's detail; 409: "This box is already set up."
    with a link to `/login`
- Stored code present → the gate auto-submits once and shows only "Checking your box…" (the
  QR 2 path stays invisible). A 403 then clears the stored code and shows the form.
- `setup.tsx`: `const [claim, setClaim] = useState<string | null>(null)`. When
  `status.data?.claim && !claim`, render `<ClaimGate onClaimed={setClaim} />` instead of the
  wizard. Send `claim_code: claim` in the existing `create` mutation. A 403 from it →
  `setClaim(null)` plus `clearClaim()`. `clearClaim()` runs on success too. An effect calls
  `settleClaim(status.data)` whenever the status loads.

- [ ] **Step 1: Write failing tests.**
  - `claim.test.ts`: `/setup#claim=k7m2qxa9pb` → stored, and the URL becomes `/setup`
    (assert `history.replaceState` args); no hash → nothing stored; `groupClaim('k7m2qxa9pb')
    === 'K7M2Q-XA9PB'`; `groupClaim('k7m2q xa9pb!!zz')` → `'K7M2Q-XA9PB'`;
    `settleClaim({needed:false})` clears a stored code, `{needed:true}` keeps it.
  - `ssr.test.ts`: `captureClaim()` with no `window` returns null and does not throw.
  - `claimGate.test.tsx` (mock `@/v2/api`): stored code → POST once with `{code}` →
    `onClaimed('K7M2QXA9PB')` with no form shown; 403 → form plus server detail, storage
    cleared; typing `k7m2qxa9pb` shows `K7M2Q-XA9PB`; 429 shows the wait message; the
    button is disabled while pending.
- [ ] **Step 2: Run** `npx jest tests/v2/claim.test.ts tests/v2/claimGate.test.tsx
  tests/v2/ssr.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the jest files, `npm test` (whole suite), lint and type-check. Shots:
  mock `**/api/proxy/setup` → `{needed:true, claim:true}` and
  `**/api/proxy/setup/claim` → 403 with the wrong-code detail. Shoot `onb-claim-empty`,
  `onb-claim-wrong` and `onb-claim-checking` (claim delayed 10 s). Compare with mockup 06
  (style reference; no new mockups; owner reviews). Expected: pass.
- [ ] **Step 5: Commit** `feat(setup): box code gate before the parent account`

### Task 10: Kid enrollment on `/kid`, plus the install hint

**Files:**
- Create: `frontend/src/v2/kid/kidDevice.ts` (≤ 90 lines)
- Create: `frontend/src/v2/types/enroll.ts` (`KidAlert`, `KidIdentity`; Tasks 11–12 add
  `EnrollCode`, `KidPhone`; `types.ts` is at 483 lines)
- Create: `frontend/src/v2/components/installPlatform.ts` (≤ 40 lines)
- Create: `frontend/src/v2/components/InstallHint.tsx` (≤ 120 lines)
- Create: `frontend/src/v2/kid/KidWelcome.tsx` (≤ 80 lines)
- Modify: `frontend/src/v2/api.ts` (a 401 on an `init.kid` request → one `refreshKid()` then
  retry, like the parent refresh at lines 72-75; parent requests never call it)
- Modify: `frontend/src/v2/hooks/useKid.ts` (export `writeToken`; `useKidSession`: an `enroll`
  mutation; `logout` also calls `clearDevice()`)
- Modify: `frontend/src/v2/kid/KidPage.tsx` (`KidScreen`: take `#enroll=` in a lazy
  `useState`; welcome screen; removed-phone `Gate`; `canSwitch` false when `deviceToken()`)
- Test: `frontend/tests/v2/kidDevice.test.ts`, `frontend/tests/v2/installHint.test.tsx`,
  `frontend/tests/v2/kidEnroll.test.tsx`, `frontend/tests/v2/ssr.test.ts` (from Task 9)

**Interfaces:**
- Consumes: `POST /kid/enroll`, `POST /kid/session` (Task 7); `installPrompt`,
  `onInstallPrompt` (Task 8); `KID_TOKEN_KEY`; `writeToken(t, kidId)` (module-private
  today; export it; it also writes `KID_ID_KEY`, so always pass the kid id).
- Produces:
  - `DEVICE_KEY = 'task4ce-kid-device'`; `deviceToken(): string | null`;
    `saveDevice(t: string): void`; `clearDevice(): void`
  - In `types/enroll.ts`: `type KidAlert = { server: string; topic: string }`,
    `type KidIdentity = { id: number; full_name: string; avatar: string | null }`.
  - `KID_KEY = 'task4ce-kid-device-kid'`; `saveKid(k: KidIdentity): void`;
    `deviceKid(): KidIdentity | null` (name and avatar after a reload; `whoami` has no kid).
    `clearDevice()` also clears it.
  - `ALERT_KEY = 'task4ce-kid-alert'`;
    `saveAlert(a: KidAlert | null): boolean` (true when the topic changed from a stored one);
    `alertLink(a: KidAlert): string` →
    `ntfy://{host}/{topic}?display=t%40sk4ce` (no kid name; host from `server`; add
    `&secure=false` only for `http` servers).
  - `takeEnrollToken(): string | null`: null when `typeof window === 'undefined'`; else reads
    `#enroll=` and strips the hash right away (`replaceState` to `/kid`).
  - `refreshKid(): Promise<boolean>`: plain `fetch('/api/proxy/kid/session')` (not `api()`, so
    there is no loop). **Single flight**: while one call is pending, every caller gets the
    same promise (today, celebrations and markDone 401 together → one `/kid/session`). 200 →
    `writeToken(r.access_token, r.kid.id)`, `saveKid(r.kid)`, `saveAlert(r.alert)`, true. A
    401 → `clearDevice()`, keep the server detail for `removedMsg()`, false. A changed topic
    (a phone was removed) sets `alertsMoved`.
  - `removedMsg(): string | null`: the `PHONE_REMOVED` detail after a failed refresh.
  - `type InstallPlatform = 'installed' | 'insecure' | 'ios' | 'prompt' | 'android' | 'other'`
  - `installPlatform(e: { ua: string; touch: boolean; standalone: boolean; secure: boolean;
    hasPrompt: boolean }): InstallPlatform`. Order: standalone → `installed`; !secure →
    `insecure`; iPhone/iPad/iPod, or Macintosh with touch → `ios`; hasPrompt → `prompt`;
    `/Android/` → `android`; else `other`.
  - `<InstallHint who="kid" | "parent" />`. Kid look: `k-gate` classes, `r-btn`
    (mockup `08-kid-phone.html`). Parent look: `stepCards.module.css` card plus a Mantine
    `Button` (mockup `07-setup.html`). Material Symbols `ios_share`, `more_vert`,
    `add_to_home_screen`. Copy:
    - ios: "Put t@sk4ce on your home screen" — 1 "Tap Share <ios_share> at the bottom of the
      screen." 2 "Tap **Add to Home Screen**." 3 "Tap **Add**."
    - prompt: the same title and a button "Add to home screen" → `prompt()`.
    - android: "Tap the menu <more_vert>, then **Add to Home screen** or **Install app**."
    - other: "In your browser's menu, choose **Install** or **Add to Home screen**."
    - insecure: kid → renders nothing. Parent → `InfoBlock` "You can add t@sk4ce to your home
      screen once your box has its secure address. Open it from the **Open my box** code on
      the sticker."
    - installed: nothing.
  - `<KidWelcome name avatar alert onStart />`: "You're in, {name}!", avatar, `<InstallHint
    who="kid" />`, then (when `alert` is set) "Get alerts on this phone": 1 "Get the free
    **ntfy** app" (App Store and Google Play links), 2 a button "Add my alerts" →
    `alertLink(alert)`. Button "Start".
  - `KidApp` shows a one-line `k-gate-msg` banner "Your alerts moved. Tap to reconnect." →
    `alertLink` when `alertsMoved`; tapping clears the flag.
- `KidScreen` flow: `const [token] = useState(takeEnrollToken)` (lazy, so the hash is read
  and stripped in the first client render, before `whoami` fires). Token → `enroll.mutate`.
  Success → `writeToken(access_token, kid.id)`, `saveDevice`, `saveKid`, `saveAlert`; show
  `KidWelcome` until Start. Failure → `Gate` with the server detail and no picker. When
  `removedMsg()` is set → `Gate` with "This phone was removed. Ask a parent for a new code."
  and no picker (not the whoami "isn't set up" text). Name and avatar come from
  `deviceKid()` when set. The alert topic only travels in POST response bodies and the
  `ntfy://` app link (the one allowed path exception); never in a box URL. With no token,
  the existing whoami/PIN flow is unchanged. Ruling: an enrolled phone skips the PIN.

- [ ] **Step 1: Write failing tests.**
  - `kidDevice.test.ts`: `takeEnrollToken` with `/kid#enroll=abc` → `'abc'`, URL now `/kid`;
    `refreshKid` 200 → token and `deviceKid()` stored, true; 401 → device cleared,
    `removedMsg()` set, false; two concurrent `refreshKid()` → one `fetch`; a new topic in
    the response → `saveAlert` returns true; `alertLink({server:'https://ntfy.sh',
    topic:'t'}) === 'ntfy://ntfy.sh/t?display=t%40sk4ce'`.
  - `ssr.test.ts`: `takeEnrollToken()` with no `window` returns null.
  - `installHint.test.tsx`: table test of `installPlatform` for an iPhone Safari UA, an iPad
    (Macintosh + touch), Android Chrome with a prompt, Android Firefox without one, desktop
    Firefox, standalone, and **`insecure: kid hint hidden`** (renders nothing) while
    **`insecure: parent sees why`** renders the InfoBlock text. The prompt button calls
    `prompt()`.
  - `kidEnroll.test.tsx` (mock `api` and `fetch`): `/kid#enroll=tok` → POST
    `/kid/enroll {token:'tok'}` before any whoami request, then the welcome with the kid's
    name, then Start → today; a remount shows the name from `deviceKid()`. A 410 → "expired
    or was already used" and no picker. **`refresh failure clears the device`**: two kid
    requests 401 at once → one `/kid/session` call → 401 → device cleared → `Gate` shows
    "This phone was removed. Ask a parent for a new code." A parent-request 401 never calls
    `/kid/session`.
- [ ] **Step 2: Run** the four jest files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, lint and type-check. Shots: `parentApi()` POSTs
  `/kids/{id}/enroll` for a seeded kid, then `goto('/kid#enroll=<token>')` with the secure
  init script. Phone projects use an iPhone UA (`test.use({ userAgent })`) for `onb-kid-
  welcome-ios`; a second case dispatches a fake `beforeinstallprompt` for `onb-kid-welcome-
  prompt`; and `onb-kid-code-used` reuses a spent token. Compare with mockup 08 (style
  reference; no new mockups; owner reviews). Expected: pass.
- [ ] **Step 5: Commit** `feat(kid): sign in by scanning a parent's code; add-to-home-screen help`

### Task 11: Wizard step 4 "Kids' phones" and the finish-screen install prompt

**Files:**
- Create: `frontend/src/v2/setup/StepPhones.tsx` (≤ 100 lines)
- Create: `frontend/src/v2/components/EnrollQr.tsx` (≤ 80 lines)
- Create: `frontend/src/v2/hooks/useEnroll.ts` (≤ 40 lines)
- Modify: `frontend/src/v2/setup/WizardFrame.tsx:8-16` (8 `STEPS`; insert `{ num: 4, title:
  "Kids' phones", sub: 'Scan to sign in', opt: true }`; renumber the rest; the optional
  eyebrow test becomes `STEPS[step-1]?.opt`)
- Modify: `frontend/src/v2/setup/setupStep.ts` (`LAST = 8`); Create
  `frontend/tests/v2/setupStep.test.ts`
- Modify: `frontend/src/v2/parent/states.tsx:215` (`SetupResuming`: "of 7" → `of ${LAST}`)
- Modify: `frontend/pages/setup.tsx`. Steps shift: chores job `step === 4` → 5, hours job
  `step === 6` → 7; `stepTitles` 4–8; children; `note` on step 5. Step 4 body: `<StepPhones
  kids={kids} />`. The Next button on step 4 reads "Next". Skip stays.
- Modify: `frontend/src/v2/setup/StepFinish.tsx` (`<InstallHint who="parent" />` above the
  two buttons)
- Modify: `frontend/tests/v2/WizardFrame.test.tsx`, `frontend/tests/v2/RequireParent.test.tsx`
  (`of 7` → `of 8`), and any e2e that walks the wizard (`grep -rn "of 7" frontend/e2e`)
- Test: `frontend/tests/v2/stepPhones.test.tsx`

**Interfaces:**
- Consumes: `POST /kids/{id}/enroll` (Task 6), `<InstallHint>` (Task 10).
- Produces:
  - `useEnrollCode()`: a TanStack mutation `(kidId: number) => api<EnrollCode>(…, {method:'POST'})`
  - `type EnrollCode = { url: string; qr_svg: string; expires_at: string }` in
    `src/v2/types/enroll.ts` (from Task 10), not `types.ts` (483 lines)
  - `<EnrollQr kid={Kid} code={EnrollCode | undefined} busy onNew={() => void} />`: the QR
    `<img className="pk-qr">` exactly as `KidPushPane.KidPhone` renders it, `pk-hint` text,
    and a `p-btn` "New code". It reuses manage.css classes; no new CSS colors.
- Step 4 copy:
  - title "Kids' phones"
  - sub "Each kid scans their code with their phone's camera. No phone? Skip it. You can do
    this later from the kid's page."
  - per kid: "Scan with {name}'s phone camera." and "Works once, for 24 hours."
  - no kids: "Add a kid first, or skip this step."
  - Codes are made one kid at a time on a "Show code" tap, not all at once (each issue voids
    the previous one).
- Step 3 title text is unchanged. Mantine `Stepper` is not used; the existing strip scrolls.

- [ ] **Step 1: Write failing tests.**
  - `stepPhones.test.tsx`: two kids → two "Show code" buttons; tap → one POST for that kid
    only, QR img shown with the 24 h hint; "New code" → POST again; no kids → the "Add a kid
    first" text.
  - `WizardFrame.test.tsx`: "Step 4 of 8 · optional"; "Step 8 of 8 · optional".
  - `setupStep.test.ts` (new): `savedStep(9) === null`, `savedStep(8) === 8`.
  - `SetupResuming step={4}` renders "step 4 of 8".
- [ ] **Step 2: Run** the jest files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, lint and type-check. Shots: `loginUi`, mock
  `**/api/proxy/setup` → `{needed:false, claim:false}` and `**/setup/step` → `{step:4}`,
  then `goto('/setup')` → `onb-step-phones` (one code shown). From step 4, click **Skip**
  five times (steps 4–8 all have Skip) to reach the finish screen, and shoot
  `onb-finish-install` with the secure init script and an iPhone UA on phone projects.
  Compare with mockup 07 (style reference; no new mockups; owner reviews). Expected: pass.
- [ ] **Step 5: Commit** `feat(setup): kids' phones step and add-to-home-screen at finish`

### Task 12: Kid page "Phones and tablets" panel (list, add, remove)

**Files:**
- Create: `frontend/src/v2/manage/KidPhonesPanel.tsx` (≤ 120 lines)
- Create: `frontend/src/v2/hooks/useKidPhones.ts` (≤ 40 lines)
- Modify: `frontend/src/v2/manage/KidDetail.tsx` (render `<KidPhonesPanel kid={kid} />` right
  after the Devices panel, ~line 121; stays < 200 lines)
- Modify: `frontend/src/v2/types/enroll.ts` (`KidPhone = { id: number; label: string;
  created_at: string; last_seen_at: string }`, times `"…Z"` from `utc_z`; not `types.ts`)
- Test: `frontend/tests/v2/kidPhones.test.tsx`

**Interfaces:**
- Consumes: `GET/DELETE /kids/{id}/phones` (Task 6), `EnrollQr` and `useEnrollCode` (Task 11),
  `ConfirmDelete`, `toastOk`, `toastFail`, `Icon`, and `daysAgo(iso)` from `clockText.ts`
  (returns a number: 0 → "today", 1 → "1 day ago", n → "n days ago"). No new helper.
- Produces: `useKidPhones(kidId)`, query key `['kid-phones', kidId]`; `useRemoveKidPhone()`,
  which invalidates that key.
- Panel: `section.pk-panel` `aria-label="Phones and tablets"`, `h3` with `smartphone` icon.
  - Rows `pk-line`: label, then "Added {date} · last used {daysAgo text}", and a `p-btn`
    "Remove".
  - Empty: "No phones yet. Not every kid has one, and that's fine."
  - "Add a phone" → `EnrollQr`.
  - Remove confirm: title "Remove {name}'s {label}?", body "It signs out right away. Scan a
    new code to add it back. {name}'s other phones will be asked to reconnect alerts.", confirm "Remove". Toast "Phone removed".

- [ ] **Step 1: Write failing tests**: rows render with label and times (`last_seen_at` today
  → "last used today", 3 days back → "3 days ago"); Remove → confirm →
  DELETE `/kids/3/phones/7` → list refetched → toast; "Add a phone" → POST enroll → QR shown;
  empty text when `[]`.
- [ ] **Step 2: Run** `npx jest tests/v2/kidPhones.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npm test`, lint and type-check. Add `'/kids?section=kids'` detail shots:
  redeem one code via the API first (so a row exists), then shoot `onb-kid-phones` and
  `onb-kid-phones-remove` (confirm open). Compare with mockup `02-parent-screens.html`
  (kid detail; style reference, no new mockups; owner reviews). Expected: pass.
- [ ] **Step 4b: Visual gate.** Kept on purpose (owner caught drift before). A reviewer who did not build Tasks 9–12 compares every
  `onb-*` shot, light and dark, with its mockup and lists drift. Fix it before Task 13.
- [ ] **Step 5: Commit** `feat(kids): see and remove a kid's signed-in phones`

### Task 13: Parent guide, Pages site, version

**Files:**
- Modify: `docs/guide/02-install.md` — prepared boxes: scan **Open my box**; the box code
  is on the sticker; typing it by hand is fine (dashes and case don't matter).
- Modify: `docs/guide/03-first-setup.md` — "seven steps" → eight; a new section
  "Step 4. Kids' phones"; renumber the later sections; "Add t@sk4ce to your home screen"
  after Finish (iPhone and Android steps).
- Modify: `docs/guide/05-for-kids.md` — "Scan your code, tap Add to Home Screen", then
  "Get the ntfy app and tap Add my alerts".
- Modify: `docs/guide/04-everyday-use.md` (notifications part) — new short section "Kid
  alerts away from home", in plain words:
  - At home, alerts come straight from your box, as before.
  - Away from home they go through a free public alert service, ntfy.sh. It only sees short,
    generic lines like "You have a new chore" and when they were sent. It never sees names,
    chores, messages or rewards.
  - Want no outside service? Your box's installer can point it at your own ntfy server
    (`NTFY_UPSTREAM_URL`, optional `NTFY_UPSTREAM_TOKEN`) or turn it off (empty value). Your
    server must let anyone read (phones subscribe without a login); the token is for writing.
  - At home a kid may get each alert twice (once from the box, once from the alert service).
    That's expected.
- Modify: `docs/guide/06-troubleshooting.md` — "The box code doesn't work"; "Too many
  tries"; "The kid's code expired or was already used"; "I can't add it to my home screen"
  (needs the secure address; IP-mode boxes can't); "A lost phone" (Remove it on the kid's
  page).
- Create: `docs/guide/img/setup-claim.jpg`, `setup-phones.jpg`, `kid-welcome.jpg` from the
  light phone shots (`convert … -quality 82`).
- Modify: `site/index.html` (one line in the feature list: "Kids add it to their home screen
  like an app"), if the feature list exists there.
- Version `2.0.0` → `2.1.0` (feat, semver minor) in all three: `frontend/package.json`,
  `backend/app/__init__.py` (`__version__`), `backend/tests/test_health.py:25`.

- [ ] **Step 1: Write** the guide changes. Plain words; no "token", "PWA", "DNS" or "IP"
  except in the troubleshooting line about IP-mode boxes.
- [ ] **Step 2: Run** `python3 scripts/build_site.py && (python3 -m http.server 8811 --directory
  site &) && node site/check.mjs http://127.0.0.1:8811`. Expected: no failures. Every new
  image and anchor resolves.
- [ ] **Step 3: Run** `cd frontend && npm test && npm run lint && npm run type-check`;
  `cd backend && python -m pytest tests -q` (`test_health` expects `2.1.0`); ruff. Expected:
  pass.
- [ ] **Step 4: Commit** `docs(guide): box code, kids' phones and home-screen install`

### Task 14: Owner-run check on the beta box (manual)

The executor gives the owner this list; the owner runs it (minting codes and wiping a box
are owner actions).

- [ ] `registry/scripts/new-box.sh` on a test ID → note `CLAIM_CODE` and `STICKER_QR2`.
  Make a QR of `STICKER_QR2` (any QR generator on the laptop, offline).
- [ ] On the wired beta box with a **fresh data volume**:
  `CLAIM_CODE=<code> scripts/enable-hostname.sh <id> <secret>`, then
  `docker compose -f docker-compose.prod.yml up -d`.
- [ ] Phone on home Wi-Fi scans the QR → the wizard opens at "Make your parent account"
  with no code prompt.
- [ ] A second phone opens `https://<id>.taskfrce.jmolabs.dev/setup`, sees the code
  prompt, and gets "doesn't match" for a wrong code; the 6th wrong try says "Wait 1 minute".
- [ ] After step 1–2, `/setup/claim` with the right code returns 409 (claim dead).
- [ ] Step 4: scan a kid code with a kid phone (iPhone and Android) → "You're in" →
  install → the home-screen icon opens `/kid` full screen, in light and dark.
- [ ] The same kid code on another phone → "expired or was already used".
- [ ] Kid page → Phones and tablets → Remove → within 10 s the kid phone shows "Ask a
  parent for a new code".
- [ ] Airplane-mode the kid phone, open the icon → the offline page shows.
- [ ] `docker compose … logs frontend backend edge | grep -E "enroll=|claim="` → no hits.
- [ ] On the kid phone, "Add my alerts" subscribes ntfy to `ntfy.sh`. Turn Wi-Fi off and
  make a chore → the alert says "You have a new chore", with no name or title. On home Wi-Fi
  the LAN ntfy alert still has the full text.
- [ ] `curl -sk https://<id>.taskfrce.jmolabs.dev:2443` fails (ntfy is not on the hostname).
- [ ] Set `NTFY_UPSTREAM_URL` to the owner's tunnelled ntfy (plus token) → alerts arrive there.
- [ ] Revert per the script's undo text; the IP-mode box sets up with no code prompt.

## Self-review (done while writing)

1. **Spec coverage.**
   - §4 claim: server check, ≥10 base32 chars, valid until the first parent, 5/min/IP plus
     a growing lockout, separate from the Wi-Fi password → T1–T3.
   - Factory-reset trigger → phase 3 (image); a wiped DB re-arms the code with no new code.
   - §5: invisible gate → T9; Kids' phones step, home-screen prompt, Tailscale optional → T11.
   - §6: token URL, long-lived session, optional PIN, platform hints, manifest + SW,
     single-use 24 h, re-issue, revoke, parent-only, unlimited devices, list + Remove →
     T5–T8, T10–T12.
   - §7 launch, revised by the owner (ntfy not on the hostname; generic alerts via upstream
     ntfy; LAN ntfy kept) → T3, T4, T7, T7A, T10, T13. Web push is a later follow-up.
   - §8 no migration → no `CLAIM_CODE` means no gate (T2). Docs → T13.
2. **Step scan.** No TBDs. Bodies only for the CAS update, the lockout schedule and fixed copy.
3. **Types.**
   - `EnrollCode`, `KidPhone`, `KidAlert`, `KidIdentity` (`types/enroll.ts`), `InstallPlatform`:
     one definition each.
   - `device_token` / `deviceToken()` and `sid` match between T7 and T10.
   - `LAST` / `LAST_STEP` = 8 in T2 and T11.
   - Migration `o2b3c4d5e6f7` → `b0c1d2e3f4a5`.
4. **Review Focus.** Each of the five has a named test in its owning task.
5. **Proportion.** ~1,000 plan lines for ~1,500 code lines. Code blocks: test names, asserts.
