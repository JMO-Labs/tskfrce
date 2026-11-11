import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MathDash } from '@/v2/games/mathDash/MathDash'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const solve = () => {
  const m = /(\d+) \+ (\d+)/.exec(screen.getByTestId('q').textContent!)!
  return String(+m[1] + +m[2])
}
const answers = () => screen.getAllByRole('button').filter((b) => b.className.includes('ans'))

test('HUD, clock and empty power-up slots', () => {
  render(<MathDash level={1} seed={1} age="little" onEnd={() => {}} />)
  expect(screen.getByText('🧮 0')).toBeTruthy()
  expect(screen.getByText('⏱ 1:00')).toBeTruthy()
  expect(answers().length).toBe(4)
  expect(screen.getAllByTestId('pu-empty').length).toBeGreaterThan(0)
})

test('right answer scores, wrong does not', () => {
  render(<MathDash level={1} seed={1} age="little" onEnd={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: solve() }))
  expect(screen.getByText('🧮 1')).toBeTruthy()
  const right = solve()
  fireEvent.click(answers().find((b) => b.textContent !== right)!)
  expect(screen.getByText('🧮 1')).toBeTruthy()
})

test('onEnd fires once with the score after the clock', () => {
  const onEnd = jest.fn()
  render(<MathDash level={1} seed={1} age="little" onEnd={onEnd} />)
  fireEvent.click(screen.getByRole('button', { name: solve() }))
  act(() => { jest.advanceTimersByTime(61_000) })
  act(() => { jest.advanceTimersByTime(5_000) })
  expect(onEnd).toHaveBeenCalledTimes(1)
  expect(onEnd).toHaveBeenCalledWith(1)
})

test('extra_time and freeze lengthen the clock', () => {
  const { unmount } = render(<MathDash level={1} seed={1} age="little" upgrades={['extra_time']} onEnd={() => {}} />)
  expect(screen.getByText('⏱ 1:09')).toBeTruthy()
  unmount()
  render(<MathDash level={1} seed={1} age="little" powerUp="freeze" onEnd={() => {}} />)
  expect(screen.getByText('⏱ 1:10')).toBeTruthy()
  expect(screen.getByTestId('pu-on').textContent).toContain('Freeze')
})

test('hint greys one wrong answer; fifty hides two', () => {
  const { unmount } = render(<MathDash level={1} seed={1} age="little" upgrades={['hint']} onEnd={() => {}} />)
  expect(answers().filter((b) => (b as HTMLButtonElement).disabled).length).toBe(1)
  unmount()
  render(<MathDash level={1} seed={1} age="little" powerUp="fifty" onEnd={() => {}} />)
  expect(answers().filter((b) => (b as HTMLButtonElement).disabled).length).toBe(2)
})
