import { beforeAll, beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fridgeTheme } from '@/v2/theme'
import { api } from '@/v2/api'
import { DeviceDetail } from '@/v2/manage/DeviceDetail'
import { DeviceList } from '@/v2/manage/DeviceList'
import type { Device } from '@/v2/types'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn(), hide: jest.fn() } }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))

const apiMock = api as unknown as Mock<(p: string, o?: { method?: string; body?: unknown }) => Promise<unknown>>
const held: Device = {
  id: 5, name: 'Unknown phone', mac: 'fa:bb:cc:dd:ee:01', vendor: null, status: 'unassigned', owner_ids: [], group_ids: [],
  online: false, override: null, last_seen: null, seen_now: true, resisting: false, exempt: false, reason: 'new_device',
  chores_done: 0, chores_total: 0, locks_at: null, alerts: 0, random_mac: true, held: true,
}
const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MantineProvider theme={fridgeTheme}>{ui}</MantineProvider>
  </QueryClientProvider>
)

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  global.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
  Element.prototype.scrollIntoView = jest.fn()
})
beforeEach(() => {
  apiMock.mockReset().mockImplementation(async (p) => {
    if (p === '/family') return { timezone: 'UTC', new_devices_blocked: false }
    if (p === '/blocker') return { online: true }
    if (p.endsWith('/activity')) return { counts: {}, events: [], history: [], days: [] }
    return {}
  })
})

test('the list marks a held device "New, held"', () => {
  fakeRouter.reset('/devices', {})
  render(wrap(<DeviceList devices={[held]} kids={[]} onSelectDevice={() => {}} />))
  expect(screen.getByRole('img', { name: /New, held/ })).toBeInTheDocument()
})

test('Allow lifts the hold', async () => {
  fakeRouter.reset('/devices', { item: '5' })
  render(wrap(<DeviceDetail device={held} kids={[]} groups={[]} onRequestOverride={jest.fn()} />))
  expect(await screen.findByText('New, held')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /^Allow/ }))
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/5', { method: 'PATCH', body: { held: false } }))
})
