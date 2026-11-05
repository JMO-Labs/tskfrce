import { describe, it, expect, afterEach, beforeEach } from '@jest/globals'
import handler from '../../pages/api/proxy/[...path]'
const { viaEdge, proxied, clientIp } = require('../../clientIp')

const RELAY = ['x-forwarded-for', 'forwarded', 'x-forwarded-host', 'x-forwarded-proto', 'x-real-ip',
  'x-edge-token', 'cf-connecting-ip', 'true-client-ip', 'x-client-ip', 'cf-ray']

afterEach(() => { delete process.env.EDGE_TOKEN })

describe('edge detection', () => {
  it('viaEdge is true only with the matching edge token', () => {
    process.env.EDGE_TOKEN = 'a'.repeat(64)
    expect(viaEdge({ 'x-edge-token': 'a'.repeat(64), 'x-real-ip': '1.2.3.4' })).toBe(true)
    expect(viaEdge({ 'x-edge-token': 'b'.repeat(64) })).toBe(false); expect(viaEdge({})).toBe(false)
  })
  it('viaEdge is false with EDGE_TOKEN unset', () => {
    expect(viaEdge({ 'x-edge-token': '' })).toBe(false)
  })
  it('proxied is true whenever Caddy or the edge touched the request', () => {
    delete process.env.EDGE_TOKEN
    expect(proxied({ 'x-real-ip': '127.0.0.1' })).toBe(true); expect(proxied({ 'x-edge-token': 'x' })).toBe(true)
    expect(proxied({ 'x-edge-token': '' })).toBe(true)
    expect(proxied({})).toBe(false)
  })
  const cases = RELAY.flatMap((h) => [h, h.toUpperCase(), h.replace(/(^|-)./g, (m) => m.toUpperCase())]
    .flatMap((k) => [[k, ''], [k, '192.168.1.5']]))
  it.each(cases)('proxied is true for any forwarding header (%s=%p)', (k, v) => {
    expect(proxied({ [k]: v })).toBe(true)
  })
  it('proxied is false for ordinary headers', () => {
    expect(proxied({ authorization: 'Bearer x', 'content-type': 'application/json', 'user-agent': 'HA' })).toBe(false)
  })
  it('clientIp still honours a vouched x-real-ip', () => {
    process.env.EDGE_TOKEN = 'tok'
    expect(clientIp({ 'x-edge-token': 'tok', 'x-real-ip': '1.2.3.4' }, '127.0.0.1')).toBe('1.2.3.4')
    expect(clientIp({ 'x-real-ip': '1.2.3.4' }, '::ffff:10.0.0.2')).toBe('10.0.0.2')
  })
})

describe('proxy guard for local push keys', () => {
  let fetch: any
  beforeEach(() => {
    fetch = jest.fn(async () => ({
      status: 200, headers: { forEach: () => {} }, arrayBuffer: async () => new ArrayBuffer(0),
    }))
    ;(global as any).fetch = fetch
  })
  function req(url: string, headers: Record<string, string>): any {
    return {
      method: 'POST', url, headers, socket: { remoteAddress: '127.0.0.1' }, destroy: jest.fn(),
      async *[Symbol.asyncIterator]() { yield Buffer.from('{"actions":[]}') },
    }
  }
  function res(): any {
    const r: any = {}
    r.status = jest.fn(() => r); r.json = jest.fn(() => r); r.end = jest.fn(() => r); r.setHeader = jest.fn()
    return r
  }
  const url = '/api/proxy/integration-local/push'
  it.each([
    [{ 'x-real-ip': '203.0.113.9' }],
    [{ 'x-edge-token': 'whatever' }],
    [{ 'x-real-ip': '203.0.113.9', 'x-edge-token': 'a'.repeat(64) }],
  ])('404s edge-relayed pushes without forwarding (%o)', async (h) => {
    process.env.EDGE_TOKEN = 'a'.repeat(64)
    const r = res()
    await handler(req(url, h), r)
    expect(r.status).toHaveBeenCalledWith(404)
    expect(r.json).toHaveBeenCalledWith({ detail: 'Not found.' })
    expect(fetch).not.toHaveBeenCalled()
  })
  it.each(['/api/proxy/integration%2Dlocal/push', '/api/proxy//integration-local/push',
    '/api/proxy/Integration-Local/push', '/api/proxy/integration-local%2Fpush', '/api/proxy/%E0%A4%A'])(
    '404s encoded or odd spellings when proxied (%s)', async (u) => {
      const r = res()
      await handler(req(u, { 'x-real-ip': '203.0.113.9' }), r)
      expect(r.status).toHaveBeenCalledWith(404)
      expect(fetch).not.toHaveBeenCalled()
    })
  it.each(RELAY.flatMap((h) => [[h, ''], [h.toUpperCase(), '192.168.1.5']]))(
    '404s a LAN push carrying %s=%p (tunnel or proxy on the LAN)', async (k, v) => {
      const r = res()
      const q = req(url, { authorization: 'Bearer tsk_local_x', [k]: v })
      q.socket.remoteAddress = '::ffff:192.168.1.50'
      await handler(q, r)
      expect(r.status).toHaveBeenCalledWith(404)
      expect(fetch).not.toHaveBeenCalled()
    })
  it.each(['127.0.0.1', '::1', '172.29.40.1'])('passes a header-free push from %s on as X-Real-IP (backend refuses it)',
    async (peer) => {
      const q = req(url, { authorization: 'Bearer tsk_local_x' })
      q.socket.remoteAddress = peer
      await handler(q, res())
      expect(fetch.mock.calls[0][1].headers['X-Real-IP']).toBe(peer)
    })
  it('forwards direct LAN pushes with the socket peer as X-Real-IP', async () => {
    const r = res()
    const q = req(url, { authorization: 'Bearer tsk_local_x' })
    q.socket.remoteAddress = '::ffff:192.168.1.50'
    await handler(q, r)
    const [target, init] = fetch.mock.calls[0]
    expect(target).toMatch(/\/api\/v1\/integration-local\/push$/)
    expect(init.headers['X-Real-IP']).toBe('192.168.1.50')
    expect(JSON.stringify(init.headers).toLowerCase()).not.toContain('forwarded')
  })
  it('leaves other routes alone when proxied', async () => {
    await handler(req('/api/proxy/chores', { 'x-real-ip': '203.0.113.9' }), res())
    expect(fetch).toHaveBeenCalled()
  })
})
