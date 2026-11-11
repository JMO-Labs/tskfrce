import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { seeded } from '@/v2/games/rng'
import { match } from '@/v2/games/quick/Match'

const setup = () => {
  const onDone = jest.fn()
  render(<match.Component level={1} rng={seeded(42)} onDone={onDone} />)
  const size = screen.getByTestId('pot').getAttribute('data-size')
  const lids = screen.getAllByRole('button')
  return { onDone, right: lids.find((l) => l.getAttribute('data-size') === size)!, wrong: lids.find((l) => l.getAttribute('data-size') !== size)! }
}

test('matching lid clears once', () => {
  const { onDone, right, wrong } = setup()
  fireEvent.click(right)
  fireEvent.click(wrong)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('wrong lid fails', () => {
  const { onDone, right, wrong } = setup()
  fireEvent.click(wrong)
  fireEvent.click(right)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})
