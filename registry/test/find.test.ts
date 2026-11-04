import { describe, expect, test } from 'vitest'
import { handle } from '../src/index'
import { fakeCf, makeEnv } from './helpers'

const get = async (qs: string, ip: string | null = '203.0.113.9', seen: string = JSON.stringify({ lanIp: '192.168.1.40', publicIp: '203.0.113.9', seenAt: 1 })) => {
  const env = await makeEnv()
  await env.BOXES.put('seen:abc123', seen)
  const orig = env.BOXES.get.bind(env.BOXES)
  const gets: string[] = []
  env.BOXES.get = (async (k: string) => (gets.push(k), orig(k))) as any
  const cf = fakeCf()
  const res = await handle(new Request('https://x/find' + qs, { headers: ip ? { 'CF-Connecting-IP': ip } : {} }), env, cf)
  return { res, body: await res.text(), cf, gets }
}

describe('GET /find', () => {
  test('same public IP shows http://<lan>:3000 link', async () => {
    const { res, body, cf } = await get('?id=abc123')
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toContain('text/html')
    expect(body).toContain('http://192.168.1.40:3000')
    expect(body).toContain('Found your box. Open it here:')
    expect(cf.calls).toHaveLength(0)
  })
  test('different public IP reveals nothing', async () => {
    const { body } = await get('?id=abc123', '198.51.100.7')
    expect(body).not.toContain('192.168.1.40')
    expect(body).toContain('was found on this network')
  })
  test('no id -> asks for the code on the sticker', async () => {
    const { res, body } = await get('')
    expect(res.status).toBe(200)
    expect(body).toContain('sticker')
    expect(body).not.toContain('192.168.1.40')
  })
  test('unknown id -> not found text', async () => {
    const { body } = await get('?id=zzzzzz')
    expect(body).toContain('was found on this network')
  })
  test('id is HTML-escaped / regex-checked', async () => {
    const { body } = await get('?id=%3Cscript%3E')
    expect(body).not.toContain('<script>')
  })
  test('ask and not-found pages have a form', async () => {
    expect((await get('')).body).toContain('<form')
    expect((await get('?id=zzzzzz')).body).toContain('<form')
  })
  test('uppercase + whitespace id matches', async () => {
    expect((await get('?id=ABC123%20')).body).toContain('http://192.168.1.40:3000')
  })
  test('no id -> no KV lookup', async () => {
    expect((await get('')).gets.filter((k) => k.startsWith('seen:'))).toEqual([])
  })
  test('no-store and no-referrer headers', async () => {
    const { res } = await get('?id=abc123')
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer')
  })
  test('non-private stored lanIp -> not found', async () => {
    const { body } = await get('?id=abc123', '203.0.113.9', JSON.stringify({ lanIp: 'evil.com/x', publicIp: '203.0.113.9' }))
    expect(body).not.toContain('evil.com')
    expect(body).toContain('was found on this network')
  })
  test('corrupt KV JSON -> 200 not found', async () => {
    const { res, body } = await get('?id=abc123', '203.0.113.9', '{nope')
    expect(res.status).toBe(200)
    expect(body).toContain('was found on this network')
  })
  test('missing CF-Connecting-IP -> not found', async () => {
    const { body } = await get('?id=abc123', null)
    expect(body).not.toContain('192.168.1.40')
    expect(body).toContain('was found on this network')
  })
})
