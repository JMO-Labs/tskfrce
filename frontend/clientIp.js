// Real client IP: socket peer, unless the edge proxy vouches for x-real-ip with
// x-edge-token === EDGE_TOKEN and x-real-ip is a single valid IP.
const { isIP } = require('net')
const { timingSafeEqual } = require('crypto')

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

// True if any forwarding header is present at all (any case, even empty).
function proxied(headers) {
  return Object.keys(headers || {}).some((k) => RELAY.has(k.toLowerCase()))
}

function clientIp(headers, remoteAddress) {
  const peer = (remoteAddress || '').replace(/^::ffff:/, '')
  const real = headers['x-real-ip']
  if (typeof real !== 'string' || !viaEdge(headers)) return peer
  return isIP(real.trim()) ? real.trim() : peer
}

module.exports = { clientIp, viaEdge, proxied }
