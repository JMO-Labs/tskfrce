import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, render } from '@testing-library/react'
import { GAME_INFO } from '@/v2/games/catalog'
import { seeded } from '@/v2/games/rng'
import { HEARTS, microLevel, partScore, RUN_MS, starsFor, windowMs } from '@/v2/games/scoring'
import { useElapsed } from '@/v2/games/useElapsed'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

test('partScore mirrors the server', () => {
  expect(partScore(0)).toBe(150)
  expect(partScore(600)).toBe(140)
  expect(partScore(3000)).toBe(100)
})

test('windowMs speeds up per age and floors at 1500', () => {
  expect(windowMs('kid', 0)).toBe(3200)
  expect(windowMs('little', 0)).toBe(3800)
  expect(windowMs('teen', 100)).toBe(1300)
  expect(windowMs('kid', 100)).toBe(1500)
})

test('microLevel climbs every 4 games, max 5', () => {
  expect(microLevel(2, 0)).toBe(2)
  expect(microLevel(2, 9)).toBe(4)
  expect(microLevel(3, 40)).toBe(5)
  expect(RUN_MS).toBe(60_000)
  expect(HEARTS).toBe(3)
})

test('starsFor uses the server thresholds', () => {
  expect(starsFor('quickfire', 499)).toBe(0)
  expect(starsFor('quickfire', 1100)).toBe(2)
  expect(starsFor('hungry-cat', 40)).toBe(3)
})

test('catalog names the phase 1 games', () => {
  expect(GAME_INFO.quickfire).toEqual({ name: 'Quick-fire', icon: '⚡', kind: 'quick' })
  expect(GAME_INFO['hungry-cat'].kind).toBe('think')
})

test('seeded is deterministic and in [0,1)', () => {
  const a = seeded(1), b = seeded(1)
  const xs = [a(), a(), a()]
  expect([b(), b(), b()]).toEqual(xs)
  xs.forEach((x) => expect(x >= 0 && x < 1).toBe(true))
})

test('useElapsed ticks with fake timers and pauses', () => {
  let seen = -1
  const Probe = ({ run }: { run: boolean }) => {
    seen = useElapsed(run)
    return null
  }
  const r = render(<Probe run />)
  act(() => {
    jest.advanceTimersByTime(500)
  })
  expect(seen).toBeGreaterThanOrEqual(480)
  const at = seen
  r.rerender(<Probe run={false} />)
  act(() => {
    jest.advanceTimersByTime(500)
  })
  expect(seen).toBe(at)
})

test('phase 2 games: names, icons and star thresholds', () => {
  expect(GAME_INFO['math-dash']).toEqual({ name: 'Math Dash', icon: '🧮', kind: 'think' })
  expect(GAME_INFO['pack-the-box'].icon).toBe('📦')
  expect(GAME_INFO['shelf-memory'].name).toBe('Shelf Memory')
  expect([starsFor('math-dash', 9), starsFor('math-dash', 20)]).toEqual([0, 2])
  expect([starsFor('pack-the-box', 4), starsFor('pack-the-box', 7)]).toEqual([2, 3])
  expect([starsFor('shelf-memory', 8), starsFor('shelf-memory', 28)]).toEqual([1, 3])
})
