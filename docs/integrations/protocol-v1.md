# Integrations protocol v1

Build a small web service that talks to a t@sk4ce box. The box calls you, signs every call, and checks every reply. You never call the box (except Home Assistant style [local push](#local-push-keys)).

## Quickstart

1. Host an HTTPS service on port 443 with these routes under a base URL: `POST /v1/install`, `/v1/events`, `/v1/poll`, `/v1/widgets`, `/v1/uninstall`.
2. In `install`, store the `secret` the box sends. Use it for every later call.
3. On each request, check `X-Tsk-Timestamp` is within 300 s of your clock, check `X-Tsk-Request-Id` has not been seen, then check `X-Tsk-Signature` (see [Signing](#signing)).
4. Reply with JSON `{"request_id": "<same id>", "actions": []}` and an `X-Tsk-Signature` header over the exact reply bytes.
5. Ask to be listed: see [Getting listed](#getting-listed).

Machine-readable schemas live in [`docs/integrations/schemas/`](https://github.com/JMO-Labs/tskfrce/tree/main/docs/integrations/schemas) (`manifest`, `reply`, `actions`, `widgets`, `local-push`). They are generated from the box's own models, and a test fails if they drift.

## Overview and trust model

- **Pull only.** The box connects out to you. You cannot reach into the box.
- **Signed catalog.** Only integrations in the registry catalog can be installed. The registry owner signs each manifest with Ed25519. The box verifies it against a key built into its code.
- **Permissions are enforced on the box.** The parent grants permissions, kids and chores at install time. Every action is checked against that stored grant, never against the manifest you publish later.
- **Pinned manifest.** An install keeps the manifest it was installed with. A newer catalog version is ignored until the parent removes and re-adds the integration.
- **Closed vocabulary.** Integrations can never unlock devices or touch hours, schedules, locks, overrides, screen time, homework or blocker state. There is no action for them.

## Manifest

The manifest is a JSON object (schema: `manifest.schema.json`). Unknown fields are rejected.

| Field | Rule |
|---|---|
| `id` | `^[a-z0-9][a-z0-9-]{2,39}$` |
| `name` | up to 40 chars |
| `developer` | up to 60 chars |
| `description` | up to 300 chars |
| `icon` | Material Symbols name, `^[a-z0-9_]{1,40}$` |
| `version` | `MAJOR.MINOR.PATCH` |
| `protocol` | must be `"v1"` |
| `base_url` | `https://` host, port 443 or none, no userinfo, query or fragment, host not an IP literal |
| `poll_seconds` | optional, 60 to 86400. Omit if you do not need polling |
| `settings` | up to 10 fields |
| `permissions` | unique, from the [vocabulary](#permissions) |
| `widgets` | up to 6 declarations `{id, surface, title}` |

A settings field is `{key, label, type, options, secret, required}`. `key` is `^[a-z_]{1,32}$`, `label` up to 60 chars, `type` is `text`, `username`, `number` or `select`. `select` needs `options` (up to 20, each up to 100 chars) and only `select` may have them. A `secret: true` field is sent to you once, in `install`, and the box never stores it.

A widget declaration has `id` (`^[a-z0-9_]{1,32}$`), `surface` (`parent` or `kid`) and `title` (up to 40 chars). A `parent` widget needs the `widgets.parent` permission, a `kid` widget needs `widgets.kid`.

## Permissions

Parents see this exact copy when installing. Every integration also always shows: "Its own settings, and nothing else unless listed below."

| Permission | Shown to the parent | High risk |
|---|---|---|
| `kid.name` | Your linked kids' first names | |
| `events.chore_completed` | When linked chores are done | |
| `events.request_created` | When linked kids ask for a reward or check off a linked chore | |
| `events.reward_redeemed` | When linked kids get a reward (name and cost) | |
| `chores.complete` | Mark linked chores done (it sees their names) | |
| `rewards.manage` | Add, change and remove its own rewards | |
| `messages.parents` | Send you messages | |
| `requests.decide` | Approve or deny reward requests and chore check-offs | yes |
| `widgets.parent` | Show cards on your screens | |
| `widgets.kid` | Show cards on your kids' screens | yes |

Permissions are granted per install. Kid links and kid widgets are chosen per kid. Chore actions work only on linked chores. Events go out only for linked kids.

## Endpoints

All calls are `POST {base_url}/v1/<name>` with `Content-Type: application/json`. Every body has these common fields:

| Field | Meaning |
|---|---|
| `protocol` | `"v1"` |
| `install_id` | Public id of this install (also in `X-Tsk-Install`) |
| `request_id` | 32 hex chars, unique per call (also in `X-Tsk-Request-Id`) |
| `grant` | What the parent allowed (below) |

`grant` is `{"permissions": [...], "kids": [{"id": 7, "first_name": "Sam"}], "chores": [{"id": 3, "title": "Dishes"}]}`. `first_name` appears only with `kid.name`. `chores` is empty without `chores.complete`.

Request headers on every call:

```
Content-Type: application/json
X-Tsk-Install: <install_id>
X-Tsk-Timestamp: <unix seconds>
X-Tsk-Request-Id: <request_id>
X-Tsk-Signature: v1=<hex>
```

Every reply must be a 2xx (use `200`), JSON, carry `X-Tsk-Signature`, and echo `request_id`. Replies to `events` and `poll` may add `actions` (max 20, see [Actions](#actions)); `install` replies may carry them but the box ignores them. Unknown reply fields are ignored.

### `POST /v1/install`

The box generates the per-install secret and sends it here, once. Store it.

```json
{"protocol":"v1","install_id":"9f2c...","request_id":"0b1d...","grant":{"permissions":["messages.parents"],"kids":[{"id":7}],"chores":[]},"settings":{"city":"Austin"},"secret":"kJ3...43 chars"}
```

Reply: `{"request_id":"0b1d...","actions":[]}`. A non-2xx status, a bad signature or a bad shape fails the install and nothing is connected. Actions in this reply are ignored.

The `install` call is signed with the new secret, so you can verify it as soon as you read `secret` from the body.

### `POST /v1/events`

A batch of up to 50 [events](#events), oldest first.

```json
{"protocol":"v1","install_id":"9f2c...","request_id":"6a7e...","grant":{...},"events":[{"kind":"chore.completed","at":"2026-11-04T18:02:11.482913","kid_id":7,"chore_id":3,"title":"Dishes","points":5}]}
```

Reply: `{"request_id":"6a7e...","actions":[]}`. Events are removed from the box queue once you answer successfully.

### `POST /v1/poll`

Sent every `poll_seconds` (never under 60) when the manifest sets it. Body is only the common fields. Reply with any `actions` you want applied.

```json
{"protocol":"v1","install_id":"9f2c...","request_id":"e81a...","grant":{...}}
```

Reply: `{"request_id":"e81a...","actions":[{"type":"message.parents","idempotency_key":"daily-2026-11-04","title":"Good morning"}]}`.

### `POST /v1/widgets`

Adds `surface` (`"parent"` or `"kid"`) and, for `kid`, `kid_id`. For a kid card the `grant.kids` list holds only that kid.

```json
{"protocol":"v1","install_id":"9f2c...","request_id":"c4d1...","grant":{...},"surface":"parent"}
```

Reply: `{"request_id":"c4d1...","widgets":[{"id":"today","root":{"type":"card","title":"Today","children":[{"type":"stat","label":"Steps","value":"4,210"}]}}]}`. See [Widgets](#widgets). The box caches the result for 60 s.

### `POST /v1/uninstall`

Sent when a parent removes the integration (best effort, once). Body is only the common fields. Reply with `{"request_id": "..."}`. Delete the secret and forget the install.

```json
{"protocol":"v1","install_id":"9f2c...","request_id":"3b90...","grant":{...}}
```

Reply: `{"request_id":"3b90..."}` (signed like any reply).

## Signing

HMAC-SHA256 with the per-install secret, hex digest, prefixed `v1=`.

- **Request** (`X-Tsk-Signature`): HMAC over `f"{ts}.{request_id}."` followed by the exact request body bytes. `ts` is the decimal `X-Tsk-Timestamp`.
- **Reply** (`X-Tsk-Signature`): HMAC over `f"{request_id}."` followed by the exact reply body bytes.

Sign and verify the raw bytes. Do not re-serialize JSON. Compare in constant time. The box sends compact JSON (`separators=(",", ":")`) but do not rely on that.

### Worked example (request)

```
secret     = example-secret
ts         = 1700000000
request_id = 00000000000000000000000000000000   (32 zeros)
body       = {"protocol":"v1"}
message    = 1700000000.00000000000000000000000000000000.{"protocol":"v1"}
signature  = v1=c51dcac7410e660a2f19681cbf07d7ec650e12082a0d9a21fdaa5340bf64040c
```

### Worked example (reply)

```
secret     = example-secret
request_id = 00000000000000000000000000000000
body       = {"request_id":"00000000000000000000000000000000","actions":[]}
message    = 00000000000000000000000000000000.{"request_id":"00000000000000000000000000000000","actions":[]}
signature  = v1=4c36439383c6ac51515c8f53c80679ac9d0d00c9e907cd954162716d331b0443
```

### Verify in Python

```python
import hmac, hashlib, time

def check(secret: str, headers: dict, body: bytes, seen: set) -> bool:
    ts, rid = int(headers["X-Tsk-Timestamp"]), headers["X-Tsk-Request-Id"]
    if abs(time.time() - ts) > 300 or rid in seen:
        return False
    mac = hmac.new(secret.encode(), f"{ts}.{rid}.".encode() + body, hashlib.sha256).hexdigest()
    seen.add(rid)  # keep ids for at least 10 minutes
    return hmac.compare_digest(headers["X-Tsk-Signature"], "v1=" + mac)

def sign_reply(secret: str, rid: str, body: bytes) -> str:
    return "v1=" + hmac.new(secret.encode(), f"{rid}.".encode() + body, hashlib.sha256).hexdigest()
```

## Replay rules

The box does not track replays for you. Your service must:

- Reject a timestamp more than **300 s** from your clock, in either direction.
- Reject a reused `X-Tsk-Request-Id`. Remember ids for at least 600 s (twice the skew window).
- Reject a bad signature without doing any work.
- Make actions idempotent with `idempotency_key` (below). The same key is applied once per install, and a repeat returns the first result.

The box rejects a reply whose signature is wrong or whose `request_id` does not match the request.

## Actions

Actions go in the `actions` array of an `install`, `events` or `poll` reply (max 20). The vocabulary is closed. Every action has an `idempotency_key` matching `^[A-Za-z0-9._:-]{1,80}$` and no extra fields (schema: `actions.schema.json`). The box applies actions in order; each gets a result.

| Action | Fields | Permission |
|---|---|---|
| `chore.complete` | `kid_id`, `chore_id` | `chores.complete` |
| `reward.upsert` | `ref` (up to 64), `name` (up to 100), `price` (1 to 100000), `icon` (optional) | `rewards.manage` |
| `reward.remove` | `ref` | `rewards.manage` |
| `message.parents` | `title` (up to 100), `body` (optional, up to 300) | `messages.parents` |
| `request.decide` | `target` (`reward` or `chore`), `id`, `approve`, `note` (optional, up to 200) | `requests.decide` |

Results are `applied`, `pending` or `rejected` with a `reason`. Rejection reasons:

| Reason | When |
|---|---|
| `integration is paused` | The install is paused |
| `not allowed` | Missing permission |
| `kid not linked`, `chore not linked` | `chore.complete` outside the grant |
| `kids can only ask` | A kid button triggered an action other than `chore.complete` or `message.parents` |
| `bad action`, `unknown action` | Wrong shape or type |
| `nothing to do today` | No open run of that chore today |
| `too many rewards` | More than 50 active rewards |
| `a parent removed this reward` | `reward.upsert` on a reward a parent removed |
| `has pending requests` | Changing a reward that has pending redemptions |
| `no such reward` | `reward.remove` of an unknown `ref` |
| `too many messages today` | More than 20 `message.parents` in 24 h |
| `not found` | `request.decide` for a request outside the grant |
| `already answered` | `request.decide` for a request already decided |
| `only the t@sk4ce app can answer this` | The request is not a plain reward (for example screen time) |
| `not this button's action` | A `widget.pressed` reply action whose `type` differs from the pressed button's `action` |
| `internal error` | Unexpected failure on the box |

Notes:

- `chore.complete` returns `pending` unless the parent turned on the trust switch for the install. A completion from a kid widget button is always `pending`: it goes to "Needs you".
- `request.decide` is not gated by the trust switch. It covers reward redemptions and chore check-offs only.
- Your own rewards are created with parent approval required.
- `message.parents` notifications are prefixed with the integration name.

## Events

Events arrive in `events` calls. Each has `kind`, `at` (UTC ISO time, microseconds), `kid_id`, plus the trimmed fields below. `widget.pressed` is the exception: it has no `at`, and its `kid_id` is `null` when a parent presses a button without choosing a kid. `first_name` is added only with `kid.name`. Chore `title` is dropped without `chores.complete`. Events go out only for linked kids (and linked chores).

| Kind | Needs | Fields |
|---|---|---|
| `chore.completed` | `events.chore_completed` | `chore_id`, `title`, `points` |
| `request.created` | `events.request_created` | `type`, `id`, `title`, `cost` |
| `reward.redeemed` | `events.reward_redeemed` | `reward_name`, `cost` |
| `widget.pressed` | `widgets.parent` or `widgets.kid` | `widget_id`, `button_id`, `by` (`parent` or `kid`), `kid_id` |

`widget.pressed` is sent immediately when someone presses a button. Only reply actions whose `type` equals that button's `action` are applied, as that button's origin; others are rejected. A `request.created` caused by your own `chore.complete` is not sent back to you, but your own `chore.complete` is echoed as `chore.completed` when it applies at once (trust switch on) or when a parent later approves it.

Delivery: batches of up to 50 per call. Undelivered events expire after 24 h, and each install queues at most 500.

## Widgets

A widget is `{"id": "<declared id>", "root": <block>}` (schema: `widgets.schema.json`). All strings are plain text, never markup. Unknown fields are rejected.

| Block | Fields |
|---|---|
| `card` | `title` (up to 60, optional), `children` (up to 20 blocks) |
| `text` | `text` (up to 200), `tone` (`normal`, `muted`, `good`, `warn`), `link` (https, optional) |
| `list` | `items` (up to 10 strings, each up to 100) |
| `stat` | `label` (up to 40), `value` (up to 20) |
| `progress` | `label` (up to 40), `value`, `max` (`max` > 0, `0` <= `value` <= `max`; out of range is rejected, not clamped) |
| `image` | `url` (https), `alt` (up to 100) |
| `button` | `id` (`^[a-z0-9_]{1,32}$`), `label` (up to 30), `action` (an action type) |

Limits: at most 6 widgets per reply, nesting depth 3 (the root is depth 1, only `card` has children), 40 blocks per widget, URLs up to 2048 chars.

Button rules:

- Button ids must be unique inside a widget.
- A button whose `action` your grant does not allow is dropped.
- On the `kid` surface only `chore.complete` and `message.parents` buttons survive.
- Pressing sends you `widget.pressed`; you answer with the matching action.

Image rules: the box fetches the image for you (kids' devices never contact you). `png`, `jpeg`, `webp`, `gif` only, up to 1 MiB, only URLs from a widget currently shown. Same outbound rules as other calls.

Invalid widgets are dropped (and logged). If you send widgets and all are dropped, or more than 6, the call counts as a failure.

## Outbound constraints

The box calls you under these rules. Your service must satisfy them:

- **HTTPS on port 443 only.** Plain HTTP and other ports are refused.
- **Public address only.** Hosts resolving to private, loopback, link-local, CGNAT (100.64/10), multicast, reserved or unspecified addresses (and IPv4-mapped forms) are refused. The box pins the checked IP for the connection.
- **No redirects.** Any 3xx is a failure.
- **5 s total timeout** for DNS, connect and the whole reply.
- **Reply cap 256 KiB.** Larger replies fail.
- **Identity encoding.** The box sends `Accept-Encoding: identity`. A reply with any other `Content-Encoding` is refused. Never compress.
- Status 4xx and 5xx are failures. Cookies are never sent.

## Errors, health and pausing

Anything wrong with a call counts as one failure: blocked address, timeout, transport error, redirect, bad status, oversize, bad encoding, bad signature, not JSON, wrong `request_id`, wrong shape. A good call resets the count.

After **5 consecutive failures** the install is **paused**, the parent gets a notification, and the box stops calling you until the parent tries again. Paused installs reject all actions.

Rate limits: the box makes at most 30 calls per minute per install, and a call over that limit is skipped. At most 20 parent messages per day per install. Polling is never faster than 60 s.

If the registry is unreachable the box keeps the last verified catalog and installed integrations keep running. A revocation in the catalog stops the install on the next successful sync.

## Limits

| Limit | Value |
|---|---|
| Poll interval | at least 60 s |
| Actions per reply | 20 |
| Events per batch | 50 |
| Outbound calls per install | 30 per minute |
| Parent messages per install | 20 per day |
| Local pushes per key | 60 per minute |
| Failures before pause | 5 |
| Signature clock skew | 300 s |
| Event outbox TTL | 24 h |
| Reply size | 256 KiB |
| Timeout | 5 s |
| Image size | 1 MiB |
| Catalog sync | every 6 h (backoff from 60 s doubling to 6 h) |
| Widget cache | 60 s |

## Local push keys

For something on the home network (Home Assistant, a script) that cannot host a public service. A parent creates a key in the app, picks kids, chores and permissions, and sees the token once (`tsk_local_...`). Only its hash is kept.

Allowed permissions: `chores.complete`, `rewards.manage`, `messages.parents`, `requests.decide`. No events and no widgets.

- URL: `http://<box>:3000/api/proxy/integration-local/push` (the box's LAN address).
- It never works through the public hostname or a tunnel. A request that a proxy or tunnel relayed to the box's frontend gets `404` from the frontend proxy. One that reaches the backend with forwarding headers, or from outside the LAN, gets `403`.
- Auth: `Authorization: Bearer tsk_local_...`. Wrong key is `401`. Over 60 pushes per minute per key is `429`.
- Body: `{"actions": [...]}`, max 20, same [actions](#actions) and rules as above (schema: `local-push.schema.json`).
- Reply: `{"results": [{"key": "...", "result": "applied|pending|rejected", "reason": null}]}`.

```bash
curl -X POST http://tskfrce.local:3000/api/proxy/integration-local/push \
  -H "Authorization: Bearer tsk_local_XXXX" -H "Content-Type: application/json" \
  -d '{"actions":[{"type":"message.parents","idempotency_key":"door-1","title":"Front door opened"}]}'
```

Home Assistant `configuration.yaml`:

```yaml
rest_command:
  tskfrce_message:
    url: "http://192.168.1.50:3000/api/proxy/integration-local/push"
    method: post
    headers:
      Authorization: "Bearer tsk_local_XXXX"
      Content-Type: application/json
    payload: >-
      {"actions":[{"type":"message.parents",
      "idempotency_key":"ha-{{ now().timestamp() | int }}-{{ title | slugify }}",
      "title":"{{ title }}"}]}
```

Call it with `action: rest_command.tskfrce_message` and `data: {title: "Front door opened"}`. Always use a fresh `idempotency_key` for each real event, and reuse it when retrying. Keys are 1 to 80 characters from `A-Za-z0-9._:-`, so keep titles short.

## Versioning

`v1` only grows by optional fields. Ignore fields you do not know. A breaking change becomes `/v2/...` with a new `protocol` value, and `v1` keeps working.

## Test with the simulator

The dev kit has a reference service, [`examples/integration-hello`](https://github.com/JMO-Labs/tskfrce/tree/main/examples/integration-hello) (one stdlib-only file to copy), and a box simulator that drives your service with the box's own client and checks. From the repo root, start the example:

```bash
python examples/integration-hello/server.py --port 8787
```

In a second terminal, with the backend's Python environment, point the simulator at a manifest:

```bash
cd backend
python -m app.integrations.simulator --manifest ../examples/integration-hello/manifest.json --dev
python -m app.integrations.simulator --manifest ../examples/integration-hello/manifest.json --dev --steps poll,widgets
```

For your own service, copy `manifest.json`, set `base_url` to where your service runs (for example `http://127.0.0.1:8000`) and pass that file. `--dev` allows plain HTTP, local addresses and any port. It exists only in the simulator: the box always requires HTTPS on port 443 and a public address, and it rejects a manifest with an `http` `base_url`. Without `--dev` the simulator applies the box's rules and needs a registry-signed manifest envelope.

It runs these steps in order (`install` always runs first) and prints `PASS`, `FAIL <step>: <reason>` or `SKIP` for each. The exit code is 0 only if nothing failed.

| Step | Checks |
|---|---|
| `install` | Your reply to `install` (sent with `settings` and `secret`) is signed and echoes `request_id` |
| `poll` | Each action parses and passes the grant check (skipped without `poll_seconds`) |
| `events` | One sample event per `events.*` permission, and the actions you reply |
| `widgets` | Each declared surface, through the box's widget sanitizer. Every dropped widget is a failure |
| `press` | Presses the first button and checks your reply actions match its `action` |
| `replay` | Re-sends the last request byte for byte. Your service must answer 4xx |
| `skew` | Requests signed 360 s in the past and 360 s in the future. Your service must answer 4xx to both |
| `forged` | A request signed with the wrong secret. Your service must answer 4xx |
| `uninstall` | Your reply is signed and echoes `request_id` |

The simulator's fake grant is one kid (`1`, "Sam"), one chore (`1`, "Practice"), every permission in the manifest, and the trust switch on.

## Getting listed

Only the registry owner can list an integration. Open a pull request that adds your manifest object to `registry/src/catalog.ts`. The owner reviews it, and the registry Worker signs the manifest (Ed25519) when it serves the catalog. Boxes verify it against the pinned registry key and sync every 6 h. Revoking is a PR that adds your `id` to `REVOKED`. The example integration in the dev kit is never listed.
