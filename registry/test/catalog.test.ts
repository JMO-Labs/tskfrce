import { beforeAll, expect, it, vi } from 'vitest'
import { handle } from '../src/index'
import { signEnvelope } from '../src/sign'
import { fakeCf, makeEnv } from './helpers'

const DEMO_MANIFEST = vi.hoisted(() => ({ id: 'demo-int', name: 'Demo', version: '1.0.0' }))
vi.mock('../src/catalog', () => ({ CATALOG: [DEMO_MANIFEST], REVOKED: [] }))

const b64 = (u: Uint8Array) => Buffer.from(u).toString('base64')
let env: Awaited<ReturnType<typeof makeEnv>>
let priv: string
let pub: CryptoKey
let pubRaw: string

async function verify(k: CryptoKey, e: { payload: string; sig: string }) {
  const u = (s: string) => Uint8Array.from(Buffer.from(s, 'base64'))
  return crypto.subtle.verify('Ed25519', k, u(e.sig), u(e.payload))
}

beforeAll(async () => {
  const kp = (await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])) as CryptoKeyPair
  pub = kp.publicKey
  priv = b64(new Uint8Array((await crypto.subtle.exportKey('pkcs8', kp.privateKey)) as ArrayBuffer))
  pubRaw = b64(new Uint8Array((await crypto.subtle.exportKey('raw', pub)) as ArrayBuffer))
  env = await makeEnv('abc123', 's3cret', priv)
})

it('signs the catalog and every manifest', async () => {
  const res = await handle(new Request('https://x/api/integrations/catalog'), env, fakeCf())
  expect(res.status).toBe(200)
  expect(res.headers.get('Cache-Control')).toBe('public, max-age=300')
  const outer = await res.json() as { payload: string; sig: string }
  expect(await verify(pub, outer)).toBe(true)
  const body = JSON.parse(atob(outer.payload))
  expect(body.v).toBe(1); expect(Array.isArray(body.revoked)).toBe(true)
  expect(body.integrations).toHaveLength(1)
  for (const m of body.integrations) expect(await verify(pub, m)).toBe(true)
})
it('503 without a signing key', async () => {
  const res = await handle(new Request('https://x/api/integrations/catalog'), { ...env, INTEGRATIONS_SIGNING_KEY: '' }, fakeCf())
  expect(res.status).toBe(503)
  expect(await res.json()).toEqual({ error: 'catalog unavailable' })
})
it('never lists the example integration', async () => {
  const real = await vi.importActual<typeof import('../src/catalog')>('../src/catalog')
  expect(real.CATALOG.map((m: any) => m.id)).not.toContain('hello-example')
})
it('POST is 405', async () => {
  expect((await handle(new Request('https://x/api/integrations/catalog', { method: 'POST' }), env, fakeCf())).status).toBe(405)
})
it('envelope interop fixture for trust.py (non-ASCII payload)', async () => {
  const envl = await signEnvelope({ v: 1, name: 'café ✓', n: [1, 2] }, priv)
  expect(await verify(pub, envl)).toBe(true)
  // Regenerate the committed fixture (key is discarded): WRITE_FIXTURE=1 npm test -- catalog
  if (process.env.WRITE_FIXTURE) {
    // @ts-expect-error no node types in this package
    const { writeFileSync } = await import('node:fs')
    writeFileSync('test/fixtures/envelope.json', JSON.stringify({ pubkey: pubRaw, envelope: envl }, null, 2) + '\n')
  }
})
