import fs from 'fs'
import path from 'path'

const pub = path.join(__dirname, '../../public')
const read = (f: string) => JSON.parse(fs.readFileSync(path.join(pub, f), 'utf8'))
const cfg = require('../../next.config.js')

describe('web manifests', () => {
  const parent = read('manifest.webmanifest')
  const kid = read('kid.webmanifest')

  it('start at / and /kid with distinct ids', () => {
    expect(parent.start_url).toBe('/')
    expect(kid.start_url).toBe('/kid')
    expect(parent.id).not.toBe(kid.id)
    expect(parent.scope).toBe('/')
    expect(kid.display).toBe('standalone')
  })

  it.each([parent, kid])('has real icons of the declared size, one maskable', (m) => {
    expect(m.icons.filter((i: any) => i.purpose === 'maskable')).toHaveLength(1)
    for (const i of m.icons) {
      const buf = fs.readFileSync(path.join(pub, i.src))
      expect(`${buf.readUInt32BE(16)}x${buf.readUInt32BE(20)}`).toBe(i.sizes)
    }
  })

  it('apple-touch-icon is 180x180', () => {
    const buf = fs.readFileSync(path.join(pub, 'icons/apple-touch-icon.png'))
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([180, 180])
  })
})

// public/ is copied into the standalone image and served as is, so these files and headers are what ships
describe('served shell', () => {
  it('ships sw.js and offline.html', () => {
    for (const f of ['sw.js', 'offline.html']) expect(fs.existsSync(path.join(pub, f))).toBe(true)
  })
  it('sets worker and manifest headers', async () => {
    const rules = await cfg.headers()
    const get = (src: string) => rules.find((r: any) => r.source === src)?.headers[0]
    expect(get('/sw.js')).toEqual({ key: 'Cache-Control', value: 'no-cache' })
    expect(get('/:file*.webmanifest')).toEqual({ key: 'Content-Type', value: 'application/manifest+json' })
  })
})
