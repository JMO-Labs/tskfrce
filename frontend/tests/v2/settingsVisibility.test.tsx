import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import type { ReactNode } from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { ScreenTimePane } from '@/v2/manage/ScreenTimePane'
import { NotificationsPane } from '@/v2/manage/NotificationsPane'
import { FamilyCard, GifsCard } from '@/v2/manage/FamilyCards'
import { DeviceDetail } from '@/v2/manage/DeviceDetail'
import type { Device, Family } from '@/v2/types'

jest.mock('next/router', () => ({ useRouter: () => ({ query: {}, push: jest.fn(), replace: jest.fn() }) }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))

const apiMock = api as unknown as Mock<(p: string) => Promise<unknown>>
const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  )
const st = (o: object = {}) => ({ reset_time: '06:00', enabled: false, price: 20, max_minutes_per_day: 60, group_pricing: false, auto_approve: false, only_in_allowed_hours: false, kids: [], options: [], bought: [], ...o })
const fam = (o: object = {}) =>
  ({ name: 'S', timezone: 'UTC', reset_time: '06:00', new_devices_blocked: true, points_unlock_early: false, early_bonus_cap: 5, screen_time_price: 20, gifs_enabled: false, gif_rating: 'g', giphy_key_set: true, ntfy_upstream_relay: false, ...o }) as Family
const notify = { quiet_start: null, quiet_end: null, quiet_security: true, app_address: 'http://x', app_address_default: 'http://chores.local', events: [] }
const place = { id: 1, name: 'P', url_mask: 'x', enabled: true, events: [], readable: true }
const dev = (o: Partial<Device> = {}): Device => ({ id: 1, name: 'Tablet', mac: 'aa:bb:cc:dd:ee:01', vendor: null, status: 'assigned', owner_ids: [], group_ids: [], online: false, override: null, last_seen: null, resisting: false, exempt: false, reason: 'chores', chores_done: 0, chores_total: 0, locks_at: null, alerts: 0, address_changes: 0, ...o })

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  global.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})
const serve = (map: Record<string, unknown>) => apiMock.mockReset().mockImplementation(async (p) => map[p] ?? {})

describe('screen time pane (item 4)', () => {
  test('off: only the switch shows', async () => {
    serve({ '/screen-time': st() })
    wrap(<ScreenTimePane />)
    await screen.findByRole('switch', { name: 'Kids can buy extra minutes' })
    for (const n of ['Price (points per 15 min)', 'Max per day']) expect(screen.queryByLabelText(n)).toBeNull()
    for (const n of ['Different prices for device groups', 'Approve automatically', 'Only during allowed hours']) expect(screen.queryByRole('switch', { name: n })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Per-kid limits' })).toBeNull()
    expect(screen.getByText('Turn this on to let kids spend points on extra internet time.')).toBeTruthy()
    expect(screen.getByText('Off')).toBeTruthy() // header: the On/Off chip only
    for (const t of ['20 pts = 15 min', 'Max 60 min/day']) expect(screen.queryByText(t)).toBeNull()
  })
  test('hidden values come back unchanged after off then on', async () => {
    serve({ '/screen-time': st({ enabled: true, price: 35 }) })
    wrap(<ScreenTimePane />)
    const sw = await screen.findByRole('switch', { name: 'Kids can buy extra minutes' })
    await userEvent.click(sw)
    expect(screen.queryByLabelText('Price (points per 15 min)')).toBeNull()
    await userEvent.click(sw)
    expect(screen.getByLabelText('Price (points per 15 min)')).toHaveValue('35')
  })
  test('on: fields show and keep their values', async () => {
    serve({ '/screen-time': st({ enabled: true, price: 35, max_minutes_per_day: 60 }) })
    wrap(<ScreenTimePane />)
    expect(await screen.findByLabelText('Price (points per 15 min)')).toHaveValue('35')
    expect(screen.getByLabelText('Max per day')).toHaveValue('60')
    expect(screen.getByRole('switch', { name: 'Approve automatically' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Per-kid limits' })).toBeTruthy()
    for (const t of ['On', '35 pts = 15 min', 'Max 60 min/day']) expect(screen.getByText(t)).toBeTruthy()
  })
})

describe('notifications pane (item 6)', () => {
  const mount = (quiet: object, places: object[] = [place]) => {
    serve({ '/notify/places': places, '/notify/settings': { ...notify, ...quiet } })
    wrap(<NotificationsPane />)
  }
  test('security toggle only when quiet hours on', async () => {
    mount({})
    await screen.findByRole('switch', { name: 'Quiet hours' })
    expect(screen.queryByRole('switch', { name: 'Security alerts still send' })).toBeNull()
  })
  test('security toggle shows when on', async () => {
    mount({ quiet_start: '21:30', quiet_end: '07:00' })
    expect(await screen.findByRole('switch', { name: 'Security alerts still send' })).toBeTruthy()
  })
  test('App address is in a closed Advanced fold with help text', async () => {
    mount({})
    const sum = await screen.findByText('Advanced')
    expect(sum.closest('details')?.open).toBe(false)
    expect(screen.getByText('Leave blank to use http://chores.local.')).toBeTruthy()
  })
  test('no quiet card without places', async () => {
    mount({}, [])
    await screen.findByText('No places yet')
    expect(screen.queryByRole('region', { name: 'Quiet hours' })).toBeNull()
  })
})

describe('family cards (items 7, 8)', () => {
  test('GIFs off: hint only, fields hidden', () => {
    wrap(<GifsCard fam={fam()} />)
    expect(screen.getByText('Off. Turn on to search GIFs in chat (needs a free GIPHY key).')).toBeTruthy()
    expect(screen.queryByLabelText('GIPHY key')).toBeNull()
    expect(screen.queryByLabelText('GIF rating')).toBeNull()
  })
  test('GIFs on: fields shown, hint gone', () => {
    wrap(<GifsCard fam={fam({ gifs_enabled: true })} />)
    expect(screen.getByLabelText('GIPHY key')).toBeTruthy()
    expect(screen.queryByText(/^Off\. Turn on/)).toBeNull()
  })
  test('Early finish bonus cap sits in a closed Points rules fold', () => {
    wrap(<FamilyCard fam={fam()} />)
    const d = screen.getByText('Points rules').closest('details')!
    expect(d.open).toBe(false)
    expect(d.contains(screen.getByLabelText('Early finish bonus cap'))).toBe(true)
    expect(screen.queryByRole('heading', { name: 'Points' })).toBeNull() // the fold already names it
  })
})

describe('device detail (item 11)', () => {
  test('guest has no Always allowed', () => {
    serve({})
    wrap(<DeviceDetail device={dev({ status: 'guest' })} kids={[]} onRequestOverride={() => {}} />)
    expect(screen.queryByRole('switch', { name: /Always allowed/ })).toBeNull()
  })
  test('non-guest has it, with the new hint', async () => {
    serve({})
    wrap(<DeviceDetail device={dev()} kids={[]} onRequestOverride={() => {}} />)
    expect(screen.getByRole('switch', { name: /Always allowed/ })).toBeTruthy()
    await waitFor(() => expect(screen.getByText("For a kid's device that should skip hours and chores, like a school laptop. A manual lock still applies.")).toBeTruthy())
  })
})
