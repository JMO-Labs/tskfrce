import { expect, test } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'

const read = (p: string) => readFileSync(join(__dirname, '../../../src/v2', p), 'utf8')

test('parent phone shell sets --k-navh to the tab bar height so preview mascots tuck behind it', () => {
  const phone = read('parent/responsive.css').split('@media (max-width: 767px)')[1]
  expect(phone).toMatch(/\[data-look='parent'\] \.p-shell \{[^}]*--k-navh:\s*78px/)
})

test('the celebration word can sit higher; the parent phone preview lifts it off the Preview button', () => {
  expect(read('kid/celebrate/celebrate.module.css')).toMatch(/\.word \{[^}]*top:\s*var\(--cel-word-y, 50%\)/)
  const phone = read('parent/responsive.css').split('@media (max-width: 767px)')[1]
  expect(phone).toMatch(/\[data-look='parent'\] \.p-shell \{[^}]*--cel-word-y:\s*\d+%/)
})
