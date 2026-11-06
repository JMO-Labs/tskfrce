import { beforeEach, describe, expect, jest, test } from '@jest/globals'
import { renderHook } from '@testing-library/react'
import { detect, submitEvent, useCelebrationTriggers, type Track } from '@/v2/kid/celebrate/triggers'
import type { KidChore, KidToday } from '@/v2/types'

const chore = (id: number, state: KidChore['state'], over: Partial<KidChore> = {}): KidChore => ({ id, title: `C${id}`, points: 10, state, ...over })
const today = (chores: KidChore[], over: Partial<KidToday> = {}): KidToday => ({
  locked: false,
  points_balance: 50,
  age_group: 'kid',
  locks_at: null,
  chores,
  progress: { level: 2, title: 'Helper', xp: 10, floor: 0, next: 100, streak: 2 },
  ...over,
})
const kinds = (t: { events: { kind: string }[] }) => t.events.map((e) => e.kind)

describe('detect', () => {
  test('first ever look seeds silently (no old approvals replayed)', () => {
    const r = detect(null, today([chore(1, 'done')]))
    expect(r.events).toEqual([])
  })

  test('needs_you -> done fires one approval, once', () => {
    const a = detect(null, today([chore(1, 'needs_you')]))
    const b = detect(a.next, today([chore(1, 'done', { points_now: 20 })]))
    expect(kinds(b)).toEqual(['approve'])
    expect(b.events[0].points).toBe(20)
    expect(detect(b.next, today([chore(1, 'done')])).events).toEqual([])
  })

  test('an approval made while away plays on the next open (stored track)', () => {
    const before = detect(null, today([chore(1, 'needs_you')])).next
    const stored: Track = JSON.parse(JSON.stringify(before)) // device-local round trip
    expect(kinds(detect(stored, today([chore(1, 'done')])))).toEqual(['approve'])
  })

  test('own submit that auto-approves does not fire a second time', () => {
    const a = detect(null, today([chore(1, 'todo')]))
    const { next } = submitEvent(a.next, chore(1, 'todo'), today([chore(1, 'todo')]))
    expect(detect(next, today([chore(1, 'done')])).events).toEqual([])
  })

  test('a race chore a sibling took is not ours to celebrate', () => {
    const a = detect(null, today([chore(1, 'needs_you')]))
    expect(detect(a.next, today([chore(1, 'done', { taken_by: 'Mia' })])).events).toEqual([])
  })

  test('Happy Hour start fires once per Happy Hour', () => {
    const hh = { ends_at: '2026-11-06T17:00:00Z', multiplier: 2 }
    const a = detect(null, today([]))
    const b = detect(a.next, today([], { happy_hour: hh }))
    expect(kinds(b)).toEqual(['happy_hour'])
    expect(detect(b.next, today([], { happy_hour: hh })).events).toEqual([])
    const c = detect(b.next, today([], { happy_hour: { ...hh, ends_at: '2026-11-07T17:00:00Z' } }))
    expect(kinds(c)).toEqual(['happy_hour'])
  })

  test.each([3, 7, 14, 30])('streak milestone %i fires once', (n) => {
    const p = (streak: number) => ({ progress: { level: 2, title: 'H', xp: 0, floor: 0, next: 1, streak } })
    const a = detect(null, today([], p(n - 1)))
    const b = detect(a.next, today([], p(n)))
    expect(kinds(b)).toEqual(['streak'])
    expect(b.events[0].big).toBe(true)
    expect(detect(b.next, today([], p(n))).events).toEqual([])
  })

  test('non-milestone streak is quiet', () => {
    const a = detect(null, today([], { progress: { level: 2, title: 'H', xp: 0, floor: 0, next: 1, streak: 4 } }))
    expect(detect(a.next, today([], { progress: { level: 2, title: 'H', xp: 0, floor: 0, next: 1, streak: 5 } })).events).toEqual([])
  })

  test('level up is a big moment, once', () => {
    const a = detect(null, today([]))
    const b = detect(a.next, today([], { progress: { level: 3, title: 'Hero', xp: 0, floor: 0, next: 1, streak: 2 } }))
    expect(kinds(b)).toEqual(['level'])
    expect(b.events[0].big).toBe(true)
  })
})

describe('submitEvent', () => {
  test('first chore of a Happy Hour is big, the second is not', () => {
    const hh = { ends_at: '2026-11-06T17:00:00Z', multiplier: 2 }
    const d = today([chore(1, 'todo'), chore(2, 'todo')], { happy_hour: hh })
    const t0 = detect(null, d).next
    const a = submitEvent(t0, chore(1, 'todo', { points_now: 20 }), d)
    expect(a.event.big).toBe(true)
    expect(a.event.points).toBe(20)
    expect(submitEvent(a.next, chore(2, 'todo'), d).event.big).toBeFalsy()
  })
})

describe('useCelebrationTriggers', () => {
  beforeEach(() => localStorage.clear())

  test('each event fires once across re-renders, and the stored track carries to the next open', () => {
    const fire = jest.fn()
    const d1 = today([chore(1, 'needs_you')])
    const { unmount } = renderHook(({ d }) => useCelebrationTriggers(d, 3, fire, true), { initialProps: { d: d1 } })
    expect(fire).not.toHaveBeenCalled()
    unmount()
    // parent approves while the app is closed; next open:
    const d2 = today([chore(1, 'done')])
    const h = renderHook(({ d }) => useCelebrationTriggers(d, 3, fire, true), { initialProps: { d: d2 } })
    expect(fire).toHaveBeenCalledTimes(1)
    h.rerender({ d: { ...d2 } })
    h.rerender({ d: { ...d2 } })
    expect(fire).toHaveBeenCalledTimes(1)
  })

  test('the kid tap fires a submit once', () => {
    const fire = jest.fn()
    const d = today([chore(1, 'todo')])
    const { result, rerender } = renderHook(({ d }) => useCelebrationTriggers(d, 3, fire, true), { initialProps: { d } })
    result.current(d.chores[0])
    expect(fire).toHaveBeenCalledTimes(1)
    expect((fire.mock.calls[0][0] as { kind: string }).kind).toBe('submit')
    rerender({ d: today([chore(1, 'done')]) })
    expect(fire).toHaveBeenCalledTimes(1)
  })

  test('disabled (parent preview) never fires', () => {
    const fire = jest.fn()
    const { result } = renderHook(() => useCelebrationTriggers(today([chore(1, 'todo')]), 3, fire, false))
    result.current(chore(1, 'todo'))
    expect(fire).not.toHaveBeenCalled()
  })
})
