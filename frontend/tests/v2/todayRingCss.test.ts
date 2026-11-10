import { expect, test } from '@jest/globals'
import { readFileSync } from 'fs'
import { join } from 'path'
const read = (f: string) => readFileSync(join(__dirname, '../../src/v2/parent', f), 'utf8')

test('desktop kid ring is not shrunk', () => {
  expect(read('today-focus.css')).not.toMatch(/\.pt-kmain \.p-ring svg\s*\{[^}]*width:\s*2\dpx/)
  expect(read('declutter.css')).toMatch(/\.p-ring svg\s*\{[^}]*width:\s*30px/)
})

test('menu info lines are muted, small, and have no hover', () => {
  const css = read('declutter.css')
  expect(css).toMatch(/\.p-mi-info\s*\{[^}]*color:\s*var\(--p-sub\)[^}]*font-size:\s*12\.5px/)
  expect(css).not.toMatch(/\.p-mi-info:hover/)
})

test('a long kid name ends in an ellipsis instead of running under the ring', () => {
  expect(read('today-focus.css')).toMatch(/\.pt-kname \.p-kn\s*\{[^}]*max-width:\s*100%[^}]*text-overflow:\s*ellipsis/)
})
