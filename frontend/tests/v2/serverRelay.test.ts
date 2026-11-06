/**
 * @jest-environment node
 *
 * Boots the real custom server (server.js + Next) against a fake backend. Next injects
 * x-forwarded-* into req.headers itself, so "relayed" must be judged from the wire.
 */
import { describe, it, expect, beforeAll, afterAll } from '@jest/globals'
import { spawn, ChildProcess } from 'child_process'
import http from 'http'
import { AddressInfo } from 'net'
import path from 'path'

const URL_PATH = '/api/proxy/integration-local/push'
let child: ChildProcess
let backend: http.Server
let port = 0
const seen: http.IncomingHttpHeaders[] = []

function freePort(): Promise<number> {
  return new Promise((ok) => {
    const s = http.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as AddressInfo).port
      s.close(() => ok(p))
    })
  })
}

function post(headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((ok, fail) => {
    const r = http.request(
      { host: '127.0.0.1', port, path: URL_PATH, method: 'POST',
        headers: { 'content-type': 'application/json', authorization: 'Bearer tsk_local_x', ...headers } },
      (res) => {
        let body = ''
        res.on('data', (c) => (body += c))
        res.on('end', () => ok({ status: res.statusCode || 0, body }))
      })
    r.on('error', fail)
    r.end('{"actions":[]}')
  })
}

beforeAll(async () => {
  backend = http.createServer((req, res) => {
    seen.push(req.headers)
    res.setHeader('content-type', 'application/json')
    res.end('{"results":[]}')
  })
  await new Promise<void>((ok) => backend.listen(0, '127.0.0.1', () => ok()))
  port = await freePort()
  child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '../..'),
    env: { ...process.env, NODE_ENV: 'development', PORT: String(port),
      BACKEND_INTERNAL_URL: `http://127.0.0.1:${(backend.address() as AddressInfo).port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  await new Promise<void>((ok, fail) => {
    child.stdout!.on('data', (d) => { if (String(d).includes('> Ready on')) ok() })
    child.on('exit', (c) => fail(new Error(`server exited ${c}`)))
  })
  await post({}) // warm up: dev compiles the route on first hit
}, 180000)

afterAll(async () => {
  child?.kill('SIGKILL')
  await new Promise<void>((ok) => backend.close(() => ok()))
})

describe('real server relay guard', () => {
  it('lets a plain LAN push through to the backend', async () => {
    seen.length = 0
    const r = await post({})
    expect(r.status).toBe(200)
    expect(seen).toHaveLength(1)
    expect(seen[0]['x-real-ip']).toBe('127.0.0.1')
    expect(seen[0]['x-tsk-relayed']).toBeUndefined()
  }, 60000)

  it.each([['X-Forwarded-For', '192.168.1.5'], ['x-real-ip', '192.168.1.5'], ['X-Edge-Token', ''],
    ['CF-Ray', 'abc'], ['forwarded', 'for=1.2.3.4']])(
    'refuses the push when %s is on the wire', async (k, v) => {
      seen.length = 0
      const r = await post({ [k]: v })
      expect(r.status).toBe(404)
      expect(seen).toHaveLength(0)
    }, 60000)

  it('ignores a client-sent marker claiming not relayed', async () => {
    seen.length = 0
    const r = await post({ 'x-tsk-relayed': '0', 'x-forwarded-for': '1.2.3.4' })
    expect(r.status).toBe(404)
    expect(seen).toHaveLength(0)
  }, 60000)
})
