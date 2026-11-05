// Real client IP: socket peer, unless the edge proxy vouches for x-real-ip with
// x-edge-token === EDGE_TOKEN and x-real-ip is a single valid IP.
const { isIP } = require('net')
const { randomBytes, timingSafeEqual } = require('crypto')

// True only when x-edge-token matches EDGE_TOKEN (constant time).
function viaEdge(headers) {
  const secret = process.env.EDGE_TOKEN || ''
  const token = headers['x-edge-token']
  if (!secret || typeof token !== 'string') return false
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  return a.length === b.length && timingSafeEqual(a, b)
}

// Any of these means a proxy or tunnel relayed the request (Caddy, the edge, cloudflared,
// nginx, Tailscale Funnel...). Such a proxy sits on the LAN or Docker network, so its
// requests look local; local push keys must refuse them.
const RELAY = new Set(['x-forwarded-for', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto',
  'x-real-ip', 'x-edge-token', 'cf-connecting-ip', 'true-client-ip', 'x-client-ip', 'cf-ray'])

// Private marker set by relay-preload.js from the raw wire headers, before Next runs. Next
// injects x-forwarded-* into req.headers itself, so req.headers can't tell what the client
// sent. "Not relayed" is a per-process random nonce (shared via globalThis because the API
// route bundle gets its own copy of this module), so a client can't forge it.
const MARK = 'x-tsk-relayed'
const KEY = Symbol.for('tsk4ce.relayNonce')

function markRelayed(req) {
  const raw = req.rawHeaders || []
  let relayed = false
  for (let i = 0; i < raw.length; i += 2) if (RELAY.has(String(raw[i]).toLowerCase())) relayed = true
  globalThis[KEY] ??= randomBytes(16).toString('hex')
  req.headers[MARK] = relayed ? '1' : globalThis[KEY]
}

// Fail closed: relayed unless relay-preload.js vouched for this request (no preload = relayed).
function proxied(headers) {
  const nonce = globalThis[KEY]
  const got = (headers || {})[MARK]
  if (!nonce || typeof got !== 'string' || got.length !== nonce.length) return true
  return !timingSafeEqual(Buffer.from(got), Buffer.from(nonce))
}

function clientIp(headers, remoteAddress) {
  const peer = (remoteAddress || '').replace(/^::ffff:/, '')
  const real = headers['x-real-ip']
  if (typeof real !== 'string' || !viaEdge(headers)) return peer
  return isIP(real.trim()) ? real.trim() : peer
}

module.exports = { clientIp, viaEdge, proxied, markRelayed }
