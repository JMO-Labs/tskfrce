import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { seeded } from '@/v2/games/rng'
import { feed } from '@/v2/games/quick/Feed'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const setup = () => {
  const onDone = jest.fn()
  render(<feed.Component level={1} rng={seeded(42)} onDone={onDone} />)
  return { onDone, bowl: screen.getByRole('button', { name: /fish bowl/i }) }
}

test('one tap -> true after 700ms, once', () => {
  const { onDone, bowl } = setup()
  fireEvent.click(bowl)
  act(() => { jest.advanceTimersByTime(699) })
  expect(onDone).not.toHaveBeenCalled()
  act(() => { jest.advanceTimersByTime(1) })
  expect(onDone).toHaveBeenCalledWith(true)
  fireEvent.click(bowl)
  act(() => { jest.advanceTimersByTime(2000) })
  expect(onDone).toHaveBeenCalledTimes(1)
})

test('second tap -> false, nothing more', () => {
  const { onDone, bowl } = setup()
  fireEvent.click(bowl)
  act(() => { jest.advanceTimersByTime(300) })
  fireEvent.click(bowl)
  fireEvent.click(bowl)
  act(() => { jest.advanceTimersByTime(2000) })
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})
