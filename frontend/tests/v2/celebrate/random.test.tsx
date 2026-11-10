import { describe, expect, test } from '@jest/globals'
import { render } from '@testing-library/react'
import { MASCOTS, mascotsFor, OWNER_MASCOTS } from '@/v2/kid/celebrate/catalog'
import { Burst } from '@/v2/kid/celebrate/Effects'
import { ENTRIES, STYLES, comboKey, pickCombo, pickStyle, seeded, type Combo } from '@/v2/kid/celebrate/pick'

const opts = { mascots: mascotsFor(1, new Date('2026-06-01')), wantMascot: true, forceMascot: true }

describe('random cast, styles, entries and fireworks', () => {
  test('the six owner mascots are unlocked at level 1, with their own bubble words', () => {
    expect(OWNER_MASCOTS).toEqual(['trex', 'lizard', 'dog-cowboy', 'axolotl', 'cat-princess', 'sloth'])
    for (const id of OWNER_MASCOTS) expect(mascotsFor(1, new Date('2026-06-01'))).toContain(id)
    const says = Object.fromEntries(MASCOTS.filter((m) => m.says).map((m) => [m.id, m.says]))
    expect(says).toEqual({ trex: 'ROAR-SOME!', lizard: '¡OLÉ!', 'dog-cowboy': 'YEEHAW!', axolotl: 'SQUEE!', 'cat-princess': 'FABULOUS!', sloth: 'CHILL!' })
  })

  test('Noto animals keep their level unlocks', () => {
    expect(mascotsFor(1, new Date('2026-06-01'))).not.toContain('unicorn')
    expect(mascotsFor(8, new Date('2026-06-01'))).toContain('unicorn')
  })

  test('style pick is weighted: original about 40%, the rest share 60%', () => {
    expect(pickStyle(() => 0.39)).toBe('original')
    expect(pickStyle(() => 0.41)).not.toBe('original')
    const rng = seeded(21)
    const n: Record<string, number> = {}
    for (let i = 0; i < 20000; i++) {
      const s = pickStyle(rng)
      n[s] = (n[s] ?? 0) + 1
    }
    expect(n.original / 20000).toBeGreaterThan(0.37)
    expect(n.original / 20000).toBeLessThan(0.43)
    for (const s of STYLES.filter((x) => x !== 'original')) expect(n[s] / 20000).toBeGreaterThan(0.06)
  })

  test('every style, entry, burst and owner mascot is reachable', () => {
    const rng = seeded(8)
    const seen = { style: new Set<string>(), entry: new Set<string>(), burst: new Set<string>(), mascot: new Set<string>(), say: new Set<string>() }
    let last: Combo | null = null
    for (let i = 0; i < 3000; i++) {
      last = pickCombo(rng, last, opts)
      if (last.legendary) continue
      seen.style.add(last.style)
      seen.entry.add(last.entry)
      seen.burst.add(last.burst)
      seen.mascot.add(last.mascot!)
      seen.say.add(last.say)
    }
    expect([...seen.style].sort()).toEqual([...STYLES].sort())
    expect([...seen.entry].sort()).toEqual([...ENTRIES].sort())
    expect(seen.burst).toContain('fireworks')
    for (const id of ['trex', 'lizard', 'dog-cowboy', 'axolotl', 'cat-princess', 'sloth']) expect(seen.mascot).toContain(id)
    expect(seen.say).toContain('YEEHAW!')
    expect(seen.say).toContain('WOW!') // generic words still mix in
  })

  test('fireworks get 3 to 5 bursts and render them', () => {
    const rng = seeded(5)
    let c: Combo | null = null
    for (let i = 0; i < 500 && c?.burst !== 'fireworks'; i++) c = pickCombo(rng, c, opts)
    expect(c!.burst).toBe('fireworks')
    expect(c!.sparks.length).toBeGreaterThanOrEqual(3)
    expect(c!.sparks.length).toBeLessThanOrEqual(5)
    const { container } = render(<Burst fx="fireworks" sparks={c!.sparks} />)
    expect(container.querySelectorAll('[data-burst="fireworks"] [data-spark]')).toHaveLength(c!.sparks.length)
  })

  test('the no-repeat key covers the whole combination', () => {
    const a = pickCombo(seeded(1), null, opts)
    const other = { ...a, legendary: null }
    for (const [k, v] of [['mascot', 'zz'], ['style', 'zz'], ['entry', 'zz'], ['burst', 'zz'], ['word', 'zz'], ['card', 'zz']] as const)
      expect(comboKey({ ...other, [k]: v } as Combo)).not.toBe(comboKey(other))
  })

  test('a stuck RNG never repeats the full combination', () => {
    let last: Combo | null = null
    for (let i = 0; i < 30; i++) {
      const c = pickCombo(() => 0.7, last, opts)
      if (last) expect(comboKey(c)).not.toBe(comboKey(last))
      last = c
    }
  })
})
