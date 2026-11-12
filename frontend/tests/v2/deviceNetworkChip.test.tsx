import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { DeviceList } from '@/v2/manage/DeviceList'
import { filterByNetwork } from '@/v2/hooks/useNetworks'
import type { Device, Kid } from '@/v2/types'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))

const net = (id: number, label: string) => ({ id, iface: `eth${id}`, subnet: `10.0.${id}.0/24`, label, auto_label: label, custom_label: null, enforce: true, last_seen: '' })
const kids: Kid[] = [{ id: 7, full_name: 'Maya', username: 'm', avatar: null, has_pin: true }]
const dev = (id: number, name: string, network_id?: number | null) =>
  ({ id, name, mac: `aa:0${id}`, vendor: null, status: 'assigned', owner_ids: [7], group_ids: [], online: true, override: null, last_seen: null, resisting: false, network_id }) as Device
let nets: object[]
const onNet = jest.fn()
const show = (net = '') => {
  ;(api as jest.Mock).mockResolvedValue(nets)
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test">
        <DeviceList devices={[dev(1, 'Tablet', 1), dev(2, 'Console', 2), dev(3, 'Old', null)]} kids={kids} onSelectDevice={() => {}} netFilter={net} onNetFilter={onNet} />
      </MantineProvider>
    </QueryClientProvider>,
  )
}
beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})
beforeEach(() => onNet.mockReset())

test('two networks: chip per device, none without network_id', async () => {
  nets = [net(1, 'Home'), net(2, 'Guest')]
  show()
  expect(await screen.findByText('Guest', { selector: '.p-chip' })).toBeTruthy()
  expect(screen.getByText('Home', { selector: '.p-chip' })).toBeTruthy()
  expect(document.querySelectorAll('.p-chip[data-net]')).toHaveLength(2)
})

test('one network: no chips and no filter', async () => {
  nets = [net(1, 'Home')]
  show()
  await waitFor(() => expect(api).toHaveBeenCalled())
  await screen.findByText('Tablet')
  await new Promise((r) => setTimeout(r, 20))
  expect(document.querySelector('.p-chip[data-net]')).toBeNull()
  expect(screen.queryByLabelText('Network')).toBeNull()
})

test('filter offers All plus each network and reports the pick', async () => {
  nets = [net(1, 'Home'), net(2, 'Guest')]
  show()
  const sel = (await screen.findByLabelText('Network')) as HTMLSelectElement
  expect([...sel.options].map((o) => o.text)).toEqual(['All networks', 'Home', 'Guest'])
  await userEvent.selectOptions(sel, '2')
  expect(onNet).toHaveBeenCalledWith('2')
})

test('filterByNetwork: All keeps networkless devices, a network drops them', () => {
  const l = [dev(1, 'a', 1), dev(2, 'b', 2), dev(3, 'c', null)]
  expect(filterByNetwork(l, '')).toHaveLength(3)
  expect(filterByNetwork(l, '2').map((d) => d.id)).toEqual([2])
})

test('detail header shows the chip only with 2+ networks', async () => {
  const { DeviceHead } = require('@/v2/manage/DeviceHead')
  const head = (n: object[]) => {
    ;(api as jest.Mock).mockResolvedValue(n)
    return render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MantineProvider env="test">
          <DeviceHead device={dev(1, 'Tablet', 2)} locked={false} ov={null} blockNew={false} pendingAction={null} onOverride={() => {}} onActivity={() => {}} onRename={() => {}} onDelete={() => {}} />
        </MantineProvider>
      </QueryClientProvider>,
    )
  }
  head([net(1, 'Home'), net(2, 'Guest')])
  expect(await screen.findByText('Guest', { selector: '.p-chip' })).toBeTruthy()
})
