import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react'
import { seeded } from '@/v2/games/rng'
import { bubblePop } from '@/v2/games/quick/BubblePop'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const setup = (level = 2) => {
  const onDone = jest.fn()
  const { Component } = bubblePop
  render(<Component level={level} rng={seeded(42)} onDone={onDone} />)
  const colour = screen.getByLabelText(/^Pop /).getAttribute('aria-label')!.replace('Pop ', '')
  return { onDone, colour }
}

test('meta', () => {
  expect(bubblePop.key).toBe('bubble-pop')
  expect(bubblePop.cmd).toBe('POP!')
})

test('6+level bubbles, 2-3 of the colour', () => {
  const { colour } = setup(2)
  expect(screen.getAllByRole('button')).toHaveLength(8)
  const n = screen.getAllByRole('button', { name: `${colour} bubble` }).length
  expect(n).toBeGreaterThanOrEqual(2)
  expect(n).toBeLessThanOrEqual(3)
})

test('popping all of the colour -> true exactly once', () => {
  const { onDone, colour } = setup()
  const mine = screen.getAllByRole('button', { name: `${colour} bubble` })
  mine.forEach((b, i) => {
    fireEvent.click(b)
    if (i < mine.length - 1) expect(onDone).not.toHaveBeenCalled()
  })
  fireEvent.click(screen.getAllByRole('button')[0])
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('a wrong bubble -> false once', () => {
  const { onDone, colour } = setup()
  const wrong = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label') !== `${colour} bubble`)!
  fireEvent.click(wrong)
  fireEvent.click(screen.getAllByRole('button', { name: `${colour} bubble` })[0])
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})
