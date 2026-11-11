import { expect, test } from '@jest/globals'
import { seeded } from '@/v2/games/rng'
import { clockMs, isRight, itemCount, lookMs, newRound } from '@/v2/games/shelfMemory/logic'

test('items and look time per age', () => {
  expect([itemCount(0, 'little', []), itemCount(0, 'kid', []), itemCount(0, 'teen', [])]).toEqual([3, 4, 5])
  expect([lookMs('little', []), lookMs('kid', []), lookMs('teen', [])]).toEqual([3000, 2500, 2000])
})
test('each round adds an item, capped', () => {
  expect(itemCount(1, 'kid', [])).toBe(5)
  expect(itemCount(20, 'teen', [])).toBe(8)
})
test('upgrades', () => {
  expect(clockMs([])).toBe(120_000)
  expect(clockMs(['extra_time'])).toBe(138_000)
  expect(lookMs('kid', ['longer_look'])).toBe(3500)
  expect(itemCount(0, 'kid', ['fewer_items'])).toBe(3)
  expect(itemCount(1, 'kid', ['fewer_items'])).toBe(5)
})
test('newRound gives distinct items, deterministic', () => {
  const a = newRound(0, 'kid', [], seeded(5))
  expect(a).toHaveLength(4)
  expect(new Set(a).size).toBe(4)
  expect(newRound(0, 'kid', [], seeded(5))).toEqual(a)
})
test('isRight', () => {
  expect(isRight(1, 1, false)).toBe(true)
  expect(isRight(1, 2, false)).toBe(false)
  expect(isRight(1, 2, true)).toBe(true)
})
