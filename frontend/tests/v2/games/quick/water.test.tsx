import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { seeded } from '@/v2/games/rng'
import { water } from '@/v2/games/quick/Water'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())
const adv = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })

const setup = () => {
  const onDone = jest.fn()
  render(<water.Component level={1} rng={seeded(42)} onDone={onDone} />)
  return { onDone, btn: screen.getByRole('button', { name: /water/i }) }
}

test('release in the band clears once', () => {
  const { onDone, btn } = setup()
  fireEvent.pointerDown(btn)
  adv(900)
  fireEvent.pointerUp(btn)
  fireEvent.pointerDown(btn)
  adv(100)
  fireEvent.pointerUp(btn)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('early release fails', () => {
  const { onDone, btn } = setup()
  fireEvent.pointerDown(btn)
  adv(200)
  fireEvent.pointerUp(btn)
  expect(onDone).toHaveBeenCalledWith(false)
})

test('flood fails', () => {
  const { onDone, btn } = setup()
  fireEvent.pointerDown(btn)
  adv(2000)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
  fireEvent.pointerUp(btn)
  expect(onDone).toHaveBeenCalledTimes(1)
})
