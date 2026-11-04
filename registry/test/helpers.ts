import type { Env } from '../src/index'

export const sha256hex = async (s: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))]
    .map((b) => b.toString(16).padStart(2, '0')).join('')

export function fakeKV() {
  const m = new Map<string, string>()
  return {
    get: async (k: string) => m.get(k) ?? null,
    put: async (k: string, v: string) => void m.set(k, v),
    delete: async (k: string) => void m.delete(k),
  } as unknown as KVNamespace
}

export type Call = { url: string; method: string; body: any }
export function fakeCf() {
  const calls: Call[] = []
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body ? JSON.parse(String(init.body)) : undefined })
    return new Response(JSON.stringify({ success: true, result: [] }), { status: 200 })
  }) as unknown as typeof fetch
  return Object.assign(fn, { calls })
}

export const basic = (id: string, secret: string) => 'Basic ' + btoa(`${id}:${secret}`)

export async function makeEnv(id = 'abc123', secret = 's3cret'): Promise<Env> {
  const BOXES = fakeKV()
  await BOXES.put(`box:${id}`, await sha256hex(secret))
  return { BOXES, CF_API_TOKEN: 'tok', CF_ZONE_ID: 'zone1', BASE_DOMAIN: 'taskfrce.jmolabs.dev' }
}
