import { beforeAll, beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { DevicesPage } from '@/v2/manage/DevicesPage'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@/v2/parent/ParentShell', () => ({ ParentShell: ({ children, list }: { children: React.ReactNode; list: React.ReactNode }) => <>{list}{children}</> }))
jest.mock('@/v2/components/RequireParent', () => ({ RequireParent: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const apiMock = api as unknown as Mock<(p: string) => Promise<unknown>>
const d = (id: number, status: string, owner_ids: number[]) => ({
  id, name: `Dev ${id}`, mac: `aa:00:${id}`, vendor: null, status, owner_ids, group_ids: [], online: true, override: null, last_seen: null, resisting: false,
})
let devices: unknown[] = []

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  Element.prototype.scrollIntoView = jest.fn()
})
beforeEach(() => {
  fakeRouter.reset('/devices', {})
  apiMock.mockReset().mockImplementation(async (p) => {
    if (p === '/devices') return devices
    if (p === '/kids') return [{ id: 7, full_name: 'Maya', username: 'kid-maya', avatar: null, has_pin: true }]
    if (p === '/hours') return { today: null, rules: [] }
    if (p === '/groups') return []
    return {}
  })
})

const page = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test"><DevicesPage /></MantineProvider>
    </QueryClientProvider>,
  )

test("Who's this? is selected by default when devices are unknown, and the table opens", async () => {
  devices = [d(1, 'assigned', [7]), d(2, 'unassigned', []), d(3, 'unassigned', [])]
  page()
  const entry = await screen.findByRole('button', { name: /Who's this\? · 2/ })
  expect(entry.getAttribute('aria-current')).toBe('true')
  expect(await screen.findAllByTestId('unknown-row')).toHaveLength(2)
})

test('with nothing unknown the first known device opens instead', async () => {
  devices = [d(1, 'assigned', [7])]
  page()
  await screen.findAllByText('Dev 1')
  expect(screen.queryByRole('button', { name: /Who's this/ })).toBeNull()
  expect(screen.queryByTestId('unknown-row')).toBeNull()
})
