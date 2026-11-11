import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { seeded } from '@/v2/games/rng'
import { shh } from '@/v2/games/quick/Shh'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())
const adv = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })

const setup = () => {
  const onDone = jest.fn()
  render(<shh.Component level={1} rng={seeded(42)} onDone={onDone} />)
  return { onDone }
}

test('ringing clock clears once', () => {
  const { onDone } = setup()
  const b = screen.getByRole('button', { name: /ringing/i })
  fireEvent.click(b)
  fireEvent.click(b)
  adv(2000)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('quiet clock fails', () => {
  const { onDone } = setup()
  fireEvent.click(screen.getAllByRole('button', { name: /quiet/i })[0])
  expect(onDone).toHaveBeenCalledWith(false)
  fireEvent.click(screen.getByRole('button', { name: /ringing/i }))
  expect(onDone).toHaveBeenCalledTimes(1)
})

test('fuse runs out', () => {
  const { onDone } = setup()
  adv(1000)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})
