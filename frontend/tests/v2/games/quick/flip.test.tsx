import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { flip } from '@/v2/games/quick/Flip'
import { seeded } from '@/v2/games/rng'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())
const adv = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })
const mount = () => {
  const onDone = jest.fn()
  render(<flip.Component level={1} rng={seeded(42)} onDone={onDone} />)
  return onDone
}
const btn = () => screen.getByRole('button', { name: /flip/i })
const untilHot = () => { for (let i = 0; i < 200 && btn().getAttribute('data-hot') !== '1'; i++) adv(16) }

test('tap during sizzle clears, once', () => {
  const onDone = mount()
  untilHot()
  fireEvent.click(btn())
  fireEvent.click(btn())
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('tap before sizzle fails, later taps ignored', () => {
  const onDone = mount()
  adv(100)
  fireEvent.click(btn())
  untilHot()
  fireEvent.click(btn())
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})
