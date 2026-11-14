import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fakeRouter } from './helpers/fakeRouter'
import { StepDevices } from '@/v2/setup/StepDevices'
import { api } from '@/v2/api'
import { toastFail } from '@/v2/notify'
import type { Device, Kid } from '@/v2/types'

jest.mock('@/v2/notify', () => ({ toastOk: jest.fn(), toastFail: jest.fn() }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@/v2/eval/track', () => ({ track: jest.fn() }))
const apiMock = api as unknown as Mock<typeof api>

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))

const kids = [{ id: 7, full_name: 'Mia', avatar: '🦊' }, { id: 8, full_name: 'Leo', avatar: '🐼' }] as Kid[]
const dev = (o: Partial<Device>): Device =>
  ({ id: 1, name: 'Mias-iPad', mac: '3c:22:fb:00:00:01', vendor: 'Apple', status: 'unassigned', owner_ids: [], group_ids: [], online: true, override: null, last_seen: null, resisting: false, ip: '192.168.1.42', ...o }) as Device

const view = () =>
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <StepDevices kids={kids} />
      </QueryClientProvider>
    </MantineProvider>,
  )

const three = [dev({}), dev({ id: 2, name: 'Switch', vendor: 'Nintendo', ip: '192.168.1.43', mac: '3c:22:fb:00:00:02' }), dev({ id: 3, name: 'Fire tablet', vendor: null, ip: null, mac: '3a:1f:00:00:c2:09', status: 'assigned', owner_ids: [7] })]
const openNeed = () => fakeRouter.reset('/setup', { open: 'need' })

beforeEach(() => { apiMock.mockReset(); (toastFail as jest.Mock).mockClear(); fakeRouter.reset('/setup') })

describe('StepDevices', () => {
  test('devices split into Need an owner · N left and Done · N', async () => {
    apiMock.mockResolvedValue(three)
    view()
    expect(await screen.findByText('Looking for devices… 3 found')).toBeInTheDocument()
    const need = screen.getByRole('button', { name: /Need an owner/ })
    expect(need).toHaveTextContent('2 left')
    expect(screen.getByRole('button', { name: /Done/ })).toHaveTextContent('1')
    expect(screen.getByText('Mias-iPad, Switch')).toBeInTheDocument()
    expect(screen.queryByText('Private MAC')).not.toBeInTheDocument()
  })

  test('line2 shows two names plus N more, or that all have an owner', async () => {
    apiMock.mockResolvedValue([dev({}), dev({ id: 2, name: 'B' }), dev({ id: 3, name: 'C' })])
    const { unmount } = view()
    expect(await screen.findByText('Mias-iPad, B +1 more')).toBeInTheDocument()
    unmount()
    apiMock.mockResolvedValue([dev({ status: 'guest' })])
    view()
    expect(await screen.findByText('All devices have an owner')).toBeInTheDocument()
  })

  test('one owner pop-over per device: kids, Guest, Not sure yet', async () => {
    apiMock.mockResolvedValue(three)
    openNeed()
    view()
    expect(await screen.findByText('192.168.1.42', { exact: false })).toBeInTheDocument()
    expect(screen.getByText('Apple · 192.168.1.42')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Owner for Mias-iPad' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Owner for Switch' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Owner for Mias-iPad' }))
    const group = await screen.findByRole('group', { name: 'Owner for Mias-iPad' })
    const names = Array.from(group.querySelectorAll('button')).map((b) => b.textContent)
    expect(names).toEqual([expect.stringContaining('Mia'), expect.stringContaining('Leo'), expect.stringContaining('Guest (never blocked)'), expect.stringContaining('Not sure yet')])
  })

  test('picking an owner sends one PATCH with that kid', async () => {
    apiMock.mockImplementation(async (path, init) => (init?.method === 'PATCH' ? dev({}) : [dev({})]))
    openNeed()
    view()
    await userEvent.click(await screen.findByRole('button', { name: 'Owner for Mias-iPad' }))
    await userEvent.click(await screen.findByRole('button', { name: /Mia/, pressed: false, hidden: true }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/1', { method: 'PATCH', body: { status: 'assigned', owner_ids: [7] } }))
    expect(apiMock.mock.calls.filter(([, i]) => i?.method === 'PATCH')).toHaveLength(1)
  })

  test('Guest and Not sure yet send their own bodies', async () => {
    apiMock.mockImplementation(async (path, init) => (init?.method === 'PATCH' ? dev({}) : [dev({})]))
    openNeed()
    view()
    await userEvent.click(await screen.findByRole('button', { name: 'Owner for Mias-iPad' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Guest (never blocked)', hidden: true }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/1', { method: 'PATCH', body: { status: 'guest', owner_ids: [] } }))
    await userEvent.click(await screen.findByRole('button', { name: 'Owner for Mias-iPad' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Not sure yet', hidden: true }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/devices/1', { method: 'PATCH', body: { status: 'unassigned', owner_ids: [] } }))
  })

  test('a failed save shows the failure and keeps the server owner', async () => {
    apiMock.mockImplementation(async (path, init) => { if (init?.method === 'PATCH') throw new Error('nope'); return [dev({})] })
    openNeed()
    view()
    await userEvent.click(await screen.findByRole('button', { name: 'Owner for Mias-iPad' }))
    await userEvent.click(await screen.findByRole('button', { name: /Mia$/, hidden: true }))
    await waitFor(() => expect(apiMock.mock.calls.some(([, i]) => i?.method === 'PATCH')).toBe(true))
    await waitFor(() => expect(toastFail).toHaveBeenCalled())
    expect(screen.getByRole('button', { name: 'Owner for Mias-iPad' })).toHaveTextContent('Owner')
  })

  test('private address help is one pop-over', async () => {
    apiMock.mockResolvedValue(three)
    view()
    expect(await screen.findByText('Not seeing a device, or one keeps changing?')).toBeInTheDocument()
    expect(screen.queryByText(/Unlock it/)).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(await screen.findByText(/Unlock it and open a web page/)).toBeInTheDocument()
    expect(screen.getByText(/1 of these use a private Wi-Fi address/)).toBeInTheDocument()
  })

  test('the two rows are one grouped card', async () => {
    apiMock.mockResolvedValue(three)
    const { container } = view()
    await screen.findByText('Looking for devices… 3 found')
    expect(container.querySelector('.p-srows[data-grp]')).not.toBeNull()
  })

  test('no devices yet: one line says what to do and that you can continue', async () => {
    apiMock.mockResolvedValue([])
    view()
    expect(await screen.findByText(/No devices yet\. Unlock a device and open a web page, or skip and add them later\./)).toBeInTheDocument()
  })

  test('an owned device shows its owner in the pop name', async () => {
    apiMock.mockResolvedValue(three)
    fakeRouter.reset('/setup', { open: 'done' })
    view()
    expect(await screen.findByRole('button', { name: 'Owner for Fire tablet: Mia' })).toBeInTheDocument()
  })
})

describe('StepDevices history', () => {
  test('opening a row adds no history entry (the step is not in the URL)', async () => {
    apiMock.mockResolvedValue(three)
    view()
    await userEvent.click(await screen.findByRole('button', { name: /Need an owner/ }))
    await waitFor(() => expect(fakeRouter.query.open).toBe('need'))
    expect(fakeRouter.push).not.toHaveBeenCalled()
  })
})

describe('StepDevices telemetry', () => {
  test('emits devices found bucket once and rescan', async () => {
    const { track } = jest.requireMock('@/v2/eval/track') as { track: jest.Mock }
    track.mockClear()
    apiMock.mockResolvedValue(three)
    view()
    await screen.findByText('Looking for devices… 3 found')
    await waitFor(() => expect(track).toHaveBeenCalledWith('setup_detail', { step: 7, what: 'devices_found_1_3' }))
    await userEvent.click(screen.getByRole('button', { name: /Rescan/ }))
    await waitFor(() => expect(track).toHaveBeenCalledWith('setup_detail', { step: 7, what: 'rescan' }))
    expect(track.mock.calls.filter((c) => c[1].what?.startsWith('devices_found'))).toHaveLength(1)
  })
})
