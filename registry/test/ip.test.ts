import { expect, test, vi } from 'vitest'
import { handle } from '../src/index'
import { upsertRecord } from '../src/cf'
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
  expect(JSON.parse((await env.BOXES.get('seen:abc123'))!)).toMatchObject({ lanIp: '192.168.1.40', publicIp4: '203.0.113.9' })
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

test.each([['172.15.0.1', 400], ['172.16.0.1', 204], ['172.31.255.255', 204], ['10.0.0.1', 204], ['010.0.0.1', 400], ['192.168.001.001', 400]])('ip %s -> %i', async (ip, st) => {
  const env = await makeEnv(), cf = fakeCf()
  expect((await handle(post('/api/ip', { ip }, basic('abc123', 's3cret')), env, cf)).status).toBe(st)
})

test('lowercase basic scheme accepted', async () => {
  const env = await makeEnv(), cf = fakeCf()
  const res = await handle(post('/api/ip', { ip: '10.0.0.5' }, basic('abc123', 's3cret').replace('Basic', 'basic')), env, cf)
  expect(res.status).toBe(204)
})

test.each([
  new Response('<html>', { status: 502 }),
  new Response(JSON.stringify({ success: false }), { status: 400 }),
  new Response(JSON.stringify({ success: false }), { status: 200 }),
])('CF failure -> 502, seen not written', async (r) => {
  const env = await makeEnv()
  const cf = (async () => r.clone()) as unknown as typeof fetch
  expect((await handle(post('/api/ip', { ip: '10.0.0.5' }, basic('abc123', 's3cret')), env, cf)).status).toBe(502)
  expect(await env.BOXES.get('seen:abc123')).toBeNull()
})

test.each(['jmolabs.dev', 'www.jmolabs.dev', 'a.b.taskfrce.jmolabs.dev', 'abc123.taskfrce.jmolabsXdev', 'abc123-1.taskfrce.jmolabs.dev', 'abc123-9.taskfrce.jmolabs.dev'])('out-of-scope name %s throws, no CF call', async (name) => {
  const env = await makeEnv(), cf = fakeCf()
  await expect(upsertRecord(env, cf, 'A', name, '10.0.0.1')).rejects.toThrow()
  expect(cf.calls).toHaveLength(0)
})

test('acme challenge name allowed', async () => {
  const env = await makeEnv(), cf = fakeCf()
  await upsertRecord(env, cf, 'TXT', '_acme-challenge.abc123.taskfrce.jmolabs.dev', 'tok')
  expect(cf.calls.length).toBeGreaterThan(0)
})

test('v6 report stores publicIp6 and keeps publicIp4', async () => {
  const env = await makeEnv(), cf = fakeCf()
  await handle(post('/api/ip', { ip: '192.168.1.40' }, basic('abc123', 's3cret'), '203.0.113.9'), env, cf)
  await handle(post('/api/ip', { ip: '192.168.1.40' }, basic('abc123', 's3cret'), '2001:db8:1:2::5'), env, cf)
  expect(JSON.parse((await env.BOXES.get('seen:abc123'))!)).toMatchObject({ lanIp: '192.168.1.40', publicIp4: '203.0.113.9', publicIp6: '2001:db8:1:2::5' })
})

test('v6 report updates seenAt6 only, leaves v4 fields intact', async () => {
  vi.useFakeTimers()
  const env = await makeEnv(), cf = fakeCf()
  vi.setSystemTime(1000)
  await handle(post('/api/ip', { ip: '192.168.1.40' }, basic('abc123', 's3cret'), '203.0.113.9'), env, cf)
  vi.setSystemTime(5000)
  await handle(post('/api/ip', { ip: '192.168.1.40' }, basic('abc123', 's3cret'), '2001:db8:1:2::5'), env, cf)
  vi.useRealTimers()
  expect(JSON.parse((await env.BOXES.get('seen:abc123'))!)).toMatchObject({
    publicIp4: '203.0.113.9', seenAt4: 1000, publicIp6: '2001:db8:1:2::5', seenAt6: 5000, seenAt: 5000,
  })
})

test('v4 report drops legacy publicIp key', async () => {
  const env = await makeEnv(), cf = fakeCf()
  await env.BOXES.put('seen:abc123', JSON.stringify({ lanIp: '10.0.0.1', publicIp: '2001:db8::1', seenAt: 1 }))
  await handle(post('/api/ip', { ip: '192.168.1.40' }, basic('abc123', 's3cret'), '203.0.113.9'), env, cf)
  expect(JSON.parse((await env.BOXES.get('seen:abc123'))!)).not.toHaveProperty('publicIp')
})

test('report without CF-Connecting-IP leaves family fields unchanged', async () => {
  const env = await makeEnv(), cf = fakeCf()
  const fam = { publicIp4: '203.0.113.9', seenAt4: 11, publicIp6: '2001:db8::1', seenAt6: 22 }
  await env.BOXES.put('seen:abc123', JSON.stringify({ lanIp: '10.0.0.1', seenAt: 22, ...fam }))
  const res = await handle(post('/api/ip', { ip: '192.168.1.40' }, basic('abc123', 's3cret')), env, cf)
  expect(res.status).toBe(204)
  const got = JSON.parse((await env.BOXES.get('seen:abc123'))!)
  expect(got).toMatchObject({ ...fam, lanIp: '192.168.1.40' })
  expect(got.seenAt).toBeGreaterThan(22)
})

test('networks array: single network creates id record', async () => {
  const env = await makeEnv(), cf = fakeCf()
  const res = await handle(post('/api/ip', { networks: [{ ip: '192.168.1.40', label: 'Wired' }] }, basic('abc123', 's3cret'), '203.0.113.9'), env, cf)
  expect(res.status).toBe(204)
  expect(cf.calls.some((c) => c.method === 'POST' && c.body.name === 'abc123.taskfrce.jmolabs.dev' && c.body.content === '192.168.1.40')).toBe(true)
  const seen = JSON.parse((await env.BOXES.get('seen:abc123'))!)
  expect(seen).toMatchObject({ networks: [{ ip: '192.168.1.40', label: 'Wired' }], publicIp4: '203.0.113.9' })
})

test('networks array: multiple networks create id, id-2, id-3 records', async () => {
  const env = await makeEnv(), cf = fakeCf()
  const nets = [
    { ip: '192.168.1.40', label: 'Wired' },
    { ip: '10.0.0.5', label: 'Wi-Fi' },
    { ip: '172.20.0.1', label: 'VLAN 100' },
  ]
  const res = await handle(post('/api/ip', { networks: nets }, basic('abc123', 's3cret')), env, cf)
  expect(res.status).toBe(204)
  expect(cf.calls.some((c) => c.method === 'POST' && c.body.name === 'abc123.taskfrce.jmolabs.dev' && c.body.content === '192.168.1.40')).toBe(true)
  expect(cf.calls.some((c) => c.method === 'POST' && c.body.name === 'abc123-2.taskfrce.jmolabs.dev' && c.body.content === '10.0.0.5')).toBe(true)
  expect(cf.calls.some((c) => c.method === 'POST' && c.body.name === 'abc123-3.taskfrce.jmolabs.dev' && c.body.content === '172.20.0.1')).toBe(true)
  const seen = JSON.parse((await env.BOXES.get('seen:abc123'))!)
  expect(seen.networks).toEqual(nets)
})

test('networks with invalid IP rejected', async () => {
  const env = await makeEnv(), cf = fakeCf()
  const res = await handle(post('/api/ip', { networks: [{ ip: '8.8.8.8', label: 'Bad' }] }, basic('abc123', 's3cret')), env, cf)
  expect(res.status).toBe(400)
  expect(cf.calls).toHaveLength(0)
})

test('empty networks array rejected', async () => {
  const env = await makeEnv(), cf = fakeCf()
  const res = await handle(post('/api/ip', { networks: [] }, basic('abc123', 's3cret')), env, cf)
  expect(res.status).toBe(400)
  expect(cf.calls).toHaveLength(0)
})

test('networks capped at 8', async () => {
  const env = await makeEnv(), cf = fakeCf()
  const nets = Array.from({ length: 9 }, (_, i) => ({ ip: `10.0.0.${i + 1}`, label: `Net${i}` }))
  const res = await handle(post('/api/ip', { networks: nets }, basic('abc123', 's3cret')), env, cf)
  expect(res.status).toBe(400)
  expect(cf.calls).toHaveLength(0)
})

test('label capped at 32 chars', async () => {
  const env = await makeEnv(), cf = fakeCf()
  const res = await handle(post('/api/ip', { networks: [{ ip: '10.0.0.1', label: 'x'.repeat(33) }] }, basic('abc123', 's3cret')), env, cf)
  expect(res.status).toBe(400)
  expect(cf.calls).toHaveLength(0)
})

test('empty label rejected', async () => {
  const env = await makeEnv(), cf = fakeCf()
  const res = await handle(post('/api/ip', { networks: [{ ip: '10.0.0.1', label: '' }] }, basic('abc123', 's3cret')), env, cf)
  expect(res.status).toBe(400)
  expect(cf.calls).toHaveLength(0)
})

test('8 networks accepted', async () => {
  const env = await makeEnv(), cf = fakeCf()
  const nets = Array.from({ length: 8 }, (_, i) => ({ ip: `10.0.0.${i + 1}`, label: `N${i}` }))
  const res = await handle(post('/api/ip', { networks: nets }, basic('abc123', 's3cret')), env, cf)
  expect(res.status).toBe(204)
  // Verify all 8 records: id., id-2., id-3., ..., id-8.
  expect(cf.calls.some((c) => c.body?.name === 'abc123.taskfrce.jmolabs.dev')).toBe(true)
  expect(cf.calls.some((c) => c.body?.name === 'abc123-2.taskfrce.jmolabs.dev')).toBe(true)
  expect(cf.calls.some((c) => c.body?.name === 'abc123-8.taskfrce.jmolabs.dev')).toBe(true)
})
