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

// True whenever Caddy or the edge touched the request (either header present at all).
// Caddy always sets X-Real-IP and connects from loopback, so with EDGE_TOKEN unset viaEdge
// alone would let edge traffic through as a LAN request.
function proxied(headers) {
  return headers['x-real-ip'] !== undefined || headers['x-edge-token'] !== undefined
}

function clientIp(headers, remoteAddress) {
  const peer = (remoteAddress || '').replace(/^::ffff:/, '')
  const real = headers['x-real-ip']
  if (typeof real !== 'string' || !viaEdge(headers)) return peer
  return isIP(real.trim()) ? real.trim() : peer
}

module.exports = { clientIp, viaEdge, proxied }
