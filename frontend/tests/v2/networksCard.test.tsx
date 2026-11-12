import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { NetworksCard } from '@/v2/manage/NetworksCard'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

type Call = [string, { method?: string; body?: Record<string, unknown> }?]
const apiMock = api as unknown as jest.Mock<Promise<unknown>, Call>
const net = (o: object) => ({ id: 1, iface: 'eth0', subnet: '192.168.1.0/24', label: 'Home', auto_label: 'Home', custom_label: null, enforce: true, last_seen: new Date().toISOString(), ...o })
let rows: object[]
let failPatch: boolean
const patches = () => apiMock.mock.calls.filter((c) => c[1]?.method === 'PATCH')

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test"><NetworksCard /></MantineProvider>
    </QueryClientProvider>,
  )

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})
beforeEach(() => {
  rows = [net({}), net({ id: 2, iface: 'eth1', subnet: '10.0.0.0/24', label: 'Guest', auto_label: 'Guest' })]
  failPatch = false
  apiMock.mockReset().mockImplementation(async (_p, i) => {
    if (i?.method === 'PATCH') {
      if (failPatch) throw new Error('nope')
      return { ...(rows[0] as object), ...i.body }
    }
    return rows
  })
})

test('lists each network with subnet', async () => {
  wrap()
  expect(await screen.findByText('Guest')).toBeTruthy()
  expect(screen.getByText(/10\.0\.0\.0\/24/)).toBeTruthy()
  expect(screen.getByText(/192\.168\.1\.0\/24/)).toBeTruthy()
})

test('hidden with a single network', async () => {
  rows = [net({})]
  const { container } = wrap()
  await waitFor(() => expect(apiMock).toHaveBeenCalled())
  await new Promise((r) => setTimeout(r, 20))
  expect(container.querySelector('button, input')).toBeNull()
  expect(container.textContent).not.toMatch(/192\.168|Home/)
})

test('rename: Enter saves, Esc cancels, empty restores auto label', async () => {
  wrap()
  await screen.findByText('Guest')
  const u = userEvent.setup()
  await u.click(screen.getAllByRole('button', { name: /rename/i })[0])
  await u.clear(screen.getByLabelText('Network name'))
  await u.type(screen.getByLabelText('Network name'), 'Upstairs{Enter}')
  await waitFor(() => expect(patches()[0][1]?.body).toEqual({ custom_label: 'Upstairs' }))

  await u.click(screen.getAllByRole('button', { name: /rename/i })[0])
  await u.type(screen.getByLabelText('Network name'), 'zzz{Escape}')
  expect(patches()).toHaveLength(1)

  await u.click(screen.getAllByRole('button', { name: /rename/i })[0])
  await u.clear(screen.getByLabelText('Network name'))
  await u.keyboard('{Enter}')
  await waitFor(() => expect(patches()[1][1]?.body).toEqual({ custom_label: null }))
})

test('turning Enforce off asks first; on does not', async () => {
  wrap()
  await screen.findByText('Guest')
  const u = userEvent.setup()
  await u.click(screen.getAllByRole('switch', { name: /enforce here/i })[0])
  expect(await screen.findByText(/won't be paused/)).toBeTruthy()
  expect(patches()).toHaveLength(0)
  await u.click(screen.getByRole('button', { name: 'Turn off' }))
  await waitFor(() => expect(patches()[0][1]?.body).toEqual({ enforce: false }))
})

test('failed save rolls back the switch', async () => {
  rows = [net({ enforce: false }), net({ id: 2, label: 'Guest' })]
  failPatch = true
  wrap()
  await screen.findByText('Guest')
  const sw = screen.getAllByRole('switch', { name: /enforce here/i })[0] as HTMLInputElement
  expect(sw.checked).toBe(false)
  await userEvent.setup().click(sw)
  await waitFor(() => expect(patches()).toHaveLength(1))
  await waitFor(() => expect((screen.getAllByRole('switch', { name: /enforce here/i })[0] as HTMLInputElement).checked).toBe(false))
})
