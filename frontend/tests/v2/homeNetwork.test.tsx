import { beforeAll, beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { DeviceList } from '@/v2/manage/DeviceList'
import { DeviceDetail } from '@/v2/manage/DeviceDetail'
import { DevicesPage } from '@/v2/manage/DevicesPage'
import type { Device } from '@/v2/types'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@/v2/parent/ParentShell', () => ({ ParentShell: ({ children, list }: { children: React.ReactNode; list: React.ReactNode }) => <>{list}{children}</> }))
jest.mock('@/v2/components/RequireParent', () => ({ RequireParent: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>
let blocked = true
const show = (tab: 'devices' | 'groups' = 'devices') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test">
        <DeviceList devices={[]} kids={[]} onSelectDevice={() => {}} tab={tab} />
      </MantineProvider>
    </QueryClientProvider>,
  )
const patches = () => apiMock.mock.calls.filter((c) => c[0] === '/family' && c[1]?.method === 'PATCH').map((c) => c[1]?.body)

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})
beforeEach(() => {
  blocked = true
  fakeRouter.reset('/devices', {})
  apiMock.mockReset().mockImplementation(async (p, i) => {
    if (i?.method === 'PATCH') { blocked = (i.body as { new_devices_blocked: boolean }).new_devices_blocked; return { name: 'R', new_devices_blocked: blocked } }
    if (p === '/family') return { name: 'R', new_devices_blocked: blocked }
    if (p === '/blocker') return { online: true, last_seen: null }
    if (p === '/hours') return { today: null, rules: [] }
    if (p === '/devices' || p === '/kids' || p === '/groups') return []
    return {}
  })
})

test('Home network is one calm row at the top of the Devices list', async () => {
  show()
  expect(await screen.findByText('New devices blocked · Box healthy')).toBeInTheDocument()
  expect(screen.queryByRole('switch', { name: 'Block new devices' })).toBeNull()
})

test('it opens in place, and the switch autosaves', async () => {
  show()
  await userEvent.click(await screen.findByRole('button', { name: /^Home network/ }))
  await userEvent.click(await screen.findByRole('switch', { name: 'Block new devices' }))
  await waitFor(() => expect(patches()).toEqual([{ new_devices_blocked: false }]))
  expect(await screen.findByText('Healthy')).toBeInTheDocument()
  expect(screen.queryByText(/Box healthy/)).toBeNull() // the open row shows its form, not its summary
  await userEvent.click(screen.getByRole('button', { name: /^Home network/ }))
  await waitFor(() => expect(screen.getByText('New devices allowed · Box healthy')).toBeInTheDocument())
})

test('it is not on the Groups tab', async () => {
  const { container } = show('groups')
  await waitFor(() => expect(container.querySelector('[aria-label="Devices"]')).toHaveTextContent('Home network'))
  expect(container.querySelector('[aria-label="Groups"]')).not.toHaveTextContent('Home network')
})

const dev = { id: 1, name: 'Tablet', mac: 'aa:bb', vendor: null, status: 'assigned', owner_ids: [], group_ids: [], online: false, override: null, last_seen: null, resisting: false, exempt: false, reason: 'chores', chores_done: 0, chores_total: 0, locks_at: null, alerts: 0, address_changes: 0 } as Device

test('opening a device row closes Home network; Esc closes the innermost first', async () => {
  fakeRouter.reset('/devices', { item: '1', net: 'net' })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test">
        <DeviceList devices={[]} kids={[]} onSelectDevice={() => {}} />
        <DeviceDetail device={dev} kids={[]} onRequestOverride={() => {}} />
      </MantineProvider>
    </QueryClientProvider>,
  )
  expect(await screen.findByRole('switch', { name: 'Block new devices' })).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /^Details/ }))
  expect(fakeRouter.query).toMatchObject({ open: 'details' })
  expect(fakeRouter.query.net).toBeUndefined()
  expect(screen.queryByRole('switch', { name: 'Block new devices' })).toBeNull()
  // and back the other way: one Esc closes the Home network row, not the device row
  await userEvent.click(screen.getByRole('button', { name: /^Home network/ }))
  expect(fakeRouter.query).toMatchObject({ net: 'net' })
  expect(fakeRouter.query.open).toBeUndefined()
  await userEvent.keyboard('{Escape}')
  expect(fakeRouter.query.net).toBeUndefined()
})

test('switching to the Groups tab drops net from the URL', async () => {
  fakeRouter.reset('/devices', { net: 'net' })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test"><DevicesPage /></MantineProvider>
    </QueryClientProvider>,
  )
  await userEvent.click(await screen.findByRole('button', { name: /^Groups/ }))
  expect(fakeRouter.query.tab).toBe('groups')
  expect(fakeRouter.query.net).toBeUndefined()
})
