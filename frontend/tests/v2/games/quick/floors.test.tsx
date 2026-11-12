import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { seeded } from '@/v2/games/rng'
import { squeeze } from '@/v2/games/quick/Squeeze'
import { count } from '@/v2/games/quick/Count'
import { catchKeys } from '@/v2/games/quick/Catch'
import { water } from '@/v2/games/quick/Water'
import { flip } from '@/v2/games/quick/Flip'
import { plateTower } from '@/v2/games/quick/PlateTower'
import { hang } from '@/v2/games/quick/Hang'
import { match } from '@/v2/games/quick/Match'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())
const adv = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })

test('squeeze level 5 needs 11 taps', () => {
  const onDone = jest.fn()
  render(<squeeze.Component level={5} rng={seeded(1)} onDone={onDone} />)
  const b = screen.getByRole('button', { name: /squeeze/i })
  for (let i = 0; i < 10; i++) fireEvent.click(b)
  expect(onDone).not.toHaveBeenCalled()
  fireEvent.click(b)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('count level 5: at most 7 cookies, visible at least 800ms', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const { unmount } = render(<count.Component level={5} rng={seeded(seed)} onDone={jest.fn()} />)
    expect(screen.getAllByTestId('cookie').length).toBeLessThanOrEqual(7)
    adv(799)
    expect(screen.queryAllByTestId('cookie').length).toBeGreaterThan(0)
    unmount()
  }
})

test('catch level 5 tolerance is 110ms', () => {
  const run = (off: number) => {
    const onDone = jest.fn()
    const { unmount } = render(<catchKeys.Component level={5} rng={seeded(1)} onDone={onDone} />)
    adv(350 + off)
    fireEvent.click(screen.getByRole('button', { name: /catch/i }))
    unmount()
    return onDone
  }
  expect(run(105)).toHaveBeenCalledWith(true)
  expect(run(-105)).toHaveBeenCalledWith(true)
})

test('water level 5 band is at least 18% wide', () => {
  const { container } = render(<water.Component level={5} rng={seeded(1)} onDone={jest.fn()} />)
  const band = container.querySelector('[style*="height"][style*="bottom"]') as HTMLElement
  expect(parseFloat(band.style.height)).toBeGreaterThanOrEqual(18)
})

test('flip level 5 sizzle lasts at least 350ms', () => {
  render(<flip.Component level={5} rng={seeded(42)} onDone={jest.fn()} />)
  const btn = screen.getByRole('button', { name: /flip/i })
  let hot = 0
  for (let i = 0; i < 400; i++) { adv(5); if (btn.getAttribute('data-hot') === '1') hot += 5 }
  expect(hot).toBeGreaterThanOrEqual(345)
})

test('plate tower level 5 tolerance is at least 0.13', () => {
  const onDone = jest.fn()
  render(<plateTower.Component level={5} rng={seeded(1)} onDone={onDone} />)
  adv(32) // x = sin(0.112) ~ 0.112
  fireEvent.click(screen.getByRole('button', { name: /drop/i }))
  expect(onDone).toHaveBeenCalledWith(true)
})

test('hang level 5 tolerance is at least 0.13', () => {
  const onDone = jest.fn()
  render(<hang.Component level={5} rng={seeded(1)} onDone={onDone} />)
  jest.setSystemTime(Date.now() + 35) // x = sin(0.1225) ~ 0.122
  fireEvent.click(screen.getByRole('button', { name: /drop/i }))
  expect(onDone).toHaveBeenCalledWith(true)
})

test('match lids are at least 24px apart at every level', () => {
  for (let level = 1; level <= 5; level++) {
    const { unmount } = render(<match.Component level={level} rng={seeded(3)} onDone={jest.fn()} />)
    const w = [0, 1, 2].map((n) => parseFloat(screen.getByRole('button', { name: new RegExp(['small', 'medium', 'large'][n]) }).style.width))
    expect(w[1] - w[0]).toBeGreaterThanOrEqual(24)
    expect(w[2] - w[1]).toBeGreaterThanOrEqual(24)
    unmount()
  }
})
