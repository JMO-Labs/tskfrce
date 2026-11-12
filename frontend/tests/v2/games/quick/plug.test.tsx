import { expect, test } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react'
import { plug } from '@/v2/games/quick/Plug'
import { seeded } from '@/v2/games/rng'

const mount = () => {
  const onDone = jest.fn()
  render(<plug.Component level={1} rng={seeded(42)} onDone={onDone} />)
  const target = screen.getByTestId('plug').getAttribute('data-shape')!
  const sockets = screen.getAllByRole('button')
  return { onDone, right: sockets.find(b => b.getAttribute('data-shape') === target)!, wrong: sockets.find(b => b.getAttribute('data-shape') !== target)! }
}

test('three sockets, matching one clears once', () => {
  const { onDone, right, wrong } = mount()
  expect(screen.getAllByRole('button')).toHaveLength(3)
  fireEvent.click(right)
  fireEvent.click(wrong)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('wrong socket fails once', () => {
  const { onDone, right, wrong } = mount()
  fireEvent.click(wrong)
  fireEvent.click(right)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})
