import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import type { ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fridgeTheme } from '@/v2/theme'
import { api } from '@/v2/api'
import { PenaltyList, halfLeft } from '@/v2/manage/PenaltyList'
import { DeviceDetail } from '@/v2/manage/DeviceDetail'
import type { Device } from '@/v2/types'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn(), hide: jest.fn() } }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
const apiMock = api as unknown as Mock<(p: string, o?: { method?: string; body?: unknown }) => Promise<unknown>>

const pen = (o: object) => ({
  id: 5, kid_id: 7, group_id: null, kind: 'block', amount: 2880, amount_taken: 0, amount_returned: 0, back_total: 0, label: 'phone',
  earn_back: 'none', reason: null, given_by: 'a', created_at: '2026-11-10T10:00:00Z', ends_at: '2099-01-01T10:00:00Z', status: 'active',
  seen_by_kid: true, summary: 'No phone, 2 days', makeup: [], ...o,
})
let list: unknown[]
const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MantineProvider theme={fridgeTheme}>{ui}</MantineProvider>
  </QueryClientProvider>
)
beforeEach(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  global.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
  apiMock.mockReset().mockImplementation(async (path) => (path.endsWith('/penalties') ? list : path === '/family' ? { timezone: 'UTC' } : {}))
})

describe('PenaltyList', () => {
  test('row, then block buttons, shorten 1 day posts 1440', async () => {
    list = [pen({})]
    render(wrap(<PenaltyList kidId={7} name="Maya" />))
    await userEvent.click(await screen.findByText(/No phone, 2 days/))
    for (const n of ['1 hour', '1 day', 'Half', 'Forgive', 'Cancel']) expect(screen.getByRole('button', { name: n })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '1 day' }))
    expect(apiMock).toHaveBeenCalledWith('/penalties/5/shorten', { method: 'POST', body: { minutes: 1440 } })
  })
  test('points: no shorten; cancel confirms first', async () => {
    list = [pen({ kind: 'points', summary: '−20 points', ends_at: null })]
    render(wrap(<PenaltyList kidId={7} name="Maya" />))
    await userEvent.click(await screen.findByText('−20 points'))
    expect(screen.queryByRole('button', { name: '1 day' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(await screen.findByText('Undo this penalty? Maya gets back what was taken.')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(apiMock).toHaveBeenCalledWith('/penalties/5/cancel', { method: 'POST', body: undefined })
  })
  test('shows makeup progress; hides when none active', async () => {
    list = [pen({ makeup: [{ run_id: 1, title: 'a', status: 'done' }, { run_id: 2, title: 'b', status: 'open' }] })]
    const { unmount } = render(wrap(<PenaltyList kidId={7} name="Maya" />))
    expect(await screen.findByText(/1 of 2 done/)).toBeTruthy()
    unmount()
    list = []
    const { container } = render(wrap(<PenaltyList kidId={7} name="Maya" />))
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector('section')).toBeNull()
  })
  test('ended row: muted Ended line, Cancel only', async () => {
    list = [pen({ status: 'ended' })]
    render(wrap(<PenaltyList kidId={7} name="Maya" />))
    expect(await screen.findByText('Ended')).toBeTruthy()
    await userEvent.click(screen.getByText(/No phone, 2 days/))
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeTruthy()
    for (const n of ['1 hour', 'Half', 'Forgive']) expect(screen.queryByRole('button', { name: n })).toBeNull()
  })
  test('sub line: until, make-up progress and cause', async () => {
    const makeup = [{ run_id: 1, title: 'a', status: 'done' }, { run_id: 2, title: 'b', status: 'todo' }]
    list = [pen({ makeup, cause: 'Dishes' })]
    render(wrap(<PenaltyList kidId={7} name="Maya" />))
    expect(await screen.findByText(/until .* · 1 of 2 done · From Dishes/)).toBeTruthy()
  })
  test('halfLeft', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    expect(halfLeft('2026-01-01T04:00:00Z', now)).toBe(120)
    expect(halfLeft('2026-01-01T00:10:00Z', now)).toBe(15)
  })
})

test('device page: Blocked by penalty + Forgive', async () => {
  fakeRouter.reset('/devices', { item: '12' })
  const d = { id: 12, name: 'Maya iPhone', mac: 'aa', vendor: null, status: 'assigned', owner_ids: [7], group_ids: [], online: false, override: null, last_seen: null, seen_now: false, resisting: false, exempt: false, reason: 'penalty', chores_done: 0, chores_total: 0, locks_at: null, alerts: 0, penalty: { id: 9, ends_at: '2099-01-01T10:00:00Z' } } as Device
  render(wrap(<DeviceDetail device={d} kids={[]} onRequestOverride={jest.fn()} />))
  expect(screen.getAllByText('Blocked by penalty').length).toBeGreaterThan(0)
  expect(screen.queryByRole('button', { name: /Unlock 30 min/ })).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Forgive' }))
  expect(apiMock).toHaveBeenCalledWith('/penalties/9/forgive', { method: 'POST', body: undefined })
})
