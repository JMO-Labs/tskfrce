import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { seeded } from '@/v2/games/rng'
import { plateTower } from '@/v2/games/quick/PlateTower'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const setup = (level = 1) => {
  const onDone = jest.fn()
  const { Component } = plateTower
  render(<Component level={level} rng={seeded(42)} onDone={onDone} />)
  return onDone
}
const drop = () => fireEvent.click(screen.getByRole('button', { name: 'Drop plate' }))

test('meta', () => {
  expect(plateTower.key).toBe('plate-tower')
  expect(plateTower.cmd).toBe('DROP!')
})

test('drop while centred -> true once', () => {
  const onDone = setup()
  drop()
  drop()
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('drop at the edge -> false once, later drops ignored', () => {
  const onDone = setup()
  act(() => { jest.advanceTimersByTime(800) }) // sin(1.9*0.8) ~ 1
  drop()
  act(() => { jest.advanceTimersByTime(1500) })
  drop()
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(false)
})
