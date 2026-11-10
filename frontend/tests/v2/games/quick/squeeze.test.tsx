import { expect, jest, test } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react'
import { squeeze } from '@/v2/games/quick/Squeeze'
import { seeded } from '@/v2/games/rng'

const mount = (level: number) => {
  const onDone = jest.fn()
  render(<squeeze.Component level={level} rng={seeded(42)} onDone={onDone} />)
  return onDone
}
const tap = (n: number) => { for (let i = 0; i < n; i++) fireEvent.click(screen.getByRole('button', { name: /squeeze/i })) }

test('6+level*2 taps clears once; extra taps ignored', () => {
  const onDone = mount(2) // 10
  tap(9)
  expect(onDone).not.toHaveBeenCalled()
  tap(5)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('too few taps never calls (runner times out as a fail)', () => {
  const onDone = mount(1)
  tap(7)
  expect(onDone).not.toHaveBeenCalled()
})
