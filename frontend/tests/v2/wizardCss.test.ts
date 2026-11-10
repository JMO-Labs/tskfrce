import { expect, test } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (f: string) => readFileSync(join(__dirname, '../../src/v2/setup', f), 'utf8')
const wizard = read('wizard.module.css')
const cards = read('stepCards.module.css')
const devices = read('devices.module.css')
const rule = (css: string, sel: RegExp) => css.match(new RegExp(sel.source + '\\s*\\{[^}]*\\}'))?.[0] ?? ''

test('footer icons are 14px', () => {
  expect(rule(wizard, /\.foot :global\(\.ms\)/)).toMatch(/font-size:\s*14px/)
})

test('footer is full width', () => {
  const r = rule(wizard, /\.footIn/)
  expect(r).not.toBe('')
  expect(r).not.toMatch(/max-width/)
  expect(r).not.toMatch(/margin-inline:\s*auto/)
})

test('setup labels are the light style', () => {
  const r = rule(wizard, /\.page(\.page)? :global\(\.f-label\.f-label\)/)
  expect(r).toMatch(/font-weight:\s*500/)
  expect(r).toMatch(/color:\s*var\(--p-sub\)/)
})

test('Avatar label matches', () => {
  const r = rule(cards, /\.fldlabel/)
  expect(r).toMatch(/font-weight:\s*500/)
  expect(r).toMatch(/color:\s*var\(--p-sub\)/)
})

test('device sub ellipsizes', () => {
  const r = rule(devices, /\.t2 small/)
  expect(r).toMatch(/white-space:\s*nowrap/)
  expect(r).toMatch(/overflow:\s*hidden/)
  expect(r).toMatch(/text-overflow:\s*ellipsis/)
  expect(r).not.toMatch(/overflow-wrap:\s*anywhere/)
})
