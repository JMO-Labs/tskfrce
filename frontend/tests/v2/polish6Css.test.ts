import { describe, expect, test } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(__dirname, '../../src/v2', p), 'utf8')
/** Body of the first rule whose selector contains `sel` (inside `scope` when given). */
const rule = (css: string, sel: string) => {
  const i = css.indexOf(sel)
  if (i < 0) return ''
  return css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i))
}
const phone = (css: string) => css.slice(css.indexOf('@media (max-width: 767px)'))

describe('audit 20: phone devices list header band', () => {
  const css = phone(read('parent/responsive.css'))
  const band = rule(css, ".p-list-header[data-list='devices']")

  test('smaller top padding, no gap for the hidden title row, no divider', () => {
    expect(band).toMatch(/padding-top:\s*8px/)
    expect(band).toMatch(/gap:\s*0/)
    expect(band).toMatch(/border-bottom:\s*0/)
  })

  test('the generic list header is untouched', () => {
    expect(rule(read('parent/layout.css'), '.p-list-header {')).toMatch(/padding:\s*16px 12px/)
  })

  test('the dead .p-group-stack rules are gone', () => {
    expect(read('parent/parent-devices.css')).not.toContain('.p-group-stack')
  })
})
