import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { fridgeTheme } from '@/v2/theme'
import { api } from '@/v2/api'
import { DeviceDetail } from '@/v2/manage/DeviceDetail'
import { deviceMenu } from '@/v2/manage/DeviceHead'
import type { Device, DeviceEvent, Group, Kid } from '@/v2/types'
import { markGuideSeen } from '@/v2/manage/phoneGuideStore'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn(), hide: jest.fn() } }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))

const apiMock = api as unknown as Mock<(p: string, o?: { method?: string; body?: unknown }) => Promise<unknown>>
const kids: Kid[] = [{ id: 7, full_name: 'Maya', username: 'kid-maya', avatar: null, has_pin: true }]
const groups: Group[] = [{ id: 3, name: 'Phones', device_ids: [12] } as Group]
const dev = (over: Partial<Device> = {}): Device => ({
  id: 12, name: 'Maya iPhone', mac: 'aa:bb:cc:dd:ee:01', vendor: null, status: 'assigned', owner_ids: [7],
  group_ids: [3], online: true, override: null, last_seen: null, seen_now: true, resisting: false,
  exempt: false, reason: 'schedule', chores_done: 0, chores_total: 0, locks_at: '2026-10-26T20:00:00Z', alerts: 2, ip: '192.168.1.12',
  ...over,
})
const ev = (o: Partial<DeviceEvent>): DeviceEvent => ({
  id: 1, kind: 'bypass', at: '2026-10-26T20:00:00Z', last_at: null, count: 1, reason: null, kid_id: null,
  kid_name: null, by_name: null, other_device_name: null, other_device_id: null, minutes: null, detail: '', reviewed: false, ...o,
})
const day = (date: string) => ({ date, slots: '.'.repeat(144), online_minutes: 200 })
const days = ['2026-10-26', '2026-10-25', '2026-10-24', '2026-10-23', '2026-10-22', '2026-10-21', '2026-10-20'].map(day)
let events: DeviceEvent[]
const lock = jest.fn()

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MantineProvider theme={fridgeTheme}>{ui}</MantineProvider>
  </QueryClientProvider>
)
const show = (d: Device, query: Record<string, string> = {}) => {
  fakeRouter.reset('/devices', { item: String(d.id), ...query })
  return render(wrap(<DeviceDetail device={d} kids={kids} groups={groups} onRequestOverride={lock} />))
}
/** menu item labels, in order (the icon's ligature text is not part of the label) */
const labels = async () => (await screen.findAllByRole('menuitem')).map((m) => m.textContent?.replace(/^[a-z_]+(?=[A-Z])/, ''))
const row = (name: RegExp) => screen.getByRole('button', { name })

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  global.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
  Element.prototype.scrollIntoView = jest.fn()
})
beforeEach(() => {
  lock.mockClear()
  jest.mocked(notifications.show).mockClear()
  events = []
  apiMock.mockReset().mockImplementation(async (path) => {
    if (path === '/family') return { timezone: 'America/New_York', new_devices_blocked: false }
    if (path === '/blocker') return { online: true }
    if (path.endsWith('/activity')) return { counts: {}, events, history: [], days }
    return {}
  })
})

describe('device detail, calm', () => {
  test('one status chip and one main action', async () => {
    const { unmount } = show(dev())
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'Lock now' })).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /Unlock 30 min/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Lock now' }))
    expect(lock).toHaveBeenCalledWith({ kind: 'device', id: 12, action: 'lock' })
    unmount()
    show(dev({ online: false }))
    expect(screen.getAllByText('Locked')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: 'Lock now' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Unlock 30 min/ }))
    expect(lock).toHaveBeenLastCalledWith({ kind: 'device', id: 12, action: 'unlock' })
  })

  test('got around the lock chip pop-over links to Activity', async () => {
    show(dev({ resisting: true }))
    expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Got around the lock/ }))
    await userEvent.click(await screen.findByRole('button', { name: /See activity/ }))
    expect(fakeRouter.query.open).toBe('activity')
  })

  test('the menu has Test block, Rename, Delete; Back to schedule and homework only when locked', async () => {
    const { unmount } = show(dev())
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(await labels()).toEqual(['Test block', 'Rename', 'Delete'])
    unmount()
    show(dev({ override: { action: 'lock', expires_at: null } as Device['override'] }))
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(await labels()).toEqual([
      'Test block', 'Rename', 'Back to schedule',
      'Homework 30 min', 'Homework 1 hour', 'Homework 90 min', 'Homework 2 hours',
      'Delete',
    ])
  })

  test('Rename opens Details and focuses Name', async () => {
    show(dev())
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rename' }))
    expect(fakeRouter.query.open).toBe('details')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Device name' })))
  })

  test('four rows with summaries; Activity line has week bars', async () => {
    show(dev())
    await waitFor(() => expect(row(/^Right now/).textContent).toMatch(/Open · locks at 4:00\s?PM/))
    expect(row(/^Details/).textContent).toContain('Maya · Phones')
    expect(row(/^Network/).textContent).toContain('192.168.1.12')
    expect(row(/^Activity/).textContent).toContain('2 alerts this week')
    expect(await screen.findByText(/Online ~3 h a day/)).toBeTruthy()
    const bars = screen.getByRole('button', { name: 'Online by hour' }) // the week bars are the trigger
    expect(bars.querySelectorAll('i')).toHaveLength(7)
  })

  test('owners use KidPicker and save on change with Saved toast', async () => {
    show(dev({ owner_ids: [], status: 'unassigned' }), { open: 'details' })
    const owners = screen.getByRole('group', { name: 'Owners' })
    await userEvent.click(within(owners).getByRole('button', { name: 'Maya' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/12', { method: 'PATCH', body: { owner_ids: [7] } }))
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Saved' })))
  })

  test('a name blur during another save is saved after it, not dropped', async () => {
    let release = () => {}
    apiMock.mockImplementation(async (_p, o) => {
      if (o?.method === 'PATCH' && (o.body as { owner_ids?: number[] }).owner_ids) await new Promise<void>((r) => (release = r))
      return {}
    })
    show(dev({ owner_ids: [], status: 'unassigned' }), { open: 'details' })
    await userEvent.click(within(screen.getByRole('group', { name: 'Owners' })).getByRole('button', { name: 'Maya' }))
    const name = screen.getByLabelText('Device name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Den iPad')
    await userEvent.tab()
    release()
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/12', { method: 'PATCH', body: { name: 'Den iPad' } }))
  })

  test('the phone guide opens only after the first owner is saved', async () => {
    localStorage.clear()
    let release = () => {}
    apiMock.mockImplementation(async (_p, o) => {
      if (o?.method === 'PATCH') await new Promise<void>((r) => (release = r))
      return {}
    })
    show(dev({ owner_ids: [], status: 'unassigned' }), { open: 'details' })
    await userEvent.click(within(screen.getByRole('group', { name: 'Owners' })).getByRole('button', { name: 'Maya' }))
    expect(screen.queryByText('Keep this phone on the box')).toBeNull() // still saving: the page stays usable
    release()
    expect(await screen.findByText('Keep this phone on the box')).toBeTruthy()
  })

  test('the phone guide stays closed when already seen', async () => {
    localStorage.clear()
    markGuideSeen(12)
    show(dev({ owner_ids: [], status: 'unassigned' }), { open: 'details' })
    await userEvent.click(within(screen.getByRole('group', { name: 'Owners' })).getByRole('button', { name: 'Maya' }))
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Saved' })))
    expect(screen.queryByText('Keep this phone on the box')).toBeNull()
  })

  test('the phone guide stays closed when saving the owner fails', async () => {
    localStorage.clear()
    apiMock.mockImplementation(async (_p, o) => { if (o?.method === 'PATCH') throw new Error('nope'); return {} })
    show(dev({ owner_ids: [], status: 'unassigned' }), { open: 'details' })
    await userEvent.click(within(screen.getByRole('group', { name: 'Owners' })).getByRole('button', { name: 'Maya' }))
    await waitFor(() => expect(notifications.show).toHaveBeenCalled())
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByText('Keep this phone on the box')).toBeNull()
  })

  test('unknown open value shows calm', async () => {
    show(dev(), { open: 'bogus' })
    await waitFor(() => expect(fakeRouter.replace).toHaveBeenCalled())
    expect(fakeRouter.query.open).toBeUndefined()
    expect(screen.queryByRole('region', { name: /Right now|Details|Network|Activity/ })).toBeNull() // no open row (the Device area itself is a group)
  })

  test('unassigned device opens Details by default', async () => {
    show(dev({ owner_ids: [], status: 'unassigned', group_ids: [] }))
    await waitFor(() => expect(fakeRouter.query.open).toBe('details'))
    expect(fakeRouter.replace).toHaveBeenCalled()
    expect(fakeRouter.push).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Open' })).toBeTruthy()
    expect(row(/^Details/).textContent).toMatch(/No owner yet/)
  })

  test('alerts are action rows with extra actions in …', async () => {
    events = [ev({ id: 11, kind: 'locked_try', reason: 'chores', count: 3, kid_id: 7, kid_name: 'Maya' })]
    show(dev(), { open: 'activity' })
    const feed = await screen.findByRole('region', { name: 'Attempts & alerts' })
    const li = await within(feed).findByRole('listitem')
    expect(within(li).getByRole('button', { name: 'Mark OK' })).toBeTruthy()
    expect(within(li).queryByRole('button', { name: 'Ask Maya' })).toBeNull()
    await userEvent.click(within(li).getByRole('button', { name: 'More' }))
    expect(await labels()).toEqual(['Ask Maya', "Lock all Maya's devices"])
  })
})

describe('device menu', () => {
  const o = { testing: false, hasOverride: false, onTest: () => {}, onRename: () => {}, onSchedule: () => {}, onDelete: () => {} }
  test('Test block says Testing… and is off while it runs', () => {
    expect(deviceMenu(o)[0]).toMatchObject({ label: 'Test block', disabled: false })
    expect(deviceMenu({ ...o, testing: true })[0]).toMatchObject({ label: 'Testing…', disabled: true })
  })
  test('Rename takes focus; Back to schedule is hidden without an override', () => {
    expect(deviceMenu(o)[1]).toMatchObject({ label: 'Rename', takesFocus: true })
    expect(deviceMenu(o)[2].hidden).toBe(true)
    expect(deviceMenu({ ...o, hasOverride: true })[2].hidden).toBe(false)
  })
})

describe('daily hours', () => {
  test('under an hour a day reads "<1 h", never "~0 h"', async () => {
    const short = days.map((d) => ({ ...d, online_minutes: 10 }))
    apiMock.mockImplementation(async (path) => (path.endsWith('/activity') ? { counts: {}, events: [], history: [], days: short } : path === '/family' ? { timezone: 'UTC' } : {}))
    show(dev())
    expect(await screen.findByText('Online <1 h a day')).toBeTruthy()
  })
})
