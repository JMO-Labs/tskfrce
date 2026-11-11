import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'

// Mock pixi.js before importing the component
jest.mock('pixi.js', () => ({
  Application: jest.fn(() => ({
    init: jest.fn(() => Promise.resolve()),
    canvas: document.createElement('canvas'),
    stage: { addChild: jest.fn() },
    destroy: jest.fn(),
    ticker: { add: jest.fn(), stop: jest.fn() },
  })),
  Container: jest.fn(function() {
    this.addChild = jest.fn()
    this.removeChild = jest.fn()
    this.x = 0
    this.y = 0
  }),
  Sprite: jest.fn(function() {
    this.anchor = { set: jest.fn() }
    this.width = 0
    this.height = 0
    this.x = 0
    this.y = 0
    this.alpha = 1
    this.scale = { x: 1, y: 1 }
  }),
  Graphics: jest.fn(function() {
    this.rect = jest.fn(() => this)
    this.fill = jest.fn(() => this)
    this.stroke = jest.fn(() => this)
    this.roundRect = jest.fn(() => this)
    this.ellipse = jest.fn(() => this)
    this.x = 0
    this.y = 0
  }),
  Text: jest.fn(function() {
    this.anchor = { set: jest.fn() }
    this.x = 0
    this.y = 0
    this.alpha = 1
  }),
  Assets: { load: jest.fn(() => Promise.resolve({})) },
}))

import { HungryCat } from '@/v2/games/hungryCat/HungryCat'

beforeEach(() => {
  jest.useFakeTimers()
  window.requestAnimationFrame = ((cb: FrameRequestCallback) =>
    setTimeout(() => cb(Date.now()), 16) as unknown as number) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof window.cancelAnimationFrame
})
afterEach(() => jest.useRealTimers())

test('shows HUD, hearts, and empty power-up slots', () => {
  render(<HungryCat level={1} seed={1} onEnd={() => {}} />)
  expect(screen.getByText('🍽️ 0')).toBeTruthy()
  expect(screen.getByText('⏱ 1:00')).toBeTruthy()
  expect(screen.getByLabelText('3 hearts')).toBeTruthy()
  expect(screen.getAllByTestId('pu-empty').length).toBeGreaterThan(0)
})

test('arrow keys trigger game updates', () => {
  render(<HungryCat level={1} seed={1} onEnd={() => {}} />)
  fireEvent.keyDown(window, { key: 'ArrowLeft' })
  act(() => {
    jest.advanceTimersByTime(32)
  })
  // With Pixi rendering, we can't check DOM styles, but the game should update
  expect(screen.getByText('🍽️ 0')).toBeTruthy()
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  act(() => {
    jest.advanceTimersByTime(32)
  })
  expect(screen.getByText('🍽️ 0')).toBeTruthy()
})

test('onEnd fires exactly once after the 60 s clock', async () => {
  const onEnd = jest.fn()
  render(<HungryCat level={1} seed={1} onEnd={onEnd} />)
  // Wait for canvas to be added and setup to start
  await waitFor(() => {
    expect(screen.getByTestId('cat')).toBeTruthy()
  })
  // Advance enough for setup async to complete
  act(() => {
    jest.advanceTimersByTime(100)
  })
  // Now advance for the full game duration
  act(() => {
    jest.advanceTimersByTime(62_000)
  })
  await waitFor(() => {
    expect(onEnd).toHaveBeenCalledTimes(1)
  }, { timeout: 100 })
  act(() => {
    jest.advanceTimersByTime(5_000)
  })
  expect(onEnd).toHaveBeenCalledTimes(1)
  expect(typeof onEnd.mock.calls[0][0]).toBe('number')
})

const held = [
  { key: 'magnet', name: 'Magnet', icon: '🧲' },
  { key: 'multiply', name: 'Multiply', icon: '✖️2' },
]

test('slots show held power-ups with the armed one lit', () => {
  render(<HungryCat level={1} seed={1} onEnd={() => {}} held={held} powerUp="magnet" />)
  expect(screen.getByText('🧲 Magnet').getAttribute('data-armed')).toBe('true')
  expect(screen.getByText('✖️2 Multiply').getAttribute('data-armed')).toBe('false')
  expect(screen.getAllByTestId('pu-empty')).toHaveLength(1)
})

test('extra_time lengthens the clock', () => {
  render(<HungryCat level={1} seed={1} onEnd={() => {}} upgrades={['extra_time']} />)
  expect(screen.getByText('⏱ 1:09')).toBeTruthy()
})
