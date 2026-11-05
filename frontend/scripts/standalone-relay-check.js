// Proves the local-push relay guard on the production artifact: runs .next/standalone/server.js
// the way the Docker runtime image does (node -r ./relay-preload.js server.js) against a fake
// backend. Run via `npm run test:standalone` (builds first). Exits non-zero on any failure.
const { spawn } = require('child_process')
const fs = require('fs')
const http = require('http')
const path = require('path')
const assert = require('assert')

const root = path.join(__dirname, '..')
const standalone = path.join(root, '.next/standalone')
const PUSH = '/api/proxy/integration-local/push'
const seen = []

function listen(server) {
  return new Promise((ok) => server.listen(0, '127.0.0.1', () => ok(server.address().port)))
}

function request(port, p, headers = {}) {
  return new Promise((ok, fail) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method: p === PUSH ? 'POST' : 'GET',
      headers: { 'content-type': 'application/json', authorization: 'Bearer tsk_local_x', ...headers } },
    (res) => { res.resume(); res.on('end', () => ok(res.statusCode)) })
    r.on('error', fail)
    r.end(p === PUSH ? '{"actions":[]}' : undefined)
  })
}

async function main() {
  assert(fs.existsSync(path.join(standalone, 'server.js')), 'run `next build` first')
  // Same files the Dockerfile runtime stage copies next to the standalone server.
  for (const f of ['relay-preload.js', 'clientIp.js']) fs.copyFileSync(path.join(root, f), path.join(standalone, f))

  const backend = http.createServer((req, res) => {
    seen.push(req.headers)
    res.setHeader('content-type', 'application/json')
    res.end('{"results":[]}')
  })
  const backendPort = await listen(backend)
  const probe = http.createServer()
  const port = await listen(probe)
  await new Promise((ok) => probe.close(ok))

  const child = spawn(process.execPath, ['-r', './relay-preload.js', 'server.js'], {
    cwd: standalone,
    env: { ...process.env, PORT: String(port), HOSTNAME: '127.0.0.1',
      BACKEND_INTERNAL_URL: `http://127.0.0.1:${backendPort}` },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  try {
    await new Promise((ok, fail) => {
      child.stdout.on('data', (d) => { if (/Ready in|ready/i.test(String(d))) ok() })
      child.on('exit', (c) => fail(new Error(`standalone server exited ${c}`)))
      setTimeout(() => fail(new Error('standalone server did not start')), 60000)
    })

    const cases = [
      ['plain LAN push', {}, 200],
      ['wire X-Forwarded-For', { 'X-Forwarded-For': '192.168.1.5' }, 404],
      ['wire X-Real-IP', { 'X-Real-IP': '192.168.1.5' }, 404],
      ['wire X-Edge-Token (empty)', { 'X-Edge-Token': '' }, 404],
      ['wire x-forwarded-host', { 'x-forwarded-host': 'box' }, 404],
      ['wire x-forwarded-proto', { 'X-Forwarded-Proto': 'https' }, 404],
      ['wire CF-Connecting-IP', { 'CF-Connecting-IP': '203.0.113.9' }, 404],
      ['spoofed marker + XFF', { 'x-tsk-relayed': '0', 'X-Forwarded-For': '1.2.3.4' }, 404],
    ]
    let failed = 0
    for (const [name, headers, want] of cases) {
      seen.length = 0
      const got = await request(port, PUSH, headers)
      const reached = seen.length === 1
      const ok = got === want && reached === (want === 200)
      if (!ok) failed++
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: status ${got}, backend ${reached ? 'reached' : 'not reached'}`)
    }
    const health = await request(port, '/api/health')
    console.log(`${health === 200 ? 'ok  ' : 'FAIL'} /api/health: ${health}`)
    if (health !== 200) failed++
    if (failed) throw new Error(`${failed} check(s) failed`)
    console.log('standalone relay guard: all checks passed')
  } finally {
    child.kill('SIGKILL')
    backend.close()
  }
}

main().catch((e) => { console.error(e.message); process.exit(1) })
