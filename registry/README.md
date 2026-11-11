# t@sk4ce registry

Cloudflare Worker for `taskfrce.jmolabs.dev`. It keeps a box's DNS record
pointing at its LAN IP, relays ACME DNS-01 challenges (so boxes get real HTTPS
certificates without holding a Cloudflare token), and serves `/find`.

| Route | Purpose |
| --- | --- |
| `POST /api/ip` | Box reports its LAN IP; sets `<id>.taskfrce.jmolabs.dev` |
| `POST /api/acme/present`, `/cleanup` | Add/remove the `_acme-challenge` TXT record |
| `GET /find` | Kid-friendly page: type the sticker code, get redirected |

Boxes authenticate with Basic auth (`<box-id>:<secret>`). KV (`BOXES`) stores
`box:<id>` = sha256 hex of the secret, and `seen:<id>`.

## Deploy (owner, once)

Prerequisites: Node >=22, `npm ci`, `npx wrangler login`, `openssl`, and `sha256sum` or `shasum`.

1. `npm ci`. The KV namespace id and zone id are already in `wrangler.toml` (not secrets); a fork creates its own with `npx wrangler kv namespace create BOXES` and pastes the id into
   `wrangler.toml`.
2. Set `CF_ZONE_ID` (the `jmolabs.dev` zone id) in `wrangler.toml` `[vars]`.
3. `npx wrangler secret put CF_API_TOKEN` with a token scoped to
   **Zone > DNS > Edit on jmolabs.dev only**.
4. `npx wrangler deploy`. The `custom_domain` route creates the DNS record for
   `taskfrce.jmolabs.dev` itself.
5. Register each box with `scripts/new-box.sh`.

## Register a box

```sh
registry/scripts/new-box.sh
```

Prints `BOX_ID=...` and `BOX_SECRET=...` once; the secret is never stored
(only its hash). Put the ID on the sticker, then on the box run:

```sh
scripts/enable-hostname.sh <box-id> <box-secret>
docker compose -f docker-compose.prod.yml up -d
```

## Develop

`npm run typecheck` and `npm test` (also run in CI).

## Integrations catalog signing

The Worker serves a signed integrations catalog at `GET /api/integrations/catalog` (edit `src/catalog.ts` via PR).

1. `node scripts/integrations-keygen.mjs` prints `PRIVATE_PKCS8_B64=` and `PUBLIC_RAW_B64=`.
2. `wrangler secret put INTEGRATIONS_SIGNING_KEY` and paste the private value. Never commit it. Without it the endpoint returns 503.
3. Paste the public value into `REGISTRY_PUBKEY` in `backend/app/integrations/trust.py`.

`test/fixtures/envelope.json` is the cross-language fixture checked by `backend/tests/integrations/test_int_registry_interop.py`. Regenerate it with `WRITE_FIXTURE=1 npm test` if `sign.ts` changes.
