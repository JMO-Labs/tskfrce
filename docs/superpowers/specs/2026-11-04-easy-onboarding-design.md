# Easy onboarding (Ring-style setup) — design

Date: 2026-11-04 · Status: draft for owner review

## Intent

A parent who has never changed a router or DNS setting unboxes a t@sk4ce box,
follows a short guided flow on their phone, and it just works. Kids never type an
IP address or port. The model is a Ring or Hue device: plug in, scan, pick
your Wi-Fi, done.

Today the parent must find the box's LAN IP and open `http://<ip>:3000`. Kids do
the same. Kid alerts need the separate ntfy app plus a QR scan. That is too much
for the target parent.

## Decided by the owner

- Parents receive a **fully prepared box** with the OS and t@sk4ce preinstalled.
  The box is a mini PC. They never run `install.sh` or `prep-box.sh`.
- **Wi-Fi is the main path**. A network cable is optional.
- **No native mobile app at launch.** Everything is web-based. A cross-platform
  mobile app is a separate, later project.
- The owner runs the domain **`taskfrce.jmolabs.dev`**. Boxes are
  `<box-id>.taskfrce.jmolabs.dev`. The DNS provider is not chosen yet; confirm
  it at plan time, because the domain service talks to its API.
- Beta fleet: **fewer than 20 boxes**.
- The six-screen flow in the approved mockup is right for initial launch:
  1. Plug in the box.
  2. Scan the sticker QR to join the setup Wi-Fi.
  3. A sign-in page pops up. Pick home Wi-Fi and enter the password.
  4. The box connects. Open the box.
  5. Run the existing parent setup wizard.
  6. Each kid scans a QR and adds t@sk4ce to their home screen.

  Mockup: `.superpowers/brainstorm/3901583-1793800667/content/setup-flow.html`.

## Goals

1. First-time setup takes **≤ 5 minutes** with no typed addresses, no router
   changes, and no app-store installs.
2. Parents and kids reach the box by **scanning a QR or tapping a home-screen
   icon**, never by IP.
3. Kid and parent pages are **installable to the home screen** and look like an
   app.
4. A Wi-Fi password change, or a move to a new router, has a recovery path that
   doesn't need a technician.

## Non-goals (this project)

- Native iOS or Android apps. They are a later project.
- Bluetooth setup.
- Reaching the box from outside the home. The Tailscale step stays as is.
- OS and service auto-updates of the shipped box. That is a separate topic, but
  the image must not block it.
- The other planned features: homework mode, network-verified chores, and so on.

## Anti-goals (would be a failure even if it "works")

- Family data or traffic routed through the owner's servers. The domain service
  may only learn what the bootstrap needs: the box ID, LAN IP and public IP. It
  must never see chores, kids, devices or browsing.
- Anyone on the home network, or in Wi-Fi range during setup, can claim the box
  before the parent does.
- A setup that needs the parent to understand IPs, ports, DNS or certificates.
- A box that silently becomes unreachable after a Wi-Fi password change, with no
  visible way back.

## Current state (from code recon)

- Install is `install.sh` → docker compose (`docker-compose.prod.yml`):
  - frontend (Next.js) on `0.0.0.0:3000`, plain **HTTP**
  - backend on `127.0.0.1:8000`
  - ntfy on `:2586`
  - blocker with `network_mode: host`

  No TLS, no reverse proxy, no systemd units, no mDNS advertisement.
- `BOX_URL` and `NTFY_PUBLIC_URL` are baked into `.env` as the LAN IP at install
  time.
- The blocker spoofs **only paused devices**. Its captive DNS and HTTP redirect
  (`blocker/portal.py`) only touch those devices. So it cannot serve as a general
  name server for the household. The box also has no general DNS role.
- The setup wizard has 7 steps, saved server-side (`pages/setup.tsx`,
  `src/v2/setup/`):
  1. Parent account
  2. Family
  3. Kids
  4. Starter chores
  5. Devices
  6. Hours
  7. Remote access (Tailscale text)

  There is no Wi-Fi, notifications or "claim" step.
- Kid login (`src/v2/kid/KidPage.tsx`): pick your name, then an optional PIN.
- No PWA: no manifest, no service worker, no web push. Kid alerts go through
  ntfy (`backend/app/api/kid_push.py` gives each kid a topic and QR).
- The blocker uses one `LAN_IFACE` and works on Wi-Fi or wired. Wired is more
  reliable: some access points use client isolation or proxy ARP.

## The design

### 1. Factory image and the box sticker

Every box is imaged with:

- a unique **box ID**: short, lowercase and DNS-safe, e.g. `k7m2qx`
- a **box secret**, used only to talk to the domain service
- a unique **setup Wi-Fi password**
- a **claim code**: a short code that proves physical possession

The sticker (and the quick-start card) carries:

- **QR 1 "Set me up"**: a standard Wi-Fi QR
  (`WIFI:T:WPA;S:t@sk4ce-k7m2;P:<setup pw>;;`). Phone cameras on iOS and Android
  offer "Join network" directly.
- **QR 2 "Open my box"**: `https://k7m2qx.taskfrce.jmolabs.dev/` plus the claim code in the
  URL fragment, so it is never sent to a server.
- The same values printed as text for the rare manual case.

The image boots straight into the stack: docker compose under a systemd unit, so
startup order is explicit. A box with no working network enters **setup mode**.

### 2. Setup mode (box has no network)

Trigger:

- On boot, no wired link with a DHCP lease **and** no saved Wi-Fi.
- Also: saved Wi-Fi unreachable for 5 minutes, for example after a password
  change.

Setup mode stays on until the box is online.

In setup mode the box:

1. **Scans** nearby Wi-Fi networks first and caches the list. Many single-radio
   chips can't scan while hosting a hotspot.
2. Starts a **WPA2 hotspot** `t@sk4ce-<first4>` using the setup password, via
   NetworkManager.
3. Runs a **captive portal**:
   - Every DNS answer points to the box.
   - HTTP serves the setup page.

   Phones open their sign-in pop-up automatically, like hotel Wi-Fi.
4. The setup page shows the cached network list (strongest first), a password
   field, and "Connect".

On "Connect":

- The page says: "Your box is connecting. Your phone will go back to your home
  Wi-Fi. Then scan **Open my box** on the sticker."
- The phone's captive pop-up may close by itself when the hotspot drops. This
  message, plus QR 2, is the handoff, so nothing depends on the pop-up staying
  open.
- The box drops the hotspot and tries to join.
  - Success: it saves the network and leaves setup mode.
  - Failure after 60 s: it brings the hotspot back. The setup page then shows
    "That password didn't work — try again" when the parent rejoins. QR 1 still
    works.
- If a cable is plugged in at any point with a working lease, setup mode ends.

**Wired path:** the box gets a lease at first boot and never enters setup mode.
The parent scans QR 2 directly.

### 3. Reaching the box: `https://<box-id>.taskfrce.jmolabs.dev`

- A small **domain service**, run by the owner, gives each box a real hostname
  `<box-id>.taskfrce.jmolabs.dev`. Public DNS resolves it to the box's **LAN IP**. Plex uses
  the same trick (`*.plex.direct`).
- The box reports its LAN IP to the domain service on boot and on change,
  authenticated with the box secret. The service updates the DNS record.
- **TLS:** the box gets a real certificate for its hostname through ACME DNS-01.
  The domain service publishes the `_acme-challenge` TXT record on the box's
  behalf, so the box never holds DNS credentials for the whole domain. The box
  renews automatically.
- **My call, on certificates:**
  - Each box has its own key and certificate from Let's Encrypt. There is no
    shared wildcard, so a compromised box exposes nothing about the others.
  - Let's Encrypt allows 50 new certificates per registered domain
    (`jmolabs.dev`) per week. Renewals are exempt. That is fine for under 20
    boxes.
  - If the fleet grows past ~50 new boxes a week, request a limit increase.
  - `.dev` is HSTS-preloaded, so box hostnames are HTTPS-only. The plain-HTTP
    fallback always uses the LAN IP, never the hostname.
- **No internet or no certificate yet** (first boot offline, or the ISP is
  down):
  - The setup success page also shows a plain `http://<lan-ip>:3000` link.
  - The box syncs its clock over NTP before requesting a certificate.
  - The UI keeps working over HTTP. Only installing to the home screen waits for
    HTTPS.
- The box serves HTTPS on **443** in front of the frontend and ntfy. Plain
  `:3000` stays for fallback and dev.
- `BOX_URL` becomes the hostname instead of an IP.

**Fallbacks**, in order. The UI must handle all of them:

1. **DNS rebinding protection.** Some routers and DNS filters (some ISP routers,
   Pi-hole and AdGuard options, pfSense) refuse public names that resolve to
   private IPs. If the hostname won't resolve, the parent gets a "find my box"
   page at `https://taskfrce.jmolabs.dev/find?id=<box-id>`:
   - QR 2's page detects the DNS failure and links there.
   - **My call: no listing.** The service reveals a box's LAN IP only when the
     visitor's public IP matches the public IP that box last reported. Without a
     box ID it shows nothing. This stays safe behind CGNAT or shared IPs.
   - The page links to `http://<lan-ip>:3000`, which works but can't be
     installed.
   - It explains the one router setting to change, with a guide link.
2. **mDNS**: the box advertises `<box-id>.local` via Avahi, for devices and
   browsers that support it.

### 4. Claiming the box (first parent)

- The setup wizard requires the **claim code** before step 1 (parent account)
  can be created. QR 2 fills it in automatically from the URL fragment.
- **My call, on enforcement:**
  - The check is server-side in the backend.
  - The code is separate from the setup Wi-Fi password.
  - It has ≥ 10 base32 characters (about 50 bits).
  - It stays valid until the first parent account exists.
  - Attempts are rate-limited to 5 per minute per client IP, with a growing
    lockout after that.
- After the first parent account exists, the claim code is no longer accepted.
- A factory reset brings it back. The trigger is the builder's choice; see Left
  to the builder.

### 5. Wizard changes

Keep the existing 7 steps. Changes:

- Claim-code gate before step 1, invisible when it arrives via QR 2.
- A new **"Kids' phones" step** after Kids. For each kid it shows a QR. Not every
  kid has a phone, so it can be skipped and done later from the kid's settings.
- A new **"Add to your home screen"** prompt for the parent at the finish
  screen.
- Step 7 (Tailscale) stays, marked optional.

### 6. Kid enrollment and installable pages

- Each kid QR opens `https://<box-id>.taskfrce.jmolabs.dev/kid?enroll=<one-time token>`.
- The token signs the kid in on that device with a long-lived session. The PIN
  stays optional.
- The page then shows platform-specific "Add to Home Screen" instructions: an
  iOS share-sheet hint, or the Android install prompt.
- Add a **web app manifest** (name, icons, start URL `/kid` or `/`) and a minimal
  **service worker**, so both kid and parent pages are installable. This needs
  HTTPS, which section 3 provides.
- Tokens are single-use and expire after 24 h. The parent can re-issue them and
  revoke a device's session.
- **My call:** only a signed-in parent can issue a token. There is no limit on
  devices per kid. Each kid's settings list their enrolled devices, with
  "Remove".

### 8. Existing installs and build order

- **My call: no migration.** `install.sh` boxes keep working in IP mode. The
  hostname, TLS and setup mode turn on only when the image provides a box ID and
  secret, so the same code supports both.
- **Build order (my call):**
  1. Domain service, plus hostname and TLS on a wired box.
  2. Claim code, plus kid enrollment and the PWA.
  3. Setup-mode hotspot. Before building it, run a short spike that confirms the
     beta hardware's Wi-Fi chip supports AP mode (`iw list` shows `AP` under
     supported interface modes).

  This order ships the wired path and QR 2 first, even if the hotspot slips.

### 7. Alerts on kids' phones

**My call:**

- Launch keeps ntfy as it is, but behind the new HTTPS hostname.
- **Web push** through the installed PWA is a follow-up inside this project,
  once the PWA ships. It removes the separate ntfy app. iOS supports web push
  only for home-screen-installed web apps (16.4+), which this design already
  produces.

## Constraints

- The prepared-box image is Ubuntu (26.04) on an x86_64 mini PC. Pi or arm64
  should remain possible but is not the launch target.
- The Wi-Fi chip must support AP mode in NetworkManager. **Verify on the actual
  beta hardware before building section 2.** If it can't, the fallback is wired
  setup plus QR 2, or a supported USB Wi-Fi adapter.
- When the box is on Wi-Fi, the blocker's `LAN_IFACE` is the Wi-Fi interface.
  Docs should still recommend a cable for the most reliable blocking.
- Files under 500 lines. Semantic commits. CI must pass.
- The domain service is the only internet-facing component the owner runs. Keep
  it tiny:
  - IP update
  - ACME TXT set and clear
  - the find page

## Left to the builder

- Which reverse proxy and TLS terminator to use, and how the cert is stored.
- Box ID format, and how secrets are generated and burned at imaging time.
- Factory-reset trigger. The mini PC has no reset button. Options: a reset file
  on a USB stick, or three quick power cycles.
- Captive-portal implementation details (dnsmasq vs a small built-in server).
- Domain service stack and hosting, and its rate limiting and abuse protection.
- Exact copy and visuals of the setup pages, matching the v3 design system.
- How setup mode is tested. The hotspot needs real hardware; the rest can run
  in the lab.
