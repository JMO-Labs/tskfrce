import { act, render, screen } from '@testing-library/react'
import { QuickFire } from '@/v2/games/QuickFire'
import type { Micro } from '@/v2/games/types'

jest.mock('@/v2/games/quick', () => ({ MICROS: [] }))

let call: (ok: boolean) => void = () => {}
const stub = (key: string): Micro => ({ key, name: key, cmd: key.toUpperCase() + '!', Component: (p) => { call = p.onDone; return <div>stage-{key}</div> } })
const micros = [stub('a'), stub('b')]
const adv = (ms: number) => act(() => { jest.advanceTimersByTime(ms) })

beforeEach(() => jest.useFakeTimers())
afterEach(() => jest.useRealTimers())

const setup = (age: 'kid' | 'little' = 'kid') => {
  const onEnd = jest.fn()
  render(<QuickFire age={age} startLevel={2} seed={1} onEnd={onEnd} micros={micros} />)
  return onEnd
}

test('3 failures end the run with 3 parts', () => {
  const onEnd = setup()
  for (let k = 0; k < 3; k++) { act(() => call(false)); adv(400) }
  expect(onEnd).toHaveBeenCalledTimes(1)
  expect(onEnd.mock.calls[0][0]).toHaveLength(3)
})

test('timeout records ok:false', () => {
  const onEnd = setup()
  adv(3200)
  expect(screen.getByRole('img', { name: 'Missed' })).toBeInTheDocument()
  adv(400); adv(3300); adv(400); adv(3300)
  expect(onEnd).toHaveBeenCalledTimes(1)
  expect(onEnd.mock.calls[0][0].map((p: { ok: boolean }) => p.ok)).toEqual([false, false, false])
})

test('double onDone and onDone after timeout record one part', () => {
  const onEnd = setup()
  const first = call
  act(() => { first(true); first(true) })
  adv(400)
  expect(screen.getByText(/Game 2 · ⭐ \d+/)).toBeInTheDocument()
  const second = call
  adv(3500)
  act(() => second(true))
  adv(400)
  expect(screen.getByText(/Game 3/)).toBeInTheDocument()
  // run to the end by timing out: parts are 1 ok + 1 timeout + ...
  for (let k = 0; k < 3; k++) { adv(3500); adv(400) }
  const parts = onEnd.mock.calls[0][0]
  expect(parts.slice(0, 2).map((p: { ok: boolean }) => p.ok)).toEqual([true, false])
})

test('run ends at 60 s', () => {
  const onEnd = setup()
  for (let k = 0; k < 40 && !onEnd.mock.calls.length; k++) { act(() => call(true)); adv(400); adv(1400) }
  adv(60000)
  expect(onEnd).toHaveBeenCalledTimes(1)
  expect(onEnd.mock.calls[0][0].length).toBeGreaterThan(0)
})

test('FASTER! appears at game 5 only', () => {
  setup()
  expect(screen.queryByText('FASTER!')).toBeNull()
  for (let k = 0; k < 4; k++) { act(() => call(true)); adv(400) }
  expect(screen.getByText('FASTER!')).toBeInTheDocument()
  adv(1200)
  expect(screen.queryByText('FASTER!')).toBeNull()
})

test('spare_heart + heart_plus: 5 hearts shown, run survives 4 misses', () => {
  const onEnd = jest.fn()
  render(<QuickFire age="kid" startLevel={2} seed={1} onEnd={onEnd} micros={micros} upgrades={['spare_heart']} powerUp="heart_plus" />)
  expect(screen.getByLabelText('5 hearts left')).toBeInTheDocument()
  for (let k = 0; k < 4; k++) { act(() => call(false)); adv(400) }
  expect(onEnd).not.toHaveBeenCalled()
  act(() => call(false))
  expect(onEnd).toHaveBeenCalledTimes(1)
})

const timerMs = (c: HTMLElement) => c.querySelector('.timer i')?.getAttribute('style')
const mount = (extra: Partial<React.ComponentProps<typeof QuickFire>>, ms = micros) => {
  const onEnd = jest.fn()
  return render(<QuickFire age="kid" startLevel={2} seed={1} onEnd={onEnd} micros={ms} {...extra} />)
}

test('baseline first window', () => {
  expect(timerMs(mount({}).container)).toContain('3200ms')
})
test('extra_time x slow_mo window', () => {
  const { container } = mount({ upgrades: ['extra_time'], powerUp: 'slow_mo' })
  expect(timerMs(container)).toContain('5520ms')
  adv(5519)
  expect(screen.queryByRole('img', { name: 'Missed' })).toBeNull()
  adv(2)
  expect(screen.getByRole('img', { name: 'Missed' })).toBeInTheDocument()
})

test('per-micro upgrades reach the microgame: easier, slow_start and calm_start levels', () => {
  const seen: Record<string, { level: number; easier?: boolean }> = {}
  const probe = (key: string): Micro => ({ key, name: key, cmd: 'X!', Component: (p) => { seen[key] = { level: p.level, easier: p.easier }; return <div>p-{key}</div> } })
  mount({ startLevel: 3, upgrades: ['calm_start'], microUpgrades: { a: ['steady', 'slow_start'] } }, [probe('a'), probe('b')])
  const key = screen.getByText(/^p-/).textContent!.slice(2)
  expect(seen[key]).toEqual(key === 'a' ? { level: 1, easier: true } : { level: 2, easier: false })
})
