import { expect, test } from '@jest/globals'
import { initCat, stepCat, type CatState } from '@/v2/games/hungryCat/logic'
import { seeded } from '@/v2/games/rng'

const item = (kind: 'food' | 'sock', x = 0.5, y = 0.89) => ({ id: 1, x, y, kind, emoji: kind === 'food' ? '🐟' : '🧦' })
const withItems = (kind: 'food' | 'sock', n = 1): CatState => {
  const s = initCat(1, seeded(1))
  return { ...s, spawnIn: 99999, items: Array.from({ length: n }, (_, i) => ({ ...item(kind), id: i })) }
}

test('init: full hearts, empty field', () => {
  const s = initCat(1, seeded(1))
  expect(s).toMatchObject({ t: 0, catX: 0.5, score: 0, hearts: 3, over: false, items: [] })
})

test('catching food raises score and removes it', () => {
  const s = stepCat(withItems('food'), 100, 0.5, 1, seeded(1))
  expect(s.score).toBe(1)
  expect(s.items).toHaveLength(0)
  expect(s.hearts).toBe(3)
})

test('food far from the cat is missed, not caught', () => {
  const s = stepCat(withItems('food'), 100, 0.9, 1, seeded(1))
  expect(s.score).toBe(0)
  expect(s.items).toHaveLength(1)
})

test('a sock costs a heart; 3 socks end the game', () => {
  let s = stepCat(withItems('sock'), 100, 0.5, 1, seeded(1))
  expect(s.hearts).toBe(2)
  expect(s.over).toBe(false)
  s = stepCat(withItems('sock', 3), 100, 0.5, 1, seeded(1))
  expect(s.hearts).toBe(0)
  expect(s.over).toBe(true)
})

test('60 s ends the game; stepping after over is a no-op', () => {
  let s = initCat(1, seeded(1))
  s = stepCat({ ...s, t: 59_950 }, 100, 0.5, 1, seeded(1))
  expect(s.over).toBe(true)
  expect(stepCat(s, 100, 0.5, 1, seeded(1))).toBe(s)
})

test('items fall at the documented speed', () => {
  const s = { ...initCat(1, seeded(1)), spawnIn: 99999, items: [item('food', 0.1, 0)] }
  const n = stepCat(s, 1000, 0.5, 1, seeded(1))
  expect(n.items[0].y).toBeCloseTo(0.4158, 3)
})

test('spawning is deterministic with a seeded rng', () => {
  const run = () => {
    const rng = seeded(1)
    let s = initCat(2, rng)
    for (let i = 0; i < 100; i++) s = stepCat(s, 16, 0.5, 2, rng)
    return s
  }
  const a = run()
  expect(a.items.length + a.score + (3 - a.hearts)).toBeGreaterThan(0)
  expect(run()).toEqual(a)
})

test('spawns are food or sock emoji, x within the field', () => {
  const rng = seeded(7)
  let s = initCat(1, rng)
  const seen = new Set<string>()
  for (let i = 0; i < 2000 && !s.over; i++) {
    s = stepCat(s, 16, 0.5, 1, rng)
    s.items.forEach((it) => { seen.add(it.emoji); expect(it.x).toBeGreaterThanOrEqual(0.05); expect(it.x).toBeLessThanOrEqual(0.95) })
  }
  expect(seen.has('🧦')).toBe(true)
  expect([...seen].some((e) => '🐟🍗🧀'.includes(e))).toBe(true)
})
