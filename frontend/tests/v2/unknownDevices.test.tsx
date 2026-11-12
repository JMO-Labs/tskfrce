import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fridgeTheme } from '@/v2/theme'
import { api } from '@/v2/api'
import { UnknownDevices } from '@/v2/manage/UnknownDevices'
import type { Device, Kid } from '@/v2/types'

jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))

const apiMock = api as unknown as Mock<(p: string, o?: { method?: string; body?: unknown }) => Promise<unknown>>
const kids: Kid[] = [
  { id: 7, full_name: 'Maya', username: 'kid-maya', avatar: null, has_pin: true },
  { id: 8, full_name: 'Leo', username: 'kid-leo', avatar: null, has_pin: true },
]
const dev = (id: number, over: Partial<Device> = {}): Device => ({
  id, name: `Dev ${id}`, mac: `aa:bb:cc:dd:ee:0${id}`, vendor: 'Dell', status: 'unassigned', owner_ids: [], group_ids: [],
  online: true, override: null, last_seen: null, resisting: false, ip: `192.168.1.${id}`, network: 'Home', first_seen: null, ...over,
})
const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MantineProvider theme={fridgeTheme}>{ui}</MantineProvider>
  </QueryClientProvider>
)
const show = (devices: Device[]) => render(wrap(<UnknownDevices devices={devices} kids={kids} />))
const rows = () => screen.getAllByTestId('unknown-row')

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})
beforeEach(() => apiMock.mockReset().mockResolvedValue({}))

describe("Who's this? pane", () => {
  test('lists unknown devices with maker, address and network, and hides known ones', () => {
    show([dev(1), dev(2, { name: 'Known', status: 'assigned', owner_ids: [7] })])
    expect(rows()).toHaveLength(1)
    const r = within(rows()[0])
    expect(r.getByText('Dev 1')).toBeTruthy()
    expect(r.getByText('Dell')).toBeTruthy()
    expect(r.getByText('192.168.1.1')).toBeTruthy()
    expect(r.getByText('Home')).toBeTruthy()
  })

  test('changing a row owner saves immediately', async () => {
    show([dev(1)])
    await userEvent.selectOptions(within(rows()[0]).getByRole('combobox'), 'Maya')
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/1', { method: 'PATCH', body: { status: 'assigned', owner_ids: [7] } }))
  })

  test('a row can be set to Guest', async () => {
    show([dev(1)])
    await userEvent.selectOptions(within(rows()[0]).getByRole('combobox'), 'Guest')
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/1', { method: 'PATCH', body: { status: 'guest', owner_ids: [] } }))
  })

  test('select-all and the bulk bar: assign, guest, ignore, clear', async () => {
    show([dev(1), dev(2), dev(3)])
    expect(screen.queryByText(/selected/)).toBeNull()
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    expect(screen.getByText('3 selected')).toBeTruthy()

    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Assign selected to' }), 'Leo')
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/bulk', { method: 'POST', body: { ids: [1, 2, 3], status: 'assigned', owner_ids: [8] } }))

    await userEvent.click(screen.getByRole('button', { name: /Mark guest/ }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/bulk', { method: 'POST', body: { ids: [1, 2, 3], status: 'guest', owner_ids: [] } }))

    await userEvent.click(screen.getByRole('button', { name: /Ignore/ }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/bulk', { method: 'POST', body: { ids: [1, 2, 3], status: 'ignored', owner_ids: [] } }))

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.queryByText(/selected/)).toBeNull()
  })

  test('single checkbox selects one row', async () => {
    show([dev(1), dev(2)])
    await userEvent.click(within(rows()[1]).getByRole('checkbox'))
    expect(screen.getByText('1 selected')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Ignore/ }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/bulk', { method: 'POST', body: { ids: [2], status: 'ignored', owner_ids: [] } }))
  })

  test('Ignored list is collapsible and undo sends the device back to unassigned', async () => {
    show([dev(1), dev(4, { name: 'maas-svr', status: 'ignored' as never })])
    const sum = screen.getByText(/Ignored · 1/)
    expect(sum.closest('details')).toBeTruthy()
    expect(screen.getByText('maas-svr')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Undo ignore maas-svr' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/4', { method: 'PATCH', body: { status: 'unassigned', owner_ids: [] } }))
  })

  test('phone layout: rows carry the stacked-row class and the mobile details line', () => {
    show([dev(1)])
    expect(rows()[0].className).toContain('p-unk-row')
    expect(within(rows()[0]).getByText(/Dell · 192\.168\.1\.1 · Home/)).toBeTruthy()
  })

  test('empty state when nothing is unknown', () => {
    show([])
    expect(screen.getByText(/Nobody new/)).toBeTruthy()
  })
})
