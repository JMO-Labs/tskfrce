import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const src = join(__dirname, '../../src')
const read = (p: string) => readFileSync(join(src, p), 'utf8')
const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : n.endsWith('.css') ? [join(d, n)] : []))

test('phone touch rules are loaded last of the parent sheets', () => {
  const app = readFileSync(join(__dirname, '../../pages/_app.tsx'), 'utf8')
  expect(app.indexOf('parent/touch.css')).toBeGreaterThan(app.indexOf('parent/family-focus.css'))
  const css = read('v2/parent/touch.css')
  expect(css).toMatch(/@media \(max-width: 767px\)/)
  for (const sel of ['.p-btn:not(.p-ib)', '.p-segmented-button', '.f-btn.f-btn', 'button.p-arow-ty::after']) expect(css).toContain(sel)
})

test('one focus ring colour: --p-focus is set in light and dark and no parent rule hard-codes ink', () => {
  const tokens = read('v2/parent/parent-tokens.css')
  expect(tokens.match(/--p-focus:/g)).toHaveLength(2)
  // .st (wizard sidebar, dark in both themes) keeps its lime ring on a separate line, so a line check never sees it
  const offenders = walk(join(src, 'v2')).flatMap((f) => readFileSync(f, 'utf8').split('\n').filter((l) => /focus/.test(l) && /outline(-color)?: [^;]*var\(--p-(ink|acc)/.test(l)).map((l) => `${f}: ${l.trim()}`))
  expect(offenders).toEqual([])
})
