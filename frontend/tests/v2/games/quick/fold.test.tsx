import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { seeded } from '@/v2/games/rng'
import { fold } from '@/v2/games/quick/Fold'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const setup = (level = 1) => {
  const onDone = jest.fn()
  render(<fold.Component level={level} rng={seeded(42)} onDone={onDone} />)
  const want = screen.getAllByTestId('fold-step').map((e) => e.getAttribute('data-dir') as string)
  return { onDone, want }
}
const name = (d: string) => d[0].toUpperCase() + d.slice(1)
const other = (d: string) => (d === 'up' ? 'Down' : 'Up')

test('sequence length grows with level', () => {
  expect(setup(1).want).toHaveLength(2)
  document.body.innerHTML = ''
  expect(setup(4).want).toHaveLength(4)
})

test('right order via buttons -> true exactly once', () => {
  const { onDone, want } = setup()
  want.forEach((d) => fireEvent.click(screen.getByRole('button', { name: name(d) })))
  fireEvent.click(screen.getByRole('button', { name: name(want[0]) }))
  act(() => { jest.advanceTimersByTime(1000) })
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('arrow keys work', () => {
  const { onDone, want } = setup()
  want.forEach((d) => fireEvent.keyDown(window, { key: 'Arrow' + name(d) }))
  expect(onDone).toHaveBeenCalledWith(true)
})

test('wrong arrow -> false, later input ignored', () => {
  const { onDone, want } = setup()
  fireEvent.click(screen.getByRole('button', { name: other(want[0]) === name(want[0]) ? 'Left' : other(want[0]) }))
  fireEvent.keyDown(window, { key: 'Arrow' + name(want[0]) })
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})
