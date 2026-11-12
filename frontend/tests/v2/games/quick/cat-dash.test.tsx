import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { seeded } from '@/v2/games/rng'
import { catDash } from '@/v2/games/quick/CatDash'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const fall = 1500 - 2 * 100
const setup = () => {
  const onDone = jest.fn()
  render(<catDash.Component level={2} rng={seeded(42)} onDone={onDone} />)
  const treat = Number(screen.getByTestId('treat').getAttribute('data-lane'))
  return { onDone, treat }
}
// cat starts in the middle lane (1)
const steer = (to: number) => {
  for (let l = 1; l < to; l++) fireEvent.click(screen.getByRole('button', { name: 'Right' }))
  for (let l = 1; l > to; l--) fireEvent.click(screen.getByRole('button', { name: 'Left' }))
}

test('cat in the treat lane at landing -> true once', () => {
  const { onDone, treat } = setup()
  steer(treat)
  act(() => { jest.advanceTimersByTime(fall - 1) })
  expect(onDone).not.toHaveBeenCalled()
  act(() => { jest.advanceTimersByTime(1) })
  fireEvent.click(screen.getByRole('button', { name: 'Left' }))
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  act(() => { jest.advanceTimersByTime(3000) })
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('cat in another lane -> false once', () => {
  const { onDone, treat } = setup()
  steer(treat === 0 ? 2 : 0)
  act(() => { jest.advanceTimersByTime(fall + 3000) })
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})

test('arrow keys steer too', () => {
  const { onDone, treat } = setup()
  for (let l = 1; l < treat; l++) fireEvent.keyDown(window, { key: 'ArrowRight' })
  for (let l = 1; l > treat; l--) fireEvent.keyDown(window, { key: 'ArrowLeft' })
  act(() => { jest.advanceTimersByTime(fall) })
  expect(onDone).toHaveBeenCalledWith(true)
})
