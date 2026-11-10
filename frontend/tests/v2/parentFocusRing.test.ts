import { expect, test } from '@jest/globals'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const dir = join(__dirname, '../../src/v2')
const read = (f: string) => readFileSync(join(dir, f), 'utf8')
const rules = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '').match(/[^{}]+\{[^{}]*\}/g) ?? []
const RING = /outline:\s*2px solid var\(--p-focus[^;]*;[^}]*outline-offset:\s*2px/

test('parent inputs use the one focus ring, no lime shadow', () => {
  const r = rules(read('parent/motion.css'))
  expect(r.filter((x) => /(input|textarea|select):focus\b/.test(x) && /box-shadow/.test(x))).toEqual([])
  const fv = r.find((x) => /input:focus-visible/.test(x))
  expect(fv).toMatch(RING)
  expect(fv).toMatch(/border-color:\s*var\(--p-ink\)/)
})

test('.f-input focus uses the one ring', () => {
  const r = rules(read('parent/controls.css')).filter((x) => /\.f-input[^{]*:focus/.test(x))
  expect(r.length).toBeGreaterThan(0)
  r.forEach((x) => expect(x).not.toMatch(/--p-acc/))
  expect(r.some((x) => RING.test(x))).toBe(true)
})

test('no parent CSS draws a lime focus shadow', () => {
  const files = readdirSync(join(dir, 'parent')).filter((f) => f.endsWith('.css'))
  const bad = files.flatMap((f) => rules(read(`parent/${f}`)).filter((x) => /:focus/.test(x.split('{')[0]) && /box-shadow:[^;]*--p-acc/.test(x)).map((x) => `${f}: ${x.trim()}`))
  expect(bad).toEqual([])
})

test('global currentColor ring does not reach the parent look', () => {
  const rule = rules(read('interactions.css')).find((x) => /outline:\s*2px solid currentColor/.test(x))!
  expect(rule.split('{')[0]).toMatch(/:where\(|:not\(\[data-look='parent'\]/)
})

test('parent links get rounded focus outlines', () => {
  const files = readdirSync(join(dir, 'parent')).filter((f) => f.endsWith('.css'))
  const ok = files.some((f) => rules(read(`parent/${f}`)).some((x) => /(\ba\b|a\[href\]|\.p-link)[^{]*:focus-visible/.test(x.split('{')[0]) && /border-radius/.test(x)))
  expect(ok).toBe(true)
})

test('switches show one outline and no box-shadow ring', () => {
  const c = rules(read('parent/controls.css')).find((x) => /\.f-switch/.test(x) && /:focus-visible/.test(x))!
  expect(c).toMatch(RING)
  expect(c).not.toMatch(/box-shadow/)
  const m = rules(read('parent/parent-manage.css')).find((x) => /role='switch'/.test(x) && /:focus-visible/.test(x))!
  expect(m).toMatch(RING)
  expect(m).not.toMatch(/box-shadow/)
})

test('regression: safety net stays at 0,1,0', () => {
  expect(read('parent/buttons.css')).toMatch(/:where\(\[data-look='parent'\] :is\(button, a\[href\][^)]*\)\):focus-visible \{ outline: 2px solid var\(--p-focus/)
})

test('regression: wizard top bar keeps its lime ring', () => {
  const w = readdirSync(dir, { recursive: true }).map(String).find((f) => f.endsWith('wizard.module.css'))!
  expect(read(w)).toMatch(/\.st:focus-visible \{\s*outline: 2px solid var\(--p-acc\)/)
})
