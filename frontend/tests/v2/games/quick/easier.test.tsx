import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, createEvent, fireEvent, render, screen } from '@testing-library/react'
import type { Micro } from '@/v2/games/types'
import { seeded } from '@/v2/games/rng'
import { sockSnatch } from '@/v2/games/quick/SockSnatch'
import { plateTower } from '@/v2/games/quick/PlateTower'
import { bubblePop } from '@/v2/games/quick/BubblePop'
import { quickDraw } from '@/v2/games/quick/QuickDraw'
import { sweepSwipe } from '@/v2/games/quick/SweepSwipe'
import { flip } from '@/v2/games/quick/Flip'
import { plug } from '@/v2/games/quick/Plug'
import { zip } from '@/v2/games/quick/Zip'
import { squeeze } from '@/v2/games/quick/Squeeze'
import { dodge } from '@/v2/games/quick/Dodge'
import { water } from '@/v2/games/quick/Water'
import { hang } from '@/v2/games/quick/Hang'
import { shh } from '@/v2/games/quick/Shh'
import { catchKeys } from '@/v2/games/quick/Catch'
import { match } from '@/v2/games/quick/Match'
import { fold } from '@/v2/games/quick/Fold'
import { feed } from '@/v2/games/quick/Feed'
import { spot } from '@/v2/games/quick/Spot'
import { count } from '@/v2/games/quick/Count'
import { catDash } from '@/v2/games/quick/CatDash'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())
const adv = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })
const mount = (m: Micro, level: number, easier?: boolean) => {
  const onDone = jest.fn()
  const r = render(<m.Component level={level} rng={seeded(42)} onDone={onDone} easier={easier} />)
  return { onDone, ...r }
}
/** mount twice (plain, then easier) and return both onDone mocks */
const pair = (m: Micro, level: number, run: (onDone: jest.Mock) => void) => {
  const out = [false, true].map((easier) => {
    const { onDone, unmount } = mount(m, level, easier)
    run(onDone as jest.Mock)
    unmount()
    return onDone as jest.Mock
  })
  return out
}
const btn = (n: RegExp | string) => screen.getByRole('button', { name: n })

test('sock-snatch: one fewer sock', () => {
  const n = (e: boolean) => { const { container, unmount } = mount(sockSnatch, 2, e); const c = container.querySelectorAll('button').length; unmount(); return c }
  expect(n(false)).toBe(5)
  expect(n(true)).toBe(4)
})

test('plate-tower: tolerance +10%', () => {
  const [a, b] = pair(plateTower, 1, () => { adv(128); fireEvent.click(btn('Drop plate')) }) // |x|~0.241 vs tol 0.22
  expect(a).toHaveBeenCalledWith(false)
  expect(b).toHaveBeenCalledWith(true)
})

test('bubble-pop: one fewer distractor', () => {
  const n = (e: boolean) => { const { container, unmount } = mount(bubblePop, 2, e); const c = container.querySelectorAll('button').length; unmount(); return c }
  expect(n(true)).toBe(n(false) - 1)
})

test('quick-draw: NOW comes 10% sooner', () => {
  const d = 500 + Math.floor(seeded(42)() * 900)
  const [a, b] = [false, true].map((e) => {
    const { unmount } = mount(quickDraw, 1, e)
    adv(Math.round(d * 0.9) + 1)
    const t = btn(/.+/).textContent
    unmount()
    return t
  })
  expect(a).toBe('Wait…')
  expect(b).toBe('NOW!')
})

test('sweep-swipe: shorter swipe (38px) counts', () => {
  const [a, b] = pair(sweepSwipe, 1, () => {
    const stage = screen.getByTestId('sweep-stage')
    const dir = screen.getByTestId('sweep-arrow').getAttribute('data-dir')!
    const v: Record<string, [number, number]> = { up: [0, -38], down: [0, 38], left: [-38, 0], right: [38, 0] }
    const dn = createEvent.pointerDown(stage); Object.assign(dn, { clientX: 100, clientY: 100 })
    const up = createEvent.pointerUp(stage); Object.assign(up, { clientX: 100 + v[dir][0], clientY: 100 + v[dir][1] })
    fireEvent(stage, dn); fireEvent(stage, up)
  })
  expect(a).not.toHaveBeenCalled()
  expect(b).toHaveBeenCalledWith(true)
})

test('flip: sizzle window +10%', () => {
  const start = 600 + Math.floor(seeded(42)() * 700)
  const t = Math.ceil((start + 351) / 16) * 16 // plain window at level 5 is 350, easier 385
  expect(t).toBeLessThanOrEqual(start + 385)
  const [a, b] = pair(flip, 5, () => { adv(t); fireEvent.click(btn(/flip/i)) })
  expect(a).toHaveBeenCalledWith(false)
  expect(b).toHaveBeenCalledWith(true)
})

test('plug: one fewer socket', () => {
  const n = (e: boolean) => { const { container, unmount } = mount(plug, 1, e); const c = container.querySelectorAll('button').length; unmount(); return c }
  expect(n(false)).toBe(3)
  expect(n(true)).toBe(2)
})

test('zip: one fewer swipe when more than one', () => {
  const [a, b] = pair(zip, 3, () => { fireEvent.click(btn('Zip up')) })
  expect(a).not.toHaveBeenCalled()
  expect(b).toHaveBeenCalledWith(true)
})

test('squeeze: one fewer tap', () => {
  const [a, b] = pair(squeeze, 2, () => { for (let i = 0; i < 7; i++) fireEvent.click(btn(/squeeze/i)) })
  expect(a).not.toHaveBeenCalled()
  expect(b).toHaveBeenCalledWith(true)
})

test('dodge: 10% more time', () => {
  const [a, b] = pair(dodge, 1, () => { adv(1150) }) // 1100 vs 1210
  expect(a).toHaveBeenCalledTimes(1)
  expect(b).not.toHaveBeenCalled()
})

test('water: green band 10% wider', () => {
  const [a, b] = pair(water, 1, () => {
    fireEvent.pointerDown(btn(/water/i))
    adv(749) // ~58.5% of 1280ms; band starts 59.4 (plain) or ~58.3 (easier)
    fireEvent.pointerUp(btn(/water/i))
  })
  expect(a).toHaveBeenCalledWith(false)
  expect(b).toHaveBeenCalledWith(true)
})

test('hang: tolerance +10%', () => {
  const [a, b] = pair(hang, 1, () => { adv(152); fireEvent.click(btn(/drop/i)) }) // |x|~0.285 vs 0.27
  expect(a).toHaveBeenCalledWith(false)
  expect(b).toHaveBeenCalledWith(true)
})

test('shh: fuse 10% longer', () => {
  const [a, b] = pair(shh, 1, () => { adv(850) }) // 820 vs 902
  expect(a).toHaveBeenCalledWith(false)
  expect(b).not.toHaveBeenCalled()
})

test('catch: window +10%', () => {
  const [a, b] = pair(catchKeys, 1, () => { adv(720); fireEvent.click(btn(/catch/i)) }) // 170 off peak vs 165 / 181
  expect(a).toHaveBeenCalledWith(false)
  expect(b).toHaveBeenCalledWith(true)
})

test('match: lid sizes spread 10% more', () => {
  const w = (e: boolean) => { const { unmount } = mount(match, 5, e); const v = parseFloat(btn('large lid').style.width); unmount(); return v }
  expect(w(false)).toBeCloseTo(108)
  expect(w(true)).toBeCloseTo(112.8)
})

test('fold: one fewer arrow', () => {
  const n = (e: boolean) => { const { unmount } = mount(fold, 3, e); const c = screen.getAllByTestId('fold-step').length; unmount(); return c }
  expect(n(false)).toBe(3)
  expect(n(true)).toBe(2)
})

test('feed: hold-off 10% shorter', () => {
  const [a, b] = pair(feed, 1, () => { fireEvent.click(btn(/fish bowl/i)); adv(640) })
  expect(a).not.toHaveBeenCalled()
  expect(b).toHaveBeenCalledWith(true)
})

test('spot: one fewer footprint', () => {
  const n = (e: boolean) => { const { unmount } = mount(spot, 1, e); const c = screen.getAllByRole('button').length; unmount(); return c }
  expect(n(false)).toBe(9)
  expect(n(true)).toBe(8)
})

test('count: one fewer answer option', () => {
  const n = (e: boolean) => { const { unmount } = mount(count, 1, e); const c = screen.getAllByRole('button').length; unmount(); return c }
  expect(n(false)).toBe(3)
  expect(n(true)).toBe(2)
})

test('cat-dash: 10% more time', () => {
  const [a, b] = pair(catDash, 1, () => { adv(1450) }) // 1400 vs 1540
  expect(a).toHaveBeenCalledTimes(1)
  expect(b).not.toHaveBeenCalled()
})
