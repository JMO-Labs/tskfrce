import { expect, test } from '@jest/globals'
import { readFileSync } from 'fs'
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
  const L = (x: Partial<KidToday>) => day({ locked: true, ...x })
  expect(lockNote(L({ lock_reason: 'manual', chores: [chore(1, 'todo')] }))).toMatchObject({ kind: 'manual', body: 'A parent paused it' })
  expect(lockNote(L({ lock_reason: 'manual', lock_until: '2026-01-01T17:00:00Z', timezone: 'UTC' }))?.body).toMatch(/paused it until .*5:00/)
  expect(lockNote(L({ lock_reason: 'schedule', chores: [chore(1, 'todo')] }))?.body).toMatch(/allowed hours/)
  expect(lockNote(L({ lock_reason: 'penalty' }))?.kind).toBe('penalty')
  expect(lockNote(L({ lock_reason: 'new_device' }))?.body).toMatch(/approve/)
  expect(lockNote(L({ lock_reason: 'chores' }))?.body).toMatch(/Finish your chores/)
  expect(lockNote(day({ locked: true, lock_reason: 'chores', chores: [chore(1, 'todo'), chore(2, 'todo'), chore(3, 'approved')] }))?.body).toMatch(/2 chores left/)
  expect(lockNote(day({ locked: true, lock_reason: 'chores', chores: [chore(1, 'todo')] }))?.body).toMatch(/1 chore left/)
  expect(lockNote(day())).toBeNull()
})

test('one notification per lock; none when the reason is unchanged; again after unlock', () => {
  const { made, clicks } = spy()
  const open = jest.fn()
  const two = [chore(1, 'todo'), chore(2, 'todo')]
  const { rerender } = renderHook(({ d }) => useLockNotify(d, open), { initialProps: { d: day({ chores: two }) } })
  expect(made).toHaveLength(0)
  rerender({ d: day({ locked: true, lock_reason: 'chores', chores: two }) })
  expect(made).toHaveLength(1)
  rerender({ d: day({ locked: true, lock_reason: 'chores', chores: two }) }) // next poll, same lock
  expect(made).toHaveLength(1)
  rerender({ d: day({ locked: true, lock_reason: 'chores', chores: [chore(1, 'todo'), chore(2, 'approved')] }) }) // reason text changed
  expect(made).toHaveLength(1)
  rerender({ d: day({ chores: two }) }) // unlocked
  rerender({ d: day({ locked: true, lock_reason: 'chores', chores: two }) })
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

const lock = (r = 'manual') => day({ locked: true, lock_reason: r })

test('uses the service worker registration when available', async () => {
  spy()
  const showNotification = jest.fn(() => Promise.resolve())
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { ready: Promise.resolve({ showNotification }) } })
  const { rerender } = renderHook(({ d }) => useLockNotify(d, () => {}), { initialProps: { d: day() } })
  rerender({ d: day() })
  rerender({ d: lock() })
  await Promise.resolve()
  await Promise.resolve()
  expect(showNotification).toHaveBeenCalledWith('Internet is paused', expect.objectContaining({ tag: 'lock', data: { url: '/kid' } }))
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: undefined })
})

test('a throwing Notification constructor does not crash', () => {
  ;(window as unknown as { Notification: unknown }).Notification = Object.assign(
    function () {
      throw new TypeError('Illegal constructor')
    },
    { permission: 'granted' },
  )
  const { rerender } = renderHook(({ d }) => useLockNotify(d, () => {}), { initialProps: { d: day() } })
  rerender({ d: day() })
  expect(() => rerender({ d: lock() })).not.toThrow()
})

test('sw notificationclick closes and focuses/opens /kid', async () => {
  const src = readFileSync('public/sw.js', 'utf8')
  const handlers: Record<string, (e: unknown) => void> = {}
  const openWindow = jest.fn(() => Promise.resolve())
  const focus = jest.fn(() => Promise.resolve())
  let clients: { url: string; focus: () => unknown }[] = []
  const self = {
    addEventListener: (n: string, f: (e: unknown) => void) => (handlers[n] = f),
    clients: { matchAll: () => Promise.resolve(clients), openWindow },
  }
  new Function('self', 'caches', src)(self, {})
  const click = async () => {
    let p: Promise<unknown> = Promise.resolve()
    const close = jest.fn()
    handlers.notificationclick({ notification: { close, data: { url: '/kid' } }, waitUntil: (x: Promise<unknown>) => (p = x) })
    await p
    expect(close).toHaveBeenCalled()
  }
  await click()
  expect(openWindow).toHaveBeenCalledWith('/kid')
  clients = [{ url: 'https://x/kid', focus }]
  await click()
  expect(focus).toHaveBeenCalled()
})
