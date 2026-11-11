import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { fireEvent, render, screen } from '@testing-library/react'
import { seeded } from '@/v2/games/rng'
import { sockSnatch } from '@/v2/games/quick/SockSnatch'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const setup = (level = 2) => {
  const onDone = jest.fn()
  const { Component } = sockSnatch
  render(<Component level={level} rng={seeded(42)} onDone={onDone} />)
  const target = screen.getByLabelText(/^Target sock: /).getAttribute('aria-label')!.replace('Target sock: ', '')
  return { onDone, target }
}

test('meta', () => {
  expect(sockSnatch.key).toBe('sock-snatch')
  expect(sockSnatch.cmd).toBe('PAIR!')
})

test('shows 3+level options', () => {
  setup(2)
  expect(screen.getAllByRole('button')).toHaveLength(5)
})

test('matching sock -> true once, extra taps ignored', () => {
  const { onDone, target } = setup()
  fireEvent.click(screen.getByRole('button', { name: `${target} sock` }))
  fireEvent.click(screen.getByRole('button', { name: `${target} sock` }))
  fireEvent.click(screen.getAllByRole('button')[0])
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('wrong sock -> false once', () => {
  const { onDone, target } = setup()
  const wrong = screen.getAllByRole('button').find((b) => b.getAttribute('aria-label') !== `${target} sock`)!
  fireEvent.click(wrong)
  fireEvent.click(screen.getByRole('button', { name: `${target} sock` }))
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})
