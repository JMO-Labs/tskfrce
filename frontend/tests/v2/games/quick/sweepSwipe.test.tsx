import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import { seeded } from '@/v2/games/rng'
import { sweepSwipe } from '@/v2/games/quick/SweepSwipe'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const KEY: Record<string, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' }
const OPP: Record<string, string> = { up: 'down', down: 'up', left: 'right', right: 'left' }
const setup = (level = 1) => {
  const onDone = jest.fn()
  const { Component } = sweepSwipe
  render(<Component level={level} rng={seeded(42)} onDone={onDone} />)
  const dir = screen.getByTestId('sweep-arrow').getAttribute('data-dir')!
  return { onDone, dir }
}
const wrongOf = (d: string) => Object.keys(KEY).find((k) => k !== d && k !== OPP[d])!

test('meta', () => {
  expect(sweepSwipe.key).toBe('sweep-swipe')
  expect(sweepSwipe.cmd).toBe('SWEEP!')
})

test('matching key -> true once, extra key ignored', () => {
  const { onDone, dir } = setup()
  fireEvent.keyDown(window, { key: KEY[dir] })
  fireEvent.keyDown(window, { key: KEY[wrongOf(dir)] })
  expect(onDone).toHaveBeenCalledTimes(1)
  expect(onDone).toHaveBeenCalledWith(true)
})

test('other key -> false', () => {
  const { onDone, dir } = setup()
  fireEvent.keyDown(window, { key: KEY[wrongOf(dir)] })
  expect(onDone).toHaveBeenCalledWith(false)
})

test('pointer swipe of 40px+ counts; direction button works', () => {
  const { onDone, dir } = setup()
  const stage = screen.getByTestId('sweep-stage')
  const pt = (type: 'pointerDown' | 'pointerUp', x: number, y: number) => {
    const e = createEvent[type](stage)
    Object.assign(e, { clientX: x, clientY: y })
    fireEvent(stage, e)
  }
  const v: Record<string, [number, number]> = { up: [0, -60], down: [0, 60], left: [-60, 0], right: [60, 0] }
  pt('pointerDown', 100, 100)
  pt('pointerUp', 100 + v[dir][0], 100 + v[dir][1])
  expect(onDone).toHaveBeenCalledWith(true)
  expect(onDone).toHaveBeenCalledTimes(1)
})

test('short drag is ignored', () => {
  const { onDone } = setup()
  const stage = screen.getByTestId('sweep-stage')
  const down = createEvent.pointerDown(stage); Object.assign(down, { clientX: 0, clientY: 0 })
  const up = createEvent.pointerUp(stage); Object.assign(up, { clientX: 10, clientY: 0 })
  fireEvent(stage, down); fireEvent(stage, up)
  expect(onDone).not.toHaveBeenCalled()
})

test('level 4 shows "opposite!" and wants the reverse', () => {
  const { onDone, dir } = setup(4)
  expect(screen.getByText(/opposite!/i)).toBeTruthy()
  fireEvent.keyDown(window, { key: KEY[dir] })
  expect(onDone).toHaveBeenCalledWith(false)
})

test('level 4 reverse is ok', () => {
  const { onDone, dir } = setup(4)
  fireEvent.keyDown(window, { key: KEY[OPP[dir]] })
  expect(onDone).toHaveBeenCalledWith(true)
})
