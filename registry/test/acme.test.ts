import { describe, expect, test } from 'vitest'
import { handle } from '../src/index'
import { deleteRecord } from '../src/cf'
import { basic, fakeCf, makeEnv } from './helpers'

const req = (path: string, fqdn: string, value: string, auth = basic('abc123', 's3cret')) =>
  new Request('https://x' + path, { method: 'POST', headers: { Authorization: auth }, body: JSON.stringify({ fqdn, value }) })
const OWN = '_acme-challenge.abc123.taskfrce.jmolabs.dev.'

describe('acme present', () => {
  test('own name creates TXT via POST (never PUT)', async () => {
    const cf = fakeCf([{ id: 'r0', content: 'old' }])
    const res = await handle(req('/api/acme/present', OWN, 'tok1'), await makeEnv(), cf)
    expect(res.status).toBe(200)
    const writes = cf.calls.filter((c) => c.method !== 'GET')
    expect(writes).toHaveLength(1)
    expect(writes[0].method).toBe('POST')
    expect(writes[0].body).toMatchObject({ type: 'TXT', name: OWN.slice(0, -1), content: 'tok1' })
  })
  test.each([
    '_acme-challenge.zzz999.taskfrce.jmolabs.dev.',
    '_acme-challenge.jmolabs.dev.',
    '_acme-challenge.abc123.evil.dev.',
    'abc123.taskfrce.jmolabs.dev.',
  ])('out-of-scope %s -> 403, no CF call', async (fqdn) => {
    const cf = fakeCf()
    const res = await handle(req('/api/acme/present', fqdn, 't'), await makeEnv(), cf)
    expect(res.status).toBe(403)
    expect(cf.calls).toHaveLength(0)
  })
  test('uppercase own fqdn -> 200', async () => {
    const res = await handle(req('/api/acme/present', OWN.toUpperCase(), 't'), await makeEnv(), fakeCf())
    expect(res.status).toBe(200)
  })
  test('bad auth -> 401', async () => {
    const cf = fakeCf()
    const res = await handle(req('/api/acme/present', OWN, 't', basic('abc123', 'nope')), await makeEnv(), cf)
    expect(res.status).toBe(401)
    expect(cf.calls).toHaveLength(0)
  })
  test('bad body -> 400', async () => {
    const r = new Request('https://x/api/acme/present', { method: 'POST', headers: { Authorization: basic('abc123', 's3cret') }, body: '{}' })
    expect((await handle(r, await makeEnv(), fakeCf())).status).toBe(400)
  })
})

describe('acme cleanup', () => {
  test('deletes only the matching TXT', async () => {
    const cf = fakeCf([{ id: 'r1', content: 'keep' }, { id: 'r2', content: 'tok1' }])
    const res = await handle(req('/api/acme/cleanup', OWN, 'tok1'), await makeEnv(), cf)
    expect(res.status).toBe(200)
    const dels = cf.calls.filter((c) => c.method === 'DELETE')
    expect(dels.map((d) => d.url.split('/').pop())).toEqual(['r2'])
  })
  test('matches quoted content, deletes only that record', async () => {
    const cf = fakeCf([{ id: 'r1', content: '"tok1"' }, { id: 'r2', content: 'tok2' }])
    const res = await handle(req('/api/acme/cleanup', OWN, 'tok1'), await makeEnv(), cf)
    expect(res.status).toBe(200)
    expect(cf.calls.filter((c) => c.method === 'DELETE').map((d) => d.url.split('/').pop())).toEqual(['r1'])
  })
  test('no match -> no DELETE, 200', async () => {
    const cf = fakeCf([{ id: 'r1', content: 'a' }])
    const res = await handle(req('/api/acme/cleanup', OWN, 'zzz'), await makeEnv(), cf)
    expect(res.status).toBe(200)
    expect(cf.calls.some((c) => c.method === 'DELETE')).toBe(false)
  })
  test('other box -> 403, no CF call', async () => {
    const cf = fakeCf()
    const res = await handle(req('/api/acme/cleanup', '_acme-challenge.zzz999.taskfrce.jmolabs.dev.', 't'), await makeEnv(), cf)
    expect(res.status).toBe(403)
    expect(cf.calls).toHaveLength(0)
  })
  test('bad auth -> 401', async () => {
    const res = await handle(req('/api/acme/cleanup', OWN, 't', 'Basic xx'), await makeEnv(), fakeCf())
    expect(res.status).toBe(401)
  })
})

test('deleteRecord out-of-scope throws without CF call', async () => {
  const cf = fakeCf()
  await expect(deleteRecord(await makeEnv(), cf, 'TXT', 'jmolabs.dev', 'x')).rejects.toThrow()
  expect(cf.calls).toHaveLength(0)
})

describe('acme SAN challenges', () => {
  test('own SAN name (_acme-challenge.abc123-2) allowed', async () => {
    const cf = fakeCf()
    const sanName = '_acme-challenge.abc123-2.taskfrce.jmolabs.dev.'
    const res = await handle(req('/api/acme/present', sanName, 'tok'), await makeEnv(), cf)
    expect(res.status).toBe(200)
    expect(cf.calls.filter((c) => c.method === 'POST').some((c) => c.body.name === sanName.slice(0, -1))).toBe(true)
  })

  test('SAN names 2-8 allowed', async () => {
    for (let i = 2; i <= 8; i++) {
      const sanName = `_acme-challenge.abc123-${i}.taskfrce.jmolabs.dev.`
      const cf = fakeCf()
      const res = await handle(req('/api/acme/present', sanName, 'tok'), await makeEnv(), cf)
      expect(res.status).toBe(200)
    }
  })

  test('box A cannot present for box B SAN', async () => {
    const cf = fakeCf()
    // box abc123 tries to present for zzz999-2
    const badName = '_acme-challenge.zzz999-2.taskfrce.jmolabs.dev.'
    const res = await handle(req('/api/acme/present', badName, 'tok'), await makeEnv(), cf)
    expect(res.status).toBe(403)
    expect(cf.calls).toHaveLength(0)
  })
})
