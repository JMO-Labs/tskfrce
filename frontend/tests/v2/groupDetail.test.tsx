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
import { GroupDetail } from '@/v2/manage/GroupDetail'
import { groupMenu } from '@/v2/manage/GroupHead'
import type { Device, Group, HourRule, Kid } from '@/v2/types'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn(), hide: jest.fn() } }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))

const apiMock = api as unknown as Mock<(p: string, o?: { method?: string; body?: unknown }) => Promise<unknown>>
const kids: Kid[] = [{ id: 7, full_name: 'Maya', username: 'kid-maya', avatar: null, has_pin: true }]
const dev = (id: number, name: string, over: Partial<Device> = {}): Device => ({
  id, name, mac: `aa:bb:cc:dd:ee:0${id}`, vendor: null, status: 'assigned', owner_ids: [7], group_ids: [], online: true, override: null,
  last_seen: null, seen_now: true, resisting: false, exempt: false, reason: 'schedule', chores_done: 0, chores_total: 0,
  locks_at: '2026-10-26T20:00:00Z', alerts: 0, ...over,
})
const devices = [dev(1, 'Maya iPad'), dev(2, 'Fire tablet', { online: false }), dev(3, 'Xbox', { owner_ids: [], status: 'guest' })]
const group: Group = { id: 3, name: 'Tablets', device_ids: [1, 2], owner_ids: [], icon: 'tablet_mac', chore_lock: true, screen_price: null }
const rule = { id: 1, name: 'School nights', everyone: true, kid_ids: [], group_ids: [], days: [0, 1, 2, 3], times: [{ start: '16:00', end: '20:00' }] } as unknown as HourRule
const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MantineProvider theme={fridgeTheme}>{ui}</MantineProvider>
  </QueryClientProvider>
)
const lock = jest.fn()
const show = (g: Group = group, query: Record<string, string> = {}) => {
  fakeRouter.reset('/devices', { tab: 'groups', item: String(g.id), ...query })
  return render(wrap(<GroupDetail group={g} devices={devices} kids={kids} rules={[rule]} onSelect={() => {}} onRequestOverride={lock} />))
}
const patches = () => apiMock.mock.calls.filter(([, o]) => o?.method === 'PATCH')

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  global.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
  Element.prototype.scrollIntoView = jest.fn()
})
beforeEach(() => {
  lock.mockClear()
  jest.mocked(notifications.show).mockClear()
  apiMock.mockReset().mockImplementation(async (path) => (path === '/screen-time' ? { enabled: true, price: 20, group_pricing: true } : path === '/family' ? { timezone: 'America/New_York' } : {}))
})

describe('group detail, calm', () => {
  test('header: one status chip with stats pop-over and Lock group', async () => {
    show()
    const chip = screen.getByRole('button', { name: '1 open · 1 locked' })
    expect(screen.getAllByRole('button', { name: /locked/ })).toHaveLength(1)
    await userEvent.click(chip)
    expect(await screen.findByText('Online now')).toBeTruthy()
    expect(screen.getByText('Owners: Maya')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Lock group' }))
    expect(lock).toHaveBeenCalledWith({ kind: 'group', id: 3, action: 'lock' })
  })

  test('menu: Unlock 30 min, Back to schedule only with an override, Delete group last', () => {
    const items = (hasOverride: boolean) => groupMenu({ hasMembers: true, hasOverride, onUnlock() {}, onSchedule() {}, onRename() {}, onDelete() {} })
    expect(items(false).filter((i) => !i.hidden).map((i) => i.label)).toEqual(['Unlock 30 min', 'Rename', 'Delete group'])
    expect(items(true).filter((i) => !i.hidden).map((i) => i.label)).toEqual(['Unlock 30 min', 'Back to schedule', 'Rename', 'Delete group'])
    const del = items(true).at(-1)!
    expect(del).toMatchObject({ tone: 'red', divider: true })
  })

  test('Delete group is only in the menu and asks first', async () => {
    show()
    expect(screen.queryByRole('button', { name: /^Delete/ })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete group/ }))
    const dialog = await screen.findByRole('dialog')
    expect(apiMock.mock.calls.some(([, o]) => o?.method === 'DELETE')).toBe(false)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(apiMock.mock.calls.some(([p, o]) => p === '/groups/3' && o?.method === 'DELETE')).toBe(true))
  })

  test('three calm rows with summaries', async () => {
    show()
    expect(screen.getByRole('button', { name: /Devices.*2 of 3 devices/ })).toBeTruthy()
    expect(screen.getByText('Maya iPad, Fire tablet')).toBeTruthy()
    expect(await screen.findByRole('button', { name: /Settings.*Chores lock · 20 pts/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Hours.*1 rule · next lock/ })).toBeTruthy()
  })

  test('a free group reads Free', () => {
    show({ ...group, chore_lock: false })
    expect(screen.getByRole('button', { name: /Settings.*Free/ })).toBeTruthy()
  })
})

describe('group detail, focus', () => {
  test('Devices row: "2 of 3 devices" opens a switch list that saves on change', async () => {
    show(group, { open: 'gdev' })
    const sw = screen.getAllByRole('switch', { name: 'In group' })
    expect(sw).toHaveLength(3)
    expect(sw.map((s) => s.getAttribute('aria-checked'))).toEqual(['true', 'true', 'false'])
    expect(screen.getByText('Guest')).toBeTruthy()
    await userEvent.click(sw[2])
    await waitFor(() => expect(patches()[0]).toEqual(['/groups/3', { method: 'PATCH', body: { name: 'Tablets', device_ids: [1, 2, 3] } }]))
    expect(jest.mocked(notifications.show)).toHaveBeenCalled()
  })

  test('open=gdev opens one row at a time', () => {
    show(group, { open: 'gdev' })
    expect(screen.getByRole('button', { name: /Devices/ }).getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByRole('button', { name: /Settings/ }).getAttribute('aria-expanded')).toBe('false')
  })

  test('icon picker lives in a pop-over', async () => {
    show(group, { open: 'gset' })
    expect(screen.queryByPlaceholderText('Search glyphs')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Change icon' }))
    expect(await screen.findByPlaceholderText('Search glyphs')).toBeTruthy()
    await userEvent.click(screen.getByTitle('tv'))
    await waitFor(() => expect(patches()[0][1]?.body).toMatchObject({ icon: 'tv' }))
  })

  test('chore lock switch saves on change', async () => {
    show(group, { open: 'gset' })
    await userEvent.click(screen.getByRole('switch', { name: /Lock with the kids/ }))
    await waitFor(() => expect(patches()[0][1]?.body).toMatchObject({ chore_lock: false }))
  })

  test('name saves on blur', async () => {
    show(group, { open: 'gset' })
    const input = screen.getByLabelText('Group name')
    await userEvent.clear(input)
    await userEvent.type(input, 'Screens')
    await userEvent.tab()
    await waitFor(() => expect(patches()[0]).toEqual(['/groups/3', { method: 'PATCH', body: { name: 'Screens', device_ids: [1, 2] } }]))
  })

  test('price autosaves only when valid', async () => {
    show(group, { open: 'gset' })
    const input = await screen.findByLabelText('Screen time price')
    await userEvent.type(input, '0')
    await userEvent.tab()
    expect(screen.getByText('Must be at least 1.')).toBeTruthy()
    expect(patches()).toHaveLength(0)
    await userEvent.clear(input)
    await userEvent.type(input, '25')
    await userEvent.tab()
    await waitFor(() => expect(patches()).toHaveLength(1))
    expect(patches()[0][1]?.body).toEqual({ name: 'Tablets', device_ids: [1, 2], screen_price: 25 })
  })

  test('Hours row lists a timeline line per rule and links to Settings', () => {
    show(group, { open: 'ghours' })
    expect(screen.getByText('School nights')).toBeTruthy()
    expect(screen.getByRole('link', { name: /Edit in Settings/ }).getAttribute('href')).toBe('/settings?section=hours')
  })
})
