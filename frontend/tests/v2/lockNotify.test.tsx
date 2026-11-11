import { expect, test, jest } from '@jest/globals'
import { renderHook } from '@testing-library/react'
import { lockNote, useLockNotify } from '@/v2/kid/lockNotify'
import type { KidToday } from '@/v2/types'

const chore = (id: number, state: string) => ({ id, state }) as unknown as KidToday['chores'][number]
const day = (extra: Partial<KidToday> = {}): KidToday =>
  ({ locked: false, chores: [], homework: null, ...extra }) as unknown as KidToday

function spy() {
  const made: { title: string; body?: string }[] = []
  const clicks: (() => void)[] = []
  ;(window as unknown as { Notification: unknown }).Notification = Object.assign(
    function (this: { onclick?: () => void; close: () => void }, title: string, o?: { body?: string }) {
      made.push({ title, body: o?.body })
      this.close = () => {}
      clicks.push(() => this.onclick?.())
    },
    { permission: 'granted' },
  )
  return { made, clicks }
}

test('lockNote: reason and what unlocks it', () => {
  expect(lockNote(day({ locked: true, chores: [chore(1, 'todo'), chore(2, 'todo'), chore(3, 'approved')] }))?.body).toMatch(/2 chores left/)
  expect(lockNote(day({ locked: true, chores: [chore(1, 'todo')] }))?.body).toMatch(/1 chore left/)
  expect(lockNote(day({ locked: true, chores: [chore(1, 'approved')] }))?.body).toMatch(/allowed hours/)
  expect(lockNote(day())).toBeNull()
})

test('one notification per lock; none when the reason is unchanged; again after unlock', () => {
  const { made, clicks } = spy()
  const open = jest.fn()
  const two = [chore(1, 'todo'), chore(2, 'todo')]
  const { rerender } = renderHook(({ d }) => useLockNotify(d, open), { initialProps: { d: day({ chores: two }) } })
  expect(made).toHaveLength(0)
  rerender({ d: day({ locked: true, chores: two }) })
  expect(made).toHaveLength(1)
  rerender({ d: day({ locked: true, chores: two }) }) // next poll, same lock
  expect(made).toHaveLength(1)
  rerender({ d: day({ locked: true, chores: [chore(1, 'todo'), chore(2, 'approved')] }) }) // reason text changed
  expect(made).toHaveLength(1)
  rerender({ d: day({ chores: two }) }) // unlocked
  rerender({ d: day({ locked: true, chores: two }) })
  expect(made).toHaveLength(2)
  clicks[1]()
  expect(open).toHaveBeenCalled()
})

test('already locked on load is not news; no permission, no pop', () => {
  const { made } = spy()
  renderHook(() => useLockNotify(day({ locked: true }), () => {}))
  expect(made).toHaveLength(0)
  ;(window.Notification as unknown as { permission: string }).permission = 'denied'
  const { rerender } = renderHook(({ d }) => useLockNotify(d, () => {}), { initialProps: { d: day() } })
  rerender({ d: day({ locked: true }) })
  expect(made).toHaveLength(0)
})
