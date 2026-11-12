import { beforeAll, beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { DeviceList } from '@/v2/manage/DeviceList'
import { DevicesPage } from '@/v2/manage/DevicesPage'
import { HomeNetworkPane } from '@/v2/manage/HomeNetworkPane'
import { SETTINGS_SECTIONS } from '@/v2/manage/settingsSections'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@/v2/parent/ParentShell', () => ({ ParentShell: ({ children, list }: { children: React.ReactNode; list: React.ReactNode }) => <>{list}{children}</> }))
jest.mock('@/v2/components/RequireParent', () => ({ RequireParent: ({ children }: { children: React.ReactNode }) => <>{children}</> }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>
let blocked = true
const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test">{ui}</MantineProvider>
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

test('Home network is a Settings section next to Wi-Fi', () => {
  const ids = SETTINGS_SECTIONS.map((s) => s.id)
  expect(ids).toContain('network')
  expect(Math.abs(ids.indexOf('network') - ids.indexOf('wifi'))).toBe(1)
})

test('the pane shows the policy switch and box health, and the switch autosaves', async () => {
  wrap(<HomeNetworkPane />)
  expect(await screen.findByText('Healthy')).toBeInTheDocument()
  await userEvent.click(await screen.findByRole('switch', { name: 'Block new devices' }))
  await waitFor(() => expect(patches()).toEqual([{ new_devices_blocked: false }]))
})

test('the Devices list no longer has the Home network row', async () => {
  const { container } = wrap(<DeviceList devices={[]} kids={[]} onSelectDevice={() => {}} />)
  await waitFor(() => expect(container.querySelector('[aria-label="Devices"]')).toBeInTheDocument())
  expect(screen.queryByText(/Home network/)).toBeNull()
})

test('an old Devices deep link (?net=net) opens the Settings section', async () => {
  fakeRouter.reset('/devices', { net: 'net' })
  wrap(<DevicesPage />)
  await waitFor(() => expect(fakeRouter.replace).toHaveBeenCalled())
  const [target] = fakeRouter.replace.mock.calls[fakeRouter.replace.mock.calls.length - 1] as unknown[]
  expect(target).toBe('/settings?section=network')
})
