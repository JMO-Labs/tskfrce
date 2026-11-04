import { BOX_ID_RE } from './auth'
import { isPrivateV4 } from './cf'
import type { Env } from './index'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const page = (inner: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Find your t@sk4ce box</title>` +
      `<style>body{font:18px system-ui,sans-serif;max-width:32em;margin:2em auto;padding:0 1em}a{word-break:break-all}</style>` +
      `</head><body><h1>Find your box</h1>${inner}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' } },
  )

const FORM =
  '<form method="get" action="/find"><p><label>Type the 6-character code from your box sticker<br>' +
  '<input name="id" maxlength="6" autocomplete="off" autocapitalize="none" required></label></p>' +
  '<button>Find my box</button></form>'
const ASK = FORM
const MISS =
  '<p>No box with that code was found on this network. Make sure your phone is on your home Wi-Fi.</p>' + FORM

/** First 4 hextets (/64) of an IPv6 address, expanded; null if malformed. */
export function v6prefix(ip: string): string | null {
  if (!/^[0-9a-f:]+$/i.test(ip) || (ip.match(/::/g) ?? []).length > 1) return null
  const [h, t] = ip.split('::')
  const head = h ? h.split(':') : [], tail = t ? t.split(':') : []
  const fill = ip.includes('::') ? 8 - head.length - tail.length : 0
  if (fill < 0 || (!ip.includes('::') && head.length !== 8)) return null
  const all = [...head, ...Array(fill).fill('0'), ...tail]
  if (all.length !== 8 || all.some((x) => !/^[0-9a-f]{1,4}$/i.test(x))) return null
  return all.slice(0, 4).map((x) => parseInt(x, 16)).join(':')
}

type Seen = { lanIp?: string; publicIp4?: string; publicIp6?: string; seenAt4?: number; seenAt6?: number }

/** Box reports hourly; ignore a family not heard from in 2 reports. */
export const FIND_MAX_AGE_MS = 2 * 60 * 60 * 1000

function sameNetwork(seen: Seen, visitor: string, now: number): boolean {
  const fresh = (t?: number) => typeof t === 'number' && now - t <= FIND_MAX_AGE_MS
  const p4 = fresh(seen.seenAt4) ? seen.publicIp4 : '', p6 = fresh(seen.seenAt6) ? seen.publicIp6 : ''
  if (!visitor.includes(':')) return !!p4 && p4 === visitor
  const v = v6prefix(visitor)
  return !!v && !!p6 && v === v6prefix(p6)
}

/** Reveals a LAN IP only to a visitor whose public IP matches the box's. Never lists boxes. */
export async function findPage(id: string | null, visitorIp: string | null, env: Env, now: number = Date.now()): Promise<Response> {
  if (!id) return page(ASK)
  const code = id.trim().toLowerCase()
  if (!BOX_ID_RE.test(code)) return page(MISS)
  let seen: Seen | null = null
  try {
    const raw = await env.BOXES.get(`seen:${code}`)
    seen = raw ? JSON.parse(raw) : null
  } catch { /* corrupt entry -> not found */ }
  if (!seen?.lanIp || !isPrivateV4(seen.lanIp) || !visitorIp || !sameNetwork(seen, visitorIp, now)) return page(MISS)
  const url = esc(`http://${seen.lanIp}:3000`)
  return page(
    `<p>Found your box. Open it here:</p><p><a href="${url}">${url}</a></p>` +
      `<p>Your router blocks the box's web address (DNS rebinding protection). The link above still works, ` +
      `or allow <code>taskfrce.jmolabs.dev</code> in your router's settings.</p>`,
  )
}
