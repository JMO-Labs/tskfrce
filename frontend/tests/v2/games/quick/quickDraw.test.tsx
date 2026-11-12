import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { seeded } from '@/v2/games/rng'
import { quickDraw } from '@/v2/games/quick/QuickDraw'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const setup = (level = 1) => {
  const onDone = jest.fn()
  const { Component } = quickDraw
  render(<Component level={level} rng={seeded(42)} onDone={onDone} />)
  return onDone
}
const tap = () => fireEvent.click(screen.getByRole('button'))

test('meta', () => {
  expect(quickDraw.key).toBe('quick-draw')
  expect(quickDraw.cmd).toBe('DRAW!')
})

test('tap before NOW -> false once', () => {
  const onDone = setup()
  expect(screen.getByRole('button').textContent).toMatch(/Wait/)
  tap()
  act(() => { jest.advanceTimersByTime(2000) })
  tap()
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})

test('tap after NOW -> true once', () => {
  const onDone = setup()
  act(() => { jest.advanceTimersByTime(1500) })
  expect(screen.getByRole('button').textContent).toMatch(/NOW/)
  tap()
  tap()
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('level 3 flashes a fake-out, tapping it fails', () => {
  const onDone = setup(3)
  let seen = false
  for (let i = 0; i < 150 && !seen; i++) {
    act(() => { jest.advanceTimersByTime(10) })
    seen = /NOT YET/.test(screen.getByRole('button').textContent ?? '') && !/NOW!/.test(screen.getByRole('button').textContent ?? '')
  }
  expect(seen).toBe(true)
  tap()
  expect(onDone).toHaveBeenCalledWith(false)
})
