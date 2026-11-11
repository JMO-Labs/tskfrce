import { expect, test } from '@jest/globals'
import { seeded } from '@/v2/games/rng'
import { hiddenCount, initMath, limitMs, makeQ, answerQ } from '@/v2/games/mathDash/logic'

const ages = ['little', 'kid', 'teen'] as const

test('questions are valid for every age and tier', () => {
  const rng = seeded(7)
  for (const age of ages) for (let tier = 0; tier < 4; tier++) for (let i = 0; i < 60; i++) {
    const q = makeQ(age, tier, rng)
    expect(q.choices.length).toBe(4)
    expect(new Set(q.choices).size).toBe(4)
    expect(q.choices[q.correct]).toBe(q.answer)
    expect(q.choices.every((c) => Number.isInteger(c) && c >= 0)).toBe(true)
    expect(q.hide.length).toBe(3)
    expect(q.hide.includes(q.correct)).toBe(false)
  }
})

test('little adds within 10; kid uses tables 2-10', () => {
  const rng = seeded(3)
  for (let i = 0; i < 50; i++) expect(makeQ('little', 3, rng).answer).toBeLessThanOrEqual(10)
  for (let i = 0; i < 50; i++) {
    const m = /^(\d+) × (\d+)/.exec(makeQ('kid', 3, rng).text)!
    expect(+m[1]).toBeGreaterThanOrEqual(2); expect(+m[2]).toBeLessThanOrEqual(10)
  }
})

test('right answer scores and builds streak; difficulty rises', () => {
  const rng = seeded(1)
  let st = initMath('kid', 1, rng)
  expect(st.tier).toBe(0)
  for (let i = 0; i < 3; i++) st = answerQ(st, st.q.correct, 'kid', [], rng)
  expect(st.score).toBe(3); expect(st.streak).toBe(3); expect(st.tier).toBe(1)
})

test('wrong answer resets streak; streak_saver forgives the first miss only', () => {
  const rng = seeded(1)
  const wrong = (s: ReturnType<typeof initMath>) => (s.q.correct + 1) % 4
  let st = initMath('kid', 1, rng)
  st = answerQ(st, st.q.correct, 'kid', [], rng)
  st = answerQ(st, wrong(st), 'kid', [], rng)
  expect(st.score).toBe(1); expect(st.streak).toBe(0)
  st = initMath('kid', 1, rng)
  st = answerQ(st, st.q.correct, 'kid', ['streak_saver'], rng)
  st = answerQ(st, wrong(st), 'kid', ['streak_saver'], rng)
  expect(st.streak).toBe(1)
  st = answerQ(st, wrong(st), 'kid', ['streak_saver'], rng)
  expect(st.streak).toBe(0)
})

test('limit and hidden counts', () => {
  expect(limitMs([], null)).toBe(60000)
  expect(limitMs(['extra_time'], null)).toBe(69000)
  expect(limitMs([], 'freeze')).toBe(70000)
  expect(hiddenCount(0, ['hint'], null)).toBe(1)
  expect(hiddenCount(5, ['hint'], null)).toBe(0)
  expect(hiddenCount(2, [], 'fifty')).toBe(2)
  expect(hiddenCount(3, [], 'fifty')).toBe(0)
  expect(hiddenCount(0, ['hint'], 'fifty')).toBe(3)
})
