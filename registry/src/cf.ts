import type { Env } from './index'

function guard(env: Env, name: string): void {
  const base = env.BASE_DOMAIN.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Allow: <id>, <id>-2, <id>-3, ..., <id>-8 for up to 8 networks, and _acme-challenge.<id>
  if (!new RegExp(`^(_acme-challenge\\.)?[a-z0-9]{6}(-[2-8])?\\.${base}$`).test(name)) throw new Error('name out of scope')
}

const api = (env: Env) => `https://api.cloudflare.com/client/v4/zones/${env.CF_ZONE_ID}/dns_records`

async function call(env: Env, cfFetch: typeof fetch, url: string, method: string, body?: unknown): Promise<any> {
  const res = await cfFetch(url, {
    method,
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const j: any = await res.json().catch(() => ({ success: false }))
  if (!res.ok || j.success === false) throw new Error(`cloudflare ${method} failed: ${res.status}`)
  return j
}

export async function upsertRecord(env: Env, cfFetch: typeof fetch, type: 'A' | 'TXT', name: string, content: string): Promise<void> {
  guard(env, name)
  const q = `${api(env)}?type=${type}&name=${encodeURIComponent(name)}`
  const list = await call(env, cfFetch, q, 'GET')
  const rec = { type, name, content, ttl: 60, proxied: false }
  const first = list.result?.[0]
  if (first) await call(env, cfFetch, `${api(env)}/${first.id}`, 'PUT', rec)
  else await call(env, cfFetch, api(env), 'POST', rec)
}

export async function createRecord(env: Env, cfFetch: typeof fetch, type: 'TXT', name: string, content: string): Promise<void> {
  guard(env, name)
  await call(env, cfFetch, api(env), 'POST', { type, name, content, ttl: 60, proxied: false })
}

export async function deleteRecord(env: Env, cfFetch: typeof fetch, type: 'TXT' | 'A', name: string, content?: string): Promise<void> {
  guard(env, name)
  const q = `${api(env)}?type=${type}&name=${encodeURIComponent(name)}`
  const list = await call(env, cfFetch, q, 'GET')
  const unq = (v: unknown) => String(v).replace(/^"(.*)"$/, '$1')
  for (const r of list.result ?? []) {
    // For TXT records, match content; for A records, delete all matching the name
    if (type === 'A' || (content && unq(r.content) === content)) {
      await call(env, cfFetch, `${api(env)}/${r.id}`, 'DELETE')
    }
  }
}

export function isPrivateV4(ip: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip)
  if (!m) return false
  if (m.slice(1).some((x) => x.length > 1 && x[0] === '0')) return false
  const o = m.slice(1).map(Number)
  if (o.some((n) => n > 255)) return false
  return o[0] === 10 || (o[0] === 172 && o[1] >= 16 && o[1] <= 31) || (o[0] === 192 && o[1] === 168)
}
