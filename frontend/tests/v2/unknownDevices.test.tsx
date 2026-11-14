import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import type { ReactNode } from 'react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fridgeTheme } from '@/v2/theme'
import { api } from '@/v2/api'
import { notifications } from '@mantine/notifications'
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
    show([dev(1), dev(4, { name: 'maas-svr', status: 'ignored' })])
    const sum = screen.getByText(/Ignored · 1/)
    expect(sum.closest('details')).toBeTruthy()
    expect(screen.getByText('maas-svr')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Undo ignore maas-svr' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/4', { method: 'PATCH', body: { status: 'unassigned', owner_ids: [] } }))
  })

  test('phone layout: the media rule stacks rows and the row carries the maker · ip · network line', () => {
    show([dev(1)])
    const mob = rows()[0].querySelector('.p-unk-mob')
    expect(mob?.textContent).toBe('Dell · 192.168.1.1 · Home')
    const css = readFileSync(join(__dirname, '../../src/v2/parent/unknown-devices.css'), 'utf8')
    const phone = css.slice(css.indexOf('@media (max-width: 767px)'))
    expect(phone).toMatch(/\.p-unk-row \{ display: grid;/)
    expect(phone).toMatch(/\.p-unk-mob \{ display: block/)
    expect(phone).toMatch(/\.p-unk-opt[^{]*\{ display: none/)
  })

  test('Rescan asks the box to rescan and refetches devices', async () => {
    show([dev(1)])
    await userEvent.click(screen.getByRole('button', { name: /Rescan/ }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/rescan', { method: 'POST' }))
  })

  test('a failed rescan shows an error toast', async () => {
    show([dev(1)])
    apiMock.mockRejectedValue(new Error('The box couldn\'t start a scan.'))
    await userEvent.click(screen.getByRole('button', { name: /Rescan/ }))
    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ title: "That didn't work" })),
    )
  })

  test('bulk buttons are disabled while a bulk call is in flight', async () => {
    let done: (v: unknown) => void = () => {}
    show([dev(1), dev(2)])
    apiMock.mockImplementation(() => new Promise((r) => { done = r }))
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all' }))
    await userEvent.click(screen.getByRole('button', { name: /Ignore/ }))
    await waitFor(() => expect((screen.getByRole('button', { name: /Mark guest/ }) as HTMLButtonElement).disabled).toBe(true))
    expect((screen.getByRole('button', { name: /Ignore/ }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('combobox', { name: 'Assign selected to' }) as HTMLSelectElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: /Ignore/ }))
    expect(apiMock.mock.calls.filter(([p]) => p === '/devices/bulk')).toHaveLength(1)
    done({})
  })

  test('empty state when nothing is unknown', () => {
    show([])
    expect(screen.getByText(/Nobody new/)).toBeTruthy()
  })
})
