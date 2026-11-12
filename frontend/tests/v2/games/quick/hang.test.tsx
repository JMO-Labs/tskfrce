import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { seeded } from '@/v2/games/rng'
import { hang } from '@/v2/games/quick/Hang'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())
const adv = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })

const setup = () => {
  const onDone = jest.fn()
  render(<hang.Component level={1} rng={seeded(42)} onDone={onDone} />)
  return { onDone, btn: screen.getByRole('button', { name: /drop/i }) }
}

test('drop when centred clears once', () => {
  const { onDone, btn } = setup()
  fireEvent.click(btn)
  fireEvent.click(btn)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('drop at the swing edge fails', () => {
  const { onDone, btn } = setup()
  adv(1050)
  fireEvent.click(btn)
  expect(onDone).toHaveBeenCalledWith(false)
})
