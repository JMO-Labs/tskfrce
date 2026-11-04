# Integrations framework — design

Status: draft for owner review (builder-checked). Roadmap item #3 ("network-checked chores") was reframed by the owner into a general integration system. It also absorbs roadmap #6 (Home Assistant).

## Why

Parents want some chores to check themselves off: "Duolingo lesson done", "30 min on the reading app", "dishwasher ran". They also want to extend the app in ways we can't predict: an Amazon wish list as rewards, chat apps, and more. The owner does not want us to build every one of these. The goal is one robust, secure framework that lets the owner and other developers build integrations. Parents pick them from a list in the app, enter a field or two (such as a username), and see clearly what each one is exposed to, like app permissions on a phone.

## Who

- **Developers** (the owner and outside developers) write integrations. Parents never write code.
- **The owner** curates which integrations parents can see.
- **Parents** install, configure, trust and remove integrations. Parents control everything.
- **Kids** may see integration widgets, if a parent allows it.

## Goals

1. One contract every integration speaks, whatever it does.
2. An in-app catalog: pick → fill in settings → permission screen → connect.
3. Permissions shown before connecting, enforced on every call, and revocable in one tap.
4. Integrations can: mark chores done (signals), hear about app events, take a fixed set of actions, and show widgets on parent and/or kid screens.
5. A per-integration "trust automatically" switch. Off (the default): results go to "Needs you" for approval. On: they apply directly.
6. Developer kit: written spec, example integration, and a box simulator to test against.
7. An owner kill switch: pulling an integration from the registry disables it on every box at the next sync.

## Non-goals (this release)

- Any specific real integration (Duolingo, Amazon, Home Assistant, chat). Framework only. No integration is mandatory on day one.
- Developer code running on the box (no plugin containers, no in-process plugins).
- Arbitrary HTML/JS in the app (no iframes, no scripts).
- A public self-serve marketplace, payments or revenue share.
- Measuring app time from the blocker's DNS data. This is possible later as a first-party integration using the same contract.

## Anti-goals (a failure even if it works)

- An integration can unlock a device, change schedules, hours, locks, homework, or blocker rules. Never. Those controls are what everything else rests on.
- An integration sees data the parent wasn't told about.
- The box accepts inbound connections from integration servers.
- One broken or hostile integration slows, crashes or fills the box (2 GB RAM).
- A widget can imitate t@sk4ce UI to phish a parent or kid, or track who views it.

## Decisions

### Owner's decisions
- Developers (not parents) write integrations; parents pick from an in-app list and enter simple settings.
- A permission screen must warn parents what is exposed, like phone app permissions.
- Parents can choose to auto-trust an integration.
- Integrations may extend features (wish lists, chat, other expansions), not only verify chores.
- Integrations may add widgets: sandboxed, highly secure, on parent and/or kid screens depending on use. Parents control everything.
- No mandatory integrations on day one; build the framework.

### My calls (owner to check)
- **Catalog lives in the existing registry Worker** (taskfrce.jmolabs.dev). Only owner-approved manifests are listed. Boxes sync the catalog periodically, plus a revoked list.
- **Manifest** per integration (signed by the registry or fetched over TLS from it): id, name, developer, description, icon, version, service base URL, settings fields (typed: text/username/number/select; marked secret or not), the requested permissions, and the widgets it declares (each with surface: parent | kid).
- **Fixed permission vocabulary**, with each permission rendered to plain language on the permission screen and marked as normal or **high-risk** (shown in red):
  - Data the integration *receives*: its own settings; linked kid's first name; events it subscribes to (chore completed, request created, reward redeemed, …), with payloads trimmed to what the permission covers.
  - Actions it may *take*: mark linked chores done; add/update/remove its own reward items; send a message to parents; approve or deny reward redemptions and chore check-offs (**high-risk**; never homework, screen-time or unlock requests); show parent widgets; show kid widgets (**high-risk**, enabled per kid).
  - Scope: every grant is limited to the kids and chores the parent linked at install.
- **Box always calls out (pull model).** The box calls the integration's service:
  - `install` (settings + install id + a per-install secret)
  - `events` (batched events it is subscribed to)
  - `poll` (on a timer, per manifest interval, min 60 s)
  - `widgets` (fetch widget content)
  - `uninstall`

  Integrations reply with **actions**, which the box checks against the grant before applying. Nothing ever connects into the home. This works on boxes without a public hostname.
- **Home-network push sources** (Home Assistant, scripts on the LAN): a parent can create a "local integration" key with the same permission vocabulary. It can POST signals to the box on the LAN only. It is not reachable via the public edge.
- **Auth both ways.**
  - Box → service: requests are signed with the per-install secret (HMAC over body + timestamp; replays are rejected).
  - Service replies are bound to the request.
  - Local keys are hashed at rest.
  - Every action is checked against the grant on the box. The manifest is never trusted at runtime.
- **Widgets are declarative.**
  - The service returns JSON built from a small fixed set of building blocks: card, text, list, stat, progress, image, button.
  - t@sk4ce renders them with its own components and theme. No HTML, no scripts, no links that leave the app unless they're shown as external, with the domain visible.
  - Buttons map only to the integration's granted actions.
  - Images are proxied and size-limited by the box, so the service can't see viewers.
  - Widgets are always framed with the integration's name and icon, so they can't pass as core UI.
  - Kid widgets only receive that kid's data, and their buttons can only *request*, never approve.
- **Signals and the audit log.**
  - Every inbound action is logged: integration, kid, chore, time, result (applied / pending approval / rejected + why).
  - Parents can see the log per integration.
  - Each action carries an idempotency key, so retries never double-pay.
- **Trust switch:** default off. With it off, chore completions and approvals from the integration go to "Needs you". Turning it on shows a one-line consequence.
- **Health.**
  - Strict timeouts (≈5 s), response size caps, and per-integration rate limits.
  - Repeated failures or junk responses pause the integration and tell the parent. The core app never depends on an integration being up.
- **Uninstall / revoke** deletes the secret, stops all calls, removes its widgets and reward items, and keeps the audit log.
- **Developer kit (in repo):**
  - protocol spec (versioned, `v1`)
  - JSON schemas for manifest, actions and widgets
  - an example integration (a tiny service with an "always done" chore and a demo widget), never listed in the production catalog
  - a box simulator CLI that runs the box side against a developer's service and validates every reply

### Settled after builder review
- **Approve/deny scope (owner: option A).** The "approve or deny requests" permission covers **reward redemptions and chore check-offs only**. Homework-time, extra-screen-time and any request that unlocks a device are never approvable by an integration; they need the t@sk4ce app. This permission is the parent acting through the integration, so the trust switch does not gate it. The permission screen marks it high-risk.
- **"Needs you" (my call):** reuse the existing parent "Needs you" queue and the notification `kind` list. Add an item type for integration-originated completions that shows the integration's name and icon.
- **Trust root (my call):** the registry signs each manifest and the catalog/revoked list with an Ed25519 key. The public key is pinned in the box image. Boxes reject anything unsigned or signed with another key. Rotating the key requires a box update.
- **Outbound calls (my call):** HTTPS only, on port 443 only. Hostnames are resolved and checked: private, loopback, link-local, CGNAT and LAN addresses are refused, and the checked IP is pinned for the connection, so DNS rebinding can't redirect it. No redirects are followed. The same rules apply to widget image proxying, plus a content-type allowlist (png/jpeg/webp/gif) and a 1 MB cap.
- **Scope (my call):** every grant is per kid. Chore actions are additionally limited to linked chores. Events are delivered only for linked kids, and payloads carry only fields the permissions cover (e.g. a reward-redeemed event carries the reward name and cost, not other kids' data).
- **Secrets (my call):** the box generates the per-install secret and sends it in `install`. It is stored encrypted at rest with a box-local key, outside the DB file. Local push keys are stored hashed only.
- **Simulator (my call):** it talks to developer services over HTTP exactly as a box would, reusing the box's own client module. So the box-side protocol code is a standalone module, not logic inside routes.
- **Registry unreachable (my call):** boxes keep the last signed catalog and revoked list and retry with backoff. Installed integrations keep running. A revocation applies as soon as any box sync succeeds. Since no integration can unlock devices, failing open here is acceptable.

## Suggested phases (builder may adjust)

1. Contract + manifest + permission engine + audit log + one test integration via the simulator (no UI).
2. Catalog sync, install flow with the permission screen, trust switch, "Needs you" routing, uninstall.
3. Events out + actions in (rewards, messages, approvals).
4. Declarative widgets (parent, then kid).
5. Local push keys (Home Assistant path) + developer docs polish.

## Left to the builder

- Exact schemas, endpoint names and the DB layout, within the decisions above.
- Poll scheduling details, backoff, and caching of the catalog.
- Which existing screens host widgets and how they're arranged (follow the current theme and approved mockup rules).
- How manifests are signed or verified.
