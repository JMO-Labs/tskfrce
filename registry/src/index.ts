import { authBox } from './auth'
import { createRecord, deleteRecord, isPrivateV4, upsertRecord } from './cf'

export type Env = { BOXES: KVNamespace; CF_API_TOKEN: string; CF_ZONE_ID: string; BASE_DOMAIN: string }
type Ctx = { req: Request; env: Env; cf: typeof fetch }
type Route = (c: Ctx) => Promise<Response>

const json = (o: unknown, status = 200) =>
  new Response(JSON.stringify(o), { status, headers: { 'Content-Type': 'application/json' } })

const postIp: Route = async ({ req, env, cf }) => {
  const id = await authBox(req, env)
  if (!id) return json({ error: 'unauthorized' }, 401)
  const body = (await req.json().catch(() => null)) as { ip?: unknown } | null
  const ip = body?.ip
  if (typeof ip !== 'string' || !isPrivateV4(ip)) return json({ error: 'ip must be private IPv4' }, 400)
  await upsertRecord(env, cf, 'A', `${id}.${env.BASE_DOMAIN}`, ip)
  const seen = { lanIp: ip, publicIp: req.headers.get('CF-Connecting-IP') ?? '', seenAt: Date.now() }
  await env.BOXES.put(`seen:${id}`, JSON.stringify(seen))
  return new Response(null, { status: 204 })
}

// lego httpreq: body {fqdn, value}; only the caller's own _acme-challenge name is allowed.
const acme = (act: typeof createRecord): Route => async ({ req, env, cf }) => {
  const id = await authBox(req, env)
  if (!id) return json({ error: 'unauthorized' }, 401)
  const b = (await req.json().catch(() => null)) as { fqdn?: unknown; value?: unknown } | null
  if (typeof b?.fqdn !== 'string' || typeof b.value !== 'string' || !b.value) return json({ error: 'fqdn and value required' }, 400)
  const name = b.fqdn.trim().toLowerCase().replace(/\.$/, '')
  if (name !== `_acme-challenge.${id}.${env.BASE_DOMAIN}`) return json({ error: 'forbidden' }, 403)
  await act(env, cf, 'TXT', name, b.value)
  return json({})
}

// path -> { METHOD: handler }. Add new routes here.
const routes: Record<string, Record<string, Route>> = {
  '/api/ip': { POST: postIp },
  '/api/acme/present': { POST: acme(createRecord) },
  '/api/acme/cleanup': { POST: acme(deleteRecord) },
}

export async function handle(req: Request, env: Env, cfFetch: typeof fetch): Promise<Response> {
  const methods = routes[new URL(req.url).pathname]
  if (!methods) return json({ error: 'not found' }, 404)
  const route = methods[req.method]
  if (!route) return json({ error: 'method not allowed' }, 405)
  try {
    return await route({ req, env, cf: cfFetch })
  } catch (e) {
    console.error(e)
    return json({ error: 'upstream' }, 502)
  }
}

export default { fetch: (req: Request, env: Env) => handle(req, env, fetch) }
