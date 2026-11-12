import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { dodge } from '@/v2/games/quick/Dodge'
import { seeded } from '@/v2/games/rng'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())
const adv = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })
const key = (k: string) => fireEvent.keyDown(window, { key: k })
const mount = () => {
  const onDone = jest.fn()
  render(<dodge.Component level={1} rng={seeded(42)} onDone={onDone} />)
  return onDone
}
const mascotLane = Math.floor(seeded(42)() * 3)
// vacuum starts in lane 1
const toLane = (n: number) => { for (let i = 1; i < n; i++) key('ArrowRight'); for (let i = 1; i > n; i--) key('ArrowLeft') }
const other = (mascotLane + 1) % 3

test('dodging the mascot lane clears once', () => {
  const onDone = mount()
  toLane(other)
  adv(1000)
  expect(onDone).not.toHaveBeenCalled()
  adv(200)
  key('ArrowLeft')
  adv(2000)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('running over the mascot fails', () => {
  const onDone = mount()
  toLane(mascotLane)
  adv(1300)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})

test('buttons move the vacuum', () => {
  const onDone = mount()
  fireEvent.click(screen.getByRole('button', { name: /left/i }))
  fireEvent.click(screen.getByRole('button', { name: /right/i }))
  adv(1300)
  expect(onDone).toHaveBeenCalledWith(mascotLane !== 1)
})
