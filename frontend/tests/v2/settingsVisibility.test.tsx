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
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
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
beforeEach(() => fakeRouter.reset('/x', { open: 'details' }))
const serve = (map: Record<string, unknown>) => apiMock.mockReset().mockImplementation(async (p) => map[p] ?? {})

describe('screen time pane (item 4)', () => {
  test('off: only the switch and a hint show', async () => {
    serve({ '/screen-time': st() })
    wrap(<ScreenTimePane />)
    const sw = await screen.findByRole('switch', { name: /kids can buy extra minutes/i })
    expect(sw).not.toBeChecked()
    for (const n of [/^Price/, /^Max per day/, /^Approve automatically/, /^Only during allowed hours/]) expect(screen.queryByRole('button', { name: n })).toBeNull()
    for (const t of ['Rules', 'Kids']) expect(screen.queryByText(t)).toBeNull()
    expect(screen.getByText('Turn this on to let kids spend points on extra internet time.')).toBeTruthy()
    for (const t of ['20 pts = 15 min', 'Max 60 min/day']) expect(screen.queryByText(t)).toBeNull()
  })
  test('turning it on sends enabled: true', async () => {
    serve({ '/screen-time': st() })
    wrap(<ScreenTimePane />)
    await userEvent.click(await screen.findByRole('switch', { name: /kids can buy extra minutes/i }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/screen-time', { method: 'PATCH', body: { enabled: true } }))
  })
  test('on: one line per rule keeps its value', async () => {
    serve({ '/screen-time': st({ enabled: true, price: 35, max_minutes_per_day: 60 }) })
    wrap(<ScreenTimePane />)
    expect(await screen.findByRole('button', { name: /^Price.*35 pts = 15 min/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Max per day.*60 min/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /^Approve automatically.*Off/ })).toBeTruthy()
    expect(screen.getByRole('switch', { name: /kids can buy extra minutes/i })).toBeChecked()
    for (const n of ['What points buy', 'Bought today', 'Per-kid limits']) expect(screen.queryByRole('region', { name: n })).toBeNull()
  })
})

describe('notifications pane (item 6)', () => {
  const mount = (quiet: object, places: object[] = [place]) => {
    serve({ '/notify/places': places, '/notify/settings': { ...notify, ...quiet } })
    wrap(<NotificationsPane />)
  }
  test('security toggle only when quiet hours on', async () => {
    fakeRouter.reset('/settings', { section: 'notifications', open: 'quiet' })
    mount({})
    await screen.findByRole('switch', { name: 'Quiet hours' })
    expect(screen.queryByRole('switch', { name: 'Security alerts still send' })).toBeNull()
  })
  test('security toggle shows when on', async () => {
    fakeRouter.reset('/settings', { section: 'notifications', open: 'quiet' })
    mount({ quiet_start: '21:30', quiet_end: '07:00' })
    expect(await screen.findByRole('switch', { name: 'Security alerts still send' })).toBeTruthy()
  })
  test('App address is a row that opens to its help text', async () => {
    mount({})
    await userEvent.click(await screen.findByRole('button', { name: /App address/ }))
    expect(await screen.findByText('Leave blank to use http://chores.local.')).toBeTruthy()
  })
  test('no quiet card without places', async () => {
    mount({}, [])
    await screen.findByText('No places yet')
    expect(screen.queryByRole('button', { name: /Quiet hours/ })).toBeNull()
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
  test('Family opens calm: four-row values are lines, no fields, no Network', () => {
    fakeRouter.reset('/settings', { section: 'family' })
    wrap(<FamilyCard fam={fam()} />)
    expect(screen.getByRole('button', { name: /^Household/ })).toBeTruthy()
    expect(screen.getByText('S · UTC time · day resets 6:00 AM')).toBeTruthy()
    expect(screen.getByText('No auto-approve · Recap on')).toBeTruthy()
    expect(screen.getByText('Early bonus up to 5 pts · Streak freezes off')).toBeTruthy()
    expect(screen.queryByLabelText('Early finish bonus cap')).toBeNull()
    expect(screen.queryByLabelText('Family name')).toBeNull()
    expect(screen.queryByText(/Network|Block new devices/)).toBeNull()
  })
  test('Points rules opens from ?open=pts and holds the cap', () => {
    fakeRouter.reset('/settings', { section: 'family', open: 'pts' })
    wrap(<FamilyCard fam={fam()} />)
    expect(screen.getByLabelText('Early finish bonus cap')).toHaveValue('5')
    expect(screen.queryByLabelText('Family name')).toBeNull()
  })
  test('a blank family name is not saved and says why; a bonus cap over 50 is not saved', async () => {
    fakeRouter.reset('/settings', { section: 'family', open: 'hh' })
    serve({})
    const { unmount } = wrap(<FamilyCard fam={fam()} />)
    await userEvent.clear(screen.getByLabelText('Family name'))
    await userEvent.tab()
    expect(screen.getByText('Give your family a name.')).toBeTruthy()
    unmount()
    fakeRouter.reset('/settings', { section: 'family', open: 'pts' })
    wrap(<FamilyCard fam={fam()} />)
    await userEvent.clear(screen.getByLabelText('Early finish bonus cap'))
    await userEvent.type(screen.getByLabelText('Early finish bonus cap'), '99')
    await userEvent.tab()
    expect(screen.getByText('Must be 50 or less.')).toBeTruthy()
    expect(apiMock.mock.calls.filter((c) => (c as unknown[])[1])).toEqual([])
  })
  test('an unknown ?open row is dropped', () => {
    fakeRouter.reset('/settings', { section: 'family', open: 'net' })
    wrap(<FamilyCard fam={fam()} />)
    expect(fakeRouter.replace).toHaveBeenCalled()
    expect(fakeRouter.query.open).toBeUndefined()
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
    await userEvent.click(screen.getByRole('button', { name: 'About always allowed' }))
    await waitFor(() => expect(screen.getByText("For a kid's device that should skip hours and chores, like a school laptop. A manual lock still applies.")).toBeTruthy())
  })
})
