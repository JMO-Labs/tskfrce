import { expect, test } from '@jest/globals'
import { runHearts, runLevel, runWindow } from '@/v2/games/quickRun'

const none = { upgrades: [] as string[], powerUp: null, micro: [] as string[] }

test('hearts: 3 base, spare_heart and heart_plus add one each', () => {
  expect(runHearts([], null)).toBe(3)
  expect(runHearts(['spare_heart'], null)).toBe(4)
  expect(runHearts(['spare_heart'], 'heart_plus')).toBe(5)
  expect(runHearts([], 'slow_mo')).toBe(3)
})

test('window: extra_time x1.15 (run and micro), slow_mo x1.5 for the first 6 only', () => {
  expect(runWindow('kid', 0, none)).toBe(3200)
  expect(runWindow('kid', 0, { ...none, upgrades: ['extra_time'] })).toBe(3680)
  expect(runWindow('kid', 0, { ...none, micro: ['extra_time'] })).toBe(3680)
  expect(runWindow('kid', 5, { ...none, powerUp: 'slow_mo' })).toBe(Math.round(runWindow('kid', 5, none) * 1.5))
  expect(runWindow('kid', 6, { ...none, powerUp: 'slow_mo' })).toBe(runWindow('kid', 6, none))
})

test('level: calm_start -1 for the first 4, micro slow_start -1 on first appearance, never below 1', () => {
  expect(runLevel(2, 0, 3, none)).toBe(2)
  expect(runLevel(2, 0, 3, { ...none, upgrades: ['calm_start'] })).toBe(1)
  expect(runLevel(2, 4, 3, { ...none, upgrades: ['calm_start'] })).toBe(3)
  expect(runLevel(3, 1, 3, { ...none, micro: ['slow_start'] })).toBe(2)
  expect(runLevel(3, 3, 3, { ...none, micro: ['slow_start'] })).toBe(3)
  expect(runLevel(1, 0, 3, { upgrades: ['calm_start'], powerUp: null, micro: ['slow_start'] })).toBe(1)
})
