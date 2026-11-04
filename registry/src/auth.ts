import type { Env } from './index'

export const BOX_ID_RE = /^[a-z0-9]{6}$/

export async function sha256hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function safeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

/** Returns the authenticated box ID, or null. */
export async function authBox(req: Request, env: Env): Promise<string | null> {
  const h = req.headers.get('Authorization') ?? ''
  if (!h.startsWith('Basic ')) return null
  let creds: string
  try { creds = atob(h.slice(6)) } catch { return null }
  const i = creds.indexOf(':')
  if (i < 0) return null
  const id = creds.slice(0, i), secret = creds.slice(i + 1)
  if (!BOX_ID_RE.test(id)) return null
  const stored = await env.BOXES.get(`box:${id}`)
  if (!stored) return null
  return safeEq(await sha256hex(secret), stored) ? id : null
}
