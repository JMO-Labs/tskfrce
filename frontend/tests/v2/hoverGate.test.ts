import fs from 'fs'
import path from 'path'

const ROOT = path.join(__dirname, '../../src/v2')
const files = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === 'kid' ? [] : files(path.join(dir, e.name))) : e.name.endsWith('.css') ? [path.join(dir, e.name)] : []))

/** The CSS with every `@media (hover: hover) { ... }` block cut out. */
function withoutHoverBlocks(css: string): string {
  let out = ''
  let i = 0
  const start = '@media (hover: hover)'
  while (i < css.length) {
    const at = css.indexOf(start, i)
    if (at < 0) return out + css.slice(i)
    out += css.slice(i, at)
    let j = css.indexOf('{', at) + 1
    for (let depth = 1; depth > 0; j++) depth += css[j] === '{' ? 1 : css[j] === '}' ? -1 : 0
    i = j
  }
  return out
}

describe('hover styles', () => {
  test('parent, setup and shared CSS only apply :hover on devices that can hover', () => {
    const bad = files(ROOT).flatMap((f) =>
      withoutHoverBlocks(fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ''))
        .split('\n')
        .filter((l) => l.includes(':hover'))
        .map((l) => `${path.relative(ROOT, f)}: ${l.trim().slice(0, 80)}`),
    )
    expect(bad).toEqual([])
  })

  test('pressed state: every tappable button and link gets a visible press', () => {
    const css = fs.readFileSync(path.join(ROOT, 'interactions.css'), 'utf8')
    expect(css).toMatch(/:active\s*\{[^}]*background-image: linear-gradient\(var\(--press-tint\)/)
    expect(css).toMatch(/:active\s*\{[^}]*transform: translateY\(1px\)/)
  })
})
