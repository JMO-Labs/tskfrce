import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { seeded } from '@/v2/games/rng'
import { count } from '@/v2/games/quick/Count'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const setup = (level = 2) => {
  const onDone = jest.fn()
  render(<count.Component level={level} rng={seeded(42)} onDone={onDone} />)
  const n = screen.getAllByTestId('cookie').length
  act(() => { jest.advanceTimersByTime(1100 - level * 120) })
  return { onDone, n }
}
const ans = () => screen.getAllByRole('button')

test('cookies hide after the flash, 3 answers incl. the right one', () => {
  const { n } = setup()
  expect(screen.queryAllByTestId('cookie')).toHaveLength(0)
  expect(n).toBeGreaterThanOrEqual(3)
  expect(n).toBeLessThanOrEqual(6)
  expect(ans().map((b) => b.textContent)).toContain(String(n))
  expect(ans()).toHaveLength(3)
})

test('right count -> true once', () => {
  const { onDone, n } = setup()
  fireEvent.click(screen.getByRole('button', { name: String(n) }))
  fireEvent.click(ans()[0])
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('wrong count -> false once', () => {
  const { onDone, n } = setup()
  fireEvent.click(ans().find((b) => b.textContent !== String(n))!)
  fireEvent.click(screen.getByRole('button', { name: String(n) }))
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})
