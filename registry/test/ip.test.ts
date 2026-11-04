import { expect, test } from 'vitest'
import { handle } from '../src/index'
import { basic, fakeCf, makeEnv } from './helpers'

const post = (path: string, body: unknown, auth?: string, cfip?: string) =>
  new Request('https://x.test' + path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { ...(auth ? { Authorization: auth } : {}), ...(cfip ? { 'CF-Connecting-IP': cfip } : {}) },
  })

test('valid box + private IP upserts A record and stores seen', async () => {
  const env = await makeEnv(), cf = fakeCf()
  const res = await handle(post('/api/ip', { ip: '192.168.1.40' }, basic('abc123', 's3cret'), '203.0.113.9'), env, cf)
  expect(res.status).toBe(204)
  expect(cf.calls.some((c) => c.method === 'POST' && c.body.name === 'abc123.taskfrce.jmolabs.dev' && c.body.content === '192.168.1.40' && c.body.type === 'A' && c.body.ttl === 60 && c.body.proxied === false)).toBe(true)
  expect(JSON.parse((await env.BOXES.get('seen:abc123'))!)).toMatchObject({ lanIp: '192.168.1.40', publicIp: '203.0.113.9' })
})

test('existing record is PUT', async () => {
  const env = await makeEnv()
  const calls: any[] = []
  const cf = (async (u: string, i?: RequestInit) => {
    calls.push({ method: i?.method ?? 'GET', url: String(u) })
    return new Response(JSON.stringify({ success: true, result: i?.method === 'GET' ? [{ id: 'rec9' }] : {} }))
  }) as unknown as typeof fetch
  const res = await handle(post('/api/ip', { ip: '10.0.0.5' }, basic('abc123', 's3cret')), env, cf)
  expect(res.status).toBe(204)
  expect(calls.some((c) => c.method === 'PUT' && c.url.endsWith('/rec9'))).toBe(true)
})

test('wrong secret -> 401, no CF call', async () => {
  const env = await makeEnv(), cf = fakeCf()
  expect((await handle(post('/api/ip', { ip: '10.0.0.5' }, basic('abc123', 'nope')), env, cf)).status).toBe(401)
  expect(cf.calls).toHaveLength(0)
})

test('missing auth -> 401, no CF call', async () => {
  const env = await makeEnv(), cf = fakeCf()
  expect((await handle(post('/api/ip', { ip: '10.0.0.5' }), env, cf)).status).toBe(401)
  expect(cf.calls).toHaveLength(0)
})

test('bad box id format -> 401', async () => {
  const env = await makeEnv(), cf = fakeCf()
  expect((await handle(post('/api/ip', { ip: '10.0.0.5' }, basic('ABC!!!', 's3cret')), env, cf)).status).toBe(401)
  expect(cf.calls).toHaveLength(0)
})

test.each(['8.8.8.8', '172.32.0.1', '300.1.1.1', 'x'])('ip %s -> 400, no CF call', async (ip) => {
  const env = await makeEnv(), cf = fakeCf()
  expect((await handle(post('/api/ip', { ip }, basic('abc123', 's3cret')), env, cf)).status).toBe(400)
  expect(cf.calls).toHaveLength(0)
})

test('GET /api/ip -> 405', async () => {
  const env = await makeEnv(), cf = fakeCf()
  const res = await handle(new Request('https://x.test/api/ip'), env, cf)
  expect(res.status).toBe(405)
})

test('unknown path -> 404', async () => {
  const env = await makeEnv(), cf = fakeCf()
  expect((await handle(new Request('https://x.test/nope'), env, cf)).status).toBe(404)
})
