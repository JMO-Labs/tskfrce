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

describe('audit 27: inbox page "Notification settings" link sits ~33px under the list on phone', () => {
  const css = read('components/bell.css')
  const ph = css.slice(css.indexOf('/* inbox page, phone: settings link'))

  test('phone page mode drops the scroll bottom padding and pulls the link up 11px (50px -> ~33px)', () => {
    expect(ph).toMatch(/@media \(max-width: 767px\)/)
    expect(rule(ph, '.p-bell-list[data-page] .p-bell-scroll')).toMatch(/padding-bottom:\s*0/)
    expect(rule(ph, '.p-bell-list[data-page] .p-bell-setl')).toMatch(/margin-top:\s*-5px/)
  })

  test('the phone 44px tap height on the link stays', () => {
    expect(css).toMatch(/@media \(max-width: 767px\)[^\n]*\.p-bell-setl \{ min-height: 44px; \}/)
    expect(css).toMatch(/\.p-bell-setl, \[data-look='parent'\] a\.p-bell-setl \{[^}]*margin-top: 6px/)
  })
})
