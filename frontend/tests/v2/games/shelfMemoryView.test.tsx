import { afterEach, beforeEach, expect, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { ShelfMemory } from '@/v2/games/shelfMemory/ShelfMemory'
import { newRound } from '@/v2/games/shelfMemory/logic'
import { seeded } from '@/v2/games/rng'

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())
const items = (n = 4, round = 0, ups: string[] = []) => newRound(round, 'kid', ups, seeded(7)).slice(0, n)
const adv = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })
const slot = (i: number) => screen.getByLabelText(`Slot ${i + 1}`)
const place = (emoji: string, i: number) => { fireEvent.click(screen.getByLabelText(`Item ${emoji}`)); fireEvent.click(slot(i)) }

test('shows items during look, then moves them to the tray', () => {
  const its = items()
  render(<ShelfMemory level={1} seed={7} age="kid" onEnd={() => {}} />)
  expect(screen.getByText('🧠 0')).toBeTruthy()
  expect(screen.getByText('⏱ 2:00')).toBeTruthy()
  expect(slot(0).textContent).toBe(its[0])
  expect(screen.queryByLabelText(`Item ${its[0]}`)).toBeNull()
  adv(2600)
  expect(slot(0).textContent).toBe('')
  expect(screen.getByLabelText(`Item ${its[0]}`)).toBeTruthy()
  expect(screen.getAllByTestId('pu-empty').length).toBeGreaterThan(0)
})

test('right placement scores, wrong bounces, finishing adds an item', () => {
  const its = items()
  render(<ShelfMemory level={1} seed={7} age="kid" onEnd={() => {}} />)
  adv(2600)
  place(its[0], 1)
  expect(screen.getByText('🧠 0')).toBeTruthy()
  expect(screen.getByLabelText(`Item ${its[0]}`)).toBeTruthy()
  its.forEach((e, i) => place(e, i))
  expect(screen.getByText('🧠 4')).toBeTruthy()
  expect(slot(4)).toBeTruthy() // next round: 5 slots
  expect(slot(0).textContent).not.toBe('')
})

test('onEnd once after the clock; extra_time lengthens it', () => {
  const onEnd = jest.fn()
  render(<ShelfMemory level={1} seed={7} age="kid" onEnd={onEnd} />)
  adv(121_000)
  adv(5000)
  expect(onEnd).toHaveBeenCalledTimes(1)
  expect(onEnd).toHaveBeenCalledWith(0)
  const e2 = jest.fn()
  render(<ShelfMemory level={1} seed={7} age="kid" upgrades={['extra_time']} onEnd={e2} />)
  adv(1)
  expect(screen.getAllByText('⏱ 2:18').length).toBeGreaterThan(0)
})

test('longer_look and fewer_items', () => {
  const its = items(3, 0, ['fewer_items'])
  render(<ShelfMemory level={1} seed={7} age="kid" upgrades={['longer_look', 'fewer_items']} onEnd={() => {}} />)
  expect(screen.queryByLabelText('Slot 4')).toBeNull()
  adv(3200)
  expect(slot(0).textContent).toBe(its[0])
  adv(500)
  expect(slot(0).textContent).toBe('')
})

test('peek shows the shelf for 2 s, once', () => {
  const its = items()
  render(<ShelfMemory level={1} seed={7} age="kid" powerUp="peek" onEnd={() => {}} />)
  adv(2600)
  fireEvent.click(screen.getByRole('button', { name: /Peek/ }))
  expect(slot(0).textContent).toBe(its[0])
  adv(2100)
  expect(slot(0).textContent).toBe('')
  expect((screen.getByRole('button', { name: /Peek/ }) as HTMLButtonElement).disabled).toBe(true)
})

test('lock makes the next placement count as correct', () => {
  const its = items()
  render(<ShelfMemory level={1} seed={7} age="kid" powerUp={{ key: 'lock' }} onEnd={() => {}} />)
  adv(2600)
  fireEvent.click(screen.getByRole('button', { name: /Lock/ }))
  place(its[0], 3)
  expect(screen.getByText('🧠 1')).toBeTruthy()
  expect(slot(0).textContent).toBe(its[0])
})
