// Real client IP: socket peer, unless the edge proxy vouches for x-real-ip with
// x-edge-token === INTERNAL_TOKEN and x-real-ip is a single valid IP.
const { isIP } = require('net')
const { timingSafeEqual } = require('crypto')

function clientIp(headers, remoteAddress) {
  const peer = (remoteAddress || '').replace(/^::ffff:/, '')
  const secret = process.env.INTERNAL_TOKEN || ''
  const token = headers['x-edge-token']
  const real = headers['x-real-ip']
  if (!secret || typeof token !== 'string' || typeof real !== 'string') return peer
  const a = Buffer.from(token)
  const b = Buffer.from(secret)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return peer
  return isIP(real.trim()) ? real.trim() : peer
}

module.exports = { clientIp }
