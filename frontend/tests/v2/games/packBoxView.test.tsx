import { afterEach, beforeEach, expect, jest, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { PackBox } from '@/v2/games/packBox/PackBox'
import { newGame, shapeOf } from '@/v2/games/packBox/logic'
import { seeded } from '@/v2/games/rng'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const solveByTaps = (age: 'little' | 'kid' | 'teen', seed: number) => {
  // replay the generator: place pieces at their solution positions
  const g = newGame(age, 0, seeded(seed))
  const w = g.w
  const cellsOf = (id: number) => g.sol.map((c, i) => (c === id ? i : -1)).filter((i) => i >= 0)
  return { g, w, cellsOf }
}

test('HUD, tray and empty slots render', () => {
  render(<PackBox level={1} seed={4} age="little" onEnd={() => {}} />)
  expect(screen.getByText('📦 0')).toBeTruthy()
  expect(screen.getByText('⏱ 2:00')).toBeTruthy()
  expect(screen.getAllByTestId('pu-empty').length).toBe(3)
  expect(screen.getAllByTestId('cell').length).toBe(9)
  expect(screen.getAllByTestId('piece').length).toBeGreaterThan(0)
})

test('extra_time adds 18 s', () => {
  render(<PackBox level={1} seed={4} age="little" upgrades={['extra_time']} onEnd={() => {}} />)
  expect(screen.getByText('⏱ 2:18')).toBeTruthy()
})

test('filling a box scores 1 and deals a new box', () => {
  const { g } = solveByTaps('little', 4)
  render(<PackBox level={1} seed={4} age="little" onEnd={() => {}} />)
  // the generator is deterministic per (seed, boxes packed): solve using logic-level knowledge
  const rot0 = g.pieces.map((p) => shapeOf(p))
  expect(rot0.length).toBe(g.pieces.length)
  // tap each piece then its anchor cell, in tray order, at its solved anchor
  let placed = 0
  for (const p of g.pieces) {
    const idx = g.sol.findIndex((c) => c === p.id)
    // tray shows 3 at a time; pieces already placed leave the queue
    const tiles = screen.getAllByTestId('piece')
    const tile = tiles.find((t) => t.getAttribute('data-id') === String(p.id))!
    fireEvent.click(tile)
    for (let r = 0; r < (4 - p.rot) % 4; r++) fireEvent.click(screen.getByLabelText('Rotate piece'))
    fireEvent.click(screen.getAllByTestId('cell')[idx]); placed++
  }
  expect(placed).toBe(g.pieces.length)
  expect(screen.getByText('📦 1')).toBeTruthy()
})

test('onEnd fires exactly once with the score after the 120 s clock', () => {
  const onEnd = jest.fn()
  render(<PackBox level={1} seed={4} age="little" onEnd={onEnd} />)
  act(() => { jest.advanceTimersByTime(121_000) })
  expect(onEnd).toHaveBeenCalledTimes(1)
  expect(onEnd).toHaveBeenCalledWith(0)
  act(() => { jest.advanceTimersByTime(5_000) })
  expect(onEnd).toHaveBeenCalledTimes(1)
})

test('undo power-up takes back placements and is spent', () => {
  render(<PackBox level={1} seed={4} age="little" powerUp="undo" onEnd={() => {}} />)
  fireEvent.click(screen.getAllByTestId('piece')[0])
  const filled = () => screen.getAllByTestId('cell').filter((c) => c.getAttribute('data-filled') === '1').length
  for (let i = 0; i < 9 && filled() === 0; i++) fireEvent.click(screen.getAllByTestId('cell')[i])
  expect(filled()).toBeGreaterThan(0)
  fireEvent.click(screen.getByLabelText('Undo'))
  expect(filled()).toBe(0)
  expect(screen.queryByLabelText('Undo')).toBeNull()
})
