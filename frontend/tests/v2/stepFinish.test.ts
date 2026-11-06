import { describe, expect, test } from '@jest/globals'
import { finishLine } from '@/v2/setup/StepFinish'

describe('finishLine', () => {
  test('chores and the lock start at the next reset', () => {
    expect(finishLine({ resetTime: '06:00:00', chores: 3, kids: 1, lock: true })).toBe(
      'Hours start now. Chores, and the chore lock, start at the next daily reset (6:00 AM).',
    )
  })
  test('lock off: no lock clause', () => {
    expect(finishLine({ resetTime: '06:00:00', chores: 3, kids: 2, lock: false })).toBe(
      'Hours start now. Chores start at the next daily reset (6:00 AM).',
    )
  })
  test('no reset time yet: no clock', () => {
    expect(finishLine({ chores: 1, kids: 1, lock: true })).toBe(
      'Hours start now. Chores, and the chore lock, start at the next daily reset.',
    )
  })
  test.each([
    [0, 2],
    [3, 0],
  ])('%i chores, %i kids: hours only', (chores, kids) => {
    expect(finishLine({ resetTime: '06:00:00', chores, kids, lock: true })).toBe('Hours start now.')
  })
})
