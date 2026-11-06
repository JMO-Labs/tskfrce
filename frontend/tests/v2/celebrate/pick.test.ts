import { describe, expect, test } from '@jest/globals'
import { LEGENDARY_ODDS, comboKey, pickCombo, seeded, type Combo } from '@/v2/kid/celebrate/pick'
import { WORDS, fitWordSize, wordWidth } from '@/v2/kid/celebrate/words'

const opts = { mascots: ['trex', 'dog'], wantMascot: false }

describe('pickCombo', () => {
  test('never repeats the last combination exactly, even with a stuck RNG', () => {
    const stuck = () => 0.5
    let last: Combo | null = null
    for (let i = 0; i < 20; i++) {
      const c = pickCombo(stuck, last, opts)
      if (last) expect(comboKey(c)).not.toBe(comboKey(last))
      last = c
    }
  })

  test('no exact repeat across a long seeded run', () => {
    const rng = seeded(42)
    let last: Combo | null = null
    for (let i = 0; i < 2000; i++) {
      const c = pickCombo(rng, last, opts)
      if (last) expect(comboKey(c)).not.toBe(comboKey(last))
      last = c
    }
  })

  test('legendary when the first draw is under the odds, never otherwise', () => {
    expect(pickCombo(() => LEGENDARY_ODDS - 0.001, null, opts).legendary).not.toBeNull()
    expect(pickCombo(() => LEGENDARY_ODDS + 0.001, null, opts).legendary).toBeNull()
  })

  test('about 1 in 25 are legendary', () => {
    const rng = seeded(7)
    let n = 0
    let last: Combo | null = null
    for (let i = 0; i < 10000; i++) {
      last = pickCombo(rng, last, opts)
      if (last.legendary) n++
    }
    expect(n / 10000).toBeGreaterThan(0.03)
    expect(n / 10000).toBeLessThan(0.05)
  })

  test('forced mascot always gets one', () => {
    const rng = seeded(3)
    for (let i = 0; i < 50; i++) expect(pickCombo(rng, null, { ...opts, forceMascot: true }).mascot).not.toBeNull()
  })
})

describe('words', () => {
  test('at least 12 words including the comic staples', () => {
    expect(WORDS.length).toBeGreaterThanOrEqual(12)
    for (const w of ['POW', 'BAM', 'ZAP', 'BOOM', 'KAPOW', 'WHAM', 'WOW', 'AWESOME', 'COOL', 'ROAR-SOME', 'GROOVY', 'ACHOO'])
      expect(WORDS.some((x) => x.replace(/!$/, '') === w)).toBe(true)
  })

  test('short words keep the base size', () => {
    expect(fitWordSize('POW!', 390, 50)).toBe(50)
  })

  test.each([320, 360, 390])('every word fits a %ipx screen', (w) => {
    for (const word of [...WORDS, 'DANCE PARTY!', 'LEGENDARY!']) {
      const size = fitWordSize(word, w * 0.9, 64)
      expect(wordWidth(word, size)).toBeLessThanOrEqual(w * 0.9)
    }
  })

  test('never below the minimum', () => {
    expect(fitWordSize('SUPERCALIFRAGILISTIC!', 100, 50, 18)).toBe(18)
  })
})
