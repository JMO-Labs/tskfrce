import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fridgeTheme } from '@/v2/theme'
import { api } from '@/v2/api'
import { DeviceDetail } from '@/v2/manage/DeviceDetail'
import type { Device, Kid } from '@/v2/types'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))

const apiMock = api as unknown as Mock<(p: string, o?: { method?: string; body?: unknown }) => Promise<unknown>>
const kids: Kid[] = [{ id: 7, full_name: 'Maya', username: 'kid-maya', avatar: null, has_pin: true }]
const dev = (over: Partial<Device> = {}): Device => ({
  id: 1, name: 'Tablet', mac: 'aa:bb:cc:dd:ee:01', vendor: null, status: 'assigned', owner_ids: [7],
  group_ids: [], online: false, override: null, last_seen: null, resisting: false,
  exempt: false, reason: 'chores', chores_done: 3, chores_total: 5, locks_at: '2026-10-26T20:00:00Z', alerts: 1, address_changes: 1,
  ...over,
})
const day = (date: string) => ({ date, slots: 'o'.repeat(20) + 'l'.repeat(20) + '.'.repeat(104), online_minutes: 200 })
const days = ['2026-10-26', '2026-10-25', '2026-10-24', '2026-10-23', '2026-10-22', '2026-10-21', '2026-10-20'].map(day)
let blocker = { online: true }

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MantineProvider theme={fridgeTheme}>{ui}</MantineProvider>
  </QueryClientProvider>
)
const show = (d: Device, open?: string) => {
  fakeRouter.reset('/devices', open ? { item: String(d.id), open } : { item: String(d.id) })
  return render(wrap(<DeviceDetail device={d} kids={kids} onRequestOverride={() => {}} />))
}

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  global.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
beforeEach(() => {
  blocker = { online: true }
  apiMock.mockReset().mockImplementation(async (path) => {
    if (path === '/family') return { timezone: 'America/New_York' }
    if (path === '/blocker') return blocker
    if (path.endsWith('/activity')) return { counts: {}, events: [], history: [], days }
    return {}
  })
})

describe('device rows', () => {
  test('Right now explains a blocked device and when it locks', () => {
    show(dev(), 'now')
    const right = screen.getByRole('region', { name: 'Right now' })
    expect(within(right).queryByText('Locked')).toBeNull() // the header chip says it, once
    expect(within(right).getByText('Chores 3/5 done')).toBeTruthy()
    expect(within(right).getByText('Locks at')).toBeTruthy()
    expect(within(right).getByText(/8:00\s?PM/)).toBeTruthy()
    expect(within(right).getByText('None · on schedule')).toBeTruthy()
  })

  test('an exempt device is Open, always allowed, with no lock time', () => {
    show(dev({ exempt: true, online: true, reason: 'exempt', locks_at: null }), 'now')
    const right = screen.getByRole('region', { name: 'Right now' })
    expect(within(right).queryByText('Open')).toBeNull()
    expect(within(right).getByText('Always allowed')).toBeTruthy()
    expect(within(right).queryByText('Locks at')).toBeNull()
  })

  test('Online by hour has 7 rows, Today first', async () => {
    show(dev())
    await userEvent.click(await screen.findByRole('button', { name: 'Online by hour' }))
    const week = await screen.findByRole('region', { name: 'Online this week' })
    await waitFor(() => expect(week.querySelectorAll('li')).toHaveLength(7))
    expect(week.querySelectorAll('li')[0].textContent).toMatch(/^Today/)
    expect(within(week).getByText('Sat')).toBeTruthy()
  })

  test('guest devices have no online-by-hour line', () => {
    show(dev({ status: 'guest' }))
    expect(screen.queryByRole('button', { name: 'Online by hour' })).toBeNull()
  })

  test('Right now says when the device was last seen', () => {
    show(dev({ seen_now: false, last_seen: null }), 'now')
    const right = screen.getByRole('region', { name: 'Right now' })
    expect(within(right).getByText('Last seen')).toBeTruthy()
    expect(within(right).getByText('never')).toBeTruthy()
  })

  test('Always allowed switch saves exempt', async () => {
    show(dev(), 'details')
    await userEvent.click(screen.getByRole('switch', { name: 'Always allowed (never lock)' }))
    expect(apiMock).toHaveBeenCalledWith('/devices/1', { method: 'PATCH', body: { exempt: true } })
  })

  test('Activity row carries the alert count', () => {
    show(dev())
    expect(screen.getByRole('button', { name: /^Activity/ }).textContent).toContain('1 alert this week')
  })
})

describe('device Network history rows', () => {
  const net = async (d: Device) => {
    show(d, 'network')
    return screen.getByRole('region', { name: 'Connection' })
  }

  test('shows address changes and a healthy hold', async () => {
    const c = await net(dev())
    expect(within(c).getByText('Address changes · 7 days')).toBeTruthy()
    expect(within(c).getByText('Resisting blocker')).toBeTruthy()
    expect(await within(c).findByText('Healthy')).toBeTruthy()
  })

  test('slipping when resisting, box offline when the blocker is down', async () => {
    const c = await net(dev({ resisting: true }))
    expect(await within(c).findByText('Slipping')).toBeTruthy()
    expect(within(c).getByText('Yes')).toBeTruthy()
  })

  test('box offline', async () => {
    blocker = { online: false }
    const c = await net(dev())
    expect(await within(c).findByText('Box offline')).toBeTruthy()
  })
})
