import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react'
import { seeded } from '@/v2/games/rng'
import { spot } from '@/v2/games/quick/Spot'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const setup = (level = 1) => {
  const onDone = jest.fn()
  render(<spot.Component level={level} rng={seeded(42)} onDone={onDone} />)
  const tiles = screen.getAllByRole('button')
  const muddy = tiles.find((t) => t.hasAttribute('data-muddy'))!
  return { onDone, tiles, muddy }
}

test('grid is 3x3, 4x4 from level 3', () => {
  expect(setup(1).tiles).toHaveLength(9)
  document.body.innerHTML = ''
  expect(setup(3).tiles).toHaveLength(16)
})

test('muddy tap -> true once', () => {
  const { onDone, tiles, muddy } = setup()
  fireEvent.click(muddy)
  fireEvent.click(tiles.find((t) => t !== muddy)!)
  fireEvent.click(muddy)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('clean tap -> false once', () => {
  const { onDone, tiles, muddy } = setup()
  fireEvent.click(tiles.find((t) => t !== muddy)!)
  fireEvent.click(muddy)
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})
