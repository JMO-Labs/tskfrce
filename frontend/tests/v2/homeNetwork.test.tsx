import { beforeAll, beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { DeviceList } from '@/v2/manage/DeviceList'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
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
    return undefined
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
