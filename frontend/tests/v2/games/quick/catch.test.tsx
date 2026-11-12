import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { seeded } from '@/v2/games/rng'
import { catchKeys } from '@/v2/games/quick/Catch'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())
const adv = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })

const setup = () => {
  const onDone = jest.fn()
  render(<catchKeys.Component level={1} rng={seeded(42)} onDone={onDone} />)
  return { onDone, btn: screen.getByRole('button', { name: /catch/i }) }
}

test('tap at the peak clears once', () => {
  const { onDone, btn } = setup()
  adv(550)
  fireEvent.click(btn)
  fireEvent.click(btn)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('early tap fails', () => {
  const { onDone, btn } = setup()
  fireEvent.click(btn)
  expect(onDone).toHaveBeenCalledWith(false)
})

test('missing the key fails', () => {
  const { onDone } = setup()
  adv(1300)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})
