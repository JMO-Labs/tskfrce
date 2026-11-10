import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { HungryCat } from '@/v2/games/hungryCat/HungryCat'

beforeEach(() => {
  jest.useFakeTimers()
  window.requestAnimationFrame = ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((id: number) => clearTimeout(id)) as typeof window.cancelAnimationFrame
})
afterEach(() => jest.useRealTimers())

test('shows HUD, hearts, cat and empty power-up slots', () => {
  render(<HungryCat level={1} seed={1} onEnd={() => {}} />)
  expect(screen.getByText('🍽️ 0')).toBeTruthy()
  expect(screen.getByText('⏱ 1:00')).toBeTruthy()
  expect(screen.getByLabelText('3 hearts')).toBeTruthy()
  expect(screen.getByTestId('cat').getAttribute('style')).toContain('50%')
  expect(screen.getAllByTestId('pu-empty').length).toBeGreaterThan(0)
})

test('arrow keys move the cat', () => {
  render(<HungryCat level={1} seed={1} onEnd={() => {}} />)
  fireEvent.keyDown(window, { key: 'ArrowLeft' })
  act(() => { jest.advanceTimersByTime(32) })
  expect(screen.getByTestId('cat').getAttribute('style')).toContain('42%')
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  fireEvent.keyDown(window, { key: 'ArrowRight' })
  act(() => { jest.advanceTimersByTime(32) })
  expect(screen.getByTestId('cat').getAttribute('style')).toContain('58%')
})

test('onEnd fires exactly once after the 60 s clock', () => {
  const onEnd = jest.fn()
  render(<HungryCat level={1} seed={1} onEnd={onEnd} />)
  act(() => { jest.advanceTimersByTime(62_000) })
  expect(onEnd).toHaveBeenCalledTimes(1)
  act(() => { jest.advanceTimersByTime(5_000) })
  expect(onEnd).toHaveBeenCalledTimes(1)
  expect(typeof onEnd.mock.calls[0][0]).toBe('number')
})
