import { BOX_ID_RE } from './auth'
import type { Env } from './index'

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

const page = (inner: string) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"><title>Find your t@sk4ce box</title>` +
      `<style>body{font:18px system-ui,sans-serif;max-width:32em;margin:2em auto;padding:0 1em}a{word-break:break-all}</style>` +
      `</head><body><h1>Find your box</h1>${inner}</body></html>`,
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )

const ASK = '<p>Enter the 6-character code from the sticker on your box: add <code>?id=CODE</code> to this address.</p>'
const MISS =
  '<p>No box with that code was found on this network. Make sure your phone is on your home Wi-Fi.</p>'

/** Reveals a LAN IP only to a visitor whose public IP matches the box's. Never lists boxes. */
export async function findPage(id: string | null, visitorIp: string | null, env: Env): Promise<Response> {
  if (!id) return page(ASK)
  if (!BOX_ID_RE.test(id)) return page(MISS)
  const raw = await env.BOXES.get(`seen:${id}`)
  const seen = raw ? (JSON.parse(raw) as { lanIp?: string; publicIp?: string }) : null
  if (!seen?.lanIp || !visitorIp || seen.publicIp !== visitorIp) return page(MISS)
  const url = esc(`http://${seen.lanIp}:3000`)
  return page(
    `<p>Found your box. Open it here:</p><p><a href="${url}">${url}</a></p>` +
      `<p>Your router blocks the box's web address (DNS rebinding protection). The link above still works, ` +
      `or allow <code>taskfrce.jmolabs.dev</code> in your router's settings.</p>`,
  )
}
