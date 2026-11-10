import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { api } from '@/v2/api'
import { NotificationsPane } from '@/v2/manage/NotificationsPane'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))

type Init = { method?: string; body?: unknown }
const apiMock = api as unknown as Mock<(p: string, i?: Init) => Promise<unknown>>
const showMock = notifications.show as unknown as Mock<(o: { message: unknown }) => void>

const place = { id: 1, name: 'Dad phone', url_mask: 'ntfy://••••/rivera', enabled: true, events: ['a', 'c'], readable: true }
const base = {
  quiet_start: null as string | null, quiet_end: null as string | null, quiet_security: true,
  app_address: null as string | null, app_address_default: null,
  events: ['a', 'b', 'c', 'd'].map((k) => ({ key: k, label: `Event ${k}`, security: false })),
}

const serve = (places: object[], s: object = {}, relay = false) =>
  apiMock.mockImplementation(async (p, i) => {
    if (p === '/notify/places' && !i?.method) return places
    if (p === '/notify/settings' && !i?.method) return { ...base, ...s }
    if (p === '/family') return { name: 'F', ntfy_upstream_relay: relay }
    if (p === '/kids') return []
    return {}
  })
const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  )
const calls = (p: string, method: string) => apiMock.mock.calls.filter((c) => c[0] === p && c[1]?.method === method)

beforeEach(() => {
  apiMock.mockReset()
  showMock.mockReset()
  fakeRouter.reset('/settings', { section: 'notifications' })
  window.matchMedia ??= ((() => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} })) as never)
})

describe('Settings › Notifications rows', () => {
  test('one row per place with switch and "N of M events"', async () => {
    serve([place, { ...place, id: 2, name: 'Discord', enabled: false, events: ['b'] }])
    wrap(<NotificationsPane />)
    expect(await screen.findByRole('button', { name: /Dad phone/ })).toHaveTextContent('2 of 4 events')
    expect(screen.getByRole('button', { name: /Discord/ })).toHaveTextContent('1 of 4 events')
    expect(screen.getByRole('switch', { name: 'Dad phone notifications on' })).toBeChecked()
    expect(screen.getByRole('switch', { name: 'Discord notifications on' })).not.toBeChecked()
  })

  test('focusing a place shows event chips, Test and Delete', async () => {
    serve([place])
    wrap(<NotificationsPane />)
    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: /Dad phone/ }))
    expect(fakeRouter.query.open).toBe('place-1')
    const body = await screen.findByRole('region', { name: 'Dad phone' })
    expect(within(body).getByText(place.url_mask)).toBeTruthy()
    expect(within(body).getByRole('button', { name: 'Event a' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(body).getByRole('button', { name: 'Event b' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(body).getByRole('button', { name: 'Test' })).toBeTruthy()
    await userEvent.click(within(body).getByRole('button', { name: 'Delete place' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls('/notify/places/1', 'DELETE')).toHaveLength(1))
  })

  test('place switch saves without opening the row', async () => {
    serve([place])
    wrap(<NotificationsPane />)
    await userEvent.click(await screen.findByRole('switch', { name: 'Dad phone notifications on' }))
    await waitFor(() => expect(calls('/notify/places/1', 'PATCH')).toHaveLength(1))
    expect(calls('/notify/places/1', 'PATCH')[0][1]?.body).toEqual({ enabled: false })
    expect(fakeRouter.query.open).toBeUndefined()
    expect(screen.getByRole('button', { name: /Dad phone/ })).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(showMock).toHaveBeenCalledWith(expect.objectContaining({ message: 'Saved' })))
  })

  test('an unreadable place says so on the row and offers Change address when opened', async () => {
    serve([{ ...place, readable: false }])
    wrap(<NotificationsPane />)
    expect(await screen.findByText('Re-enter this address')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /Dad phone/ }))
    expect(await screen.findByRole('button', { name: 'Change address' })).toBeTruthy()
    expect(screen.getAllByText('Re-enter this address')).toHaveLength(1)
  })

  test('Quiet hours saves the pair only when both times are set', async () => {
    serve([place], { quiet_start: '22:00', quiet_end: '07:00' })
    wrap(<NotificationsPane />)
    expect(await screen.findByRole('button', { name: /Quiet hours/ })).toHaveTextContent('10 PM – 7 AM')
    await userEvent.click(screen.getByRole('button', { name: /Quiet hours/ }))
    const from = await screen.findByLabelText('From')
    const to = screen.getByLabelText('To')
    await userEvent.clear(to)
    await userEvent.tab()
    expect(await screen.findByText('Pick both times')).toBeTruthy()
    expect(calls('/notify/settings', 'PATCH')).toHaveLength(0)
    await userEvent.type(to, '0630')
    await userEvent.tab()
    await waitFor(() => expect(calls('/notify/settings', 'PATCH')).toHaveLength(1))
    expect(calls('/notify/settings', 'PATCH')[0][1]?.body).toEqual({ quiet_start: '22:00', quiet_end: '06:30' })
    expect(from).toHaveValue('22:00')
  })

  test('quiet switch turns it off without opening the row; summary reads Off', async () => {
    serve([place], { quiet_start: '22:00', quiet_end: '07:00' })
    wrap(<NotificationsPane />)
    await userEvent.click(await screen.findByRole('switch', { name: 'Quiet hours' }))
    await waitFor(() => expect(calls('/notify/settings', 'PATCH')).toHaveLength(1))
    expect(calls('/notify/settings', 'PATCH')[0][1]?.body).toEqual({ quiet_start: null, quiet_end: null })
    expect(screen.getByRole('button', { name: /Quiet hours/ })).toHaveAttribute('aria-expanded', 'false')
  })

  test('two quick settings changes are both sent', async () => {
    let first: (v: unknown) => void = () => {}
    let n = 0
    apiMock.mockImplementation(async (p, i) => {
      if (p === '/notify/places') return [place]
      if (p === '/notify/settings' && i?.method === 'PATCH') return ++n === 1 ? new Promise((r) => (first = r)) : {}
      if (p === '/notify/settings') return { ...base, quiet_start: '22:00', quiet_end: '07:00' }
      if (p === '/family') return { name: 'F', ntfy_upstream_relay: false }
      return {}
    })
    wrap(<NotificationsPane />)
    const sw = await screen.findByRole('switch', { name: 'Quiet hours' })
    await userEvent.click(sw)
    await userEvent.click(sw)
    await act(async () => first({}))
    await waitFor(() => expect(calls('/notify/settings', 'PATCH')).toHaveLength(2))
  })

  test('iPhone help is one row with one (i)', async () => {
    serve([place], {}, true)
    wrap(<NotificationsPane />)
    const row = await screen.findByRole('button', { name: /iPhones/ })
    expect(row).toHaveTextContent('Instant (relay)')
    expect(screen.getAllByRole('button', { name: 'How iPhone alerts work' })).toHaveLength(1)
  })

  test('no Advanced fold; App address is a row', async () => {
    serve([place], { app_address: 'http://box.lan:3000/x' })
    wrap(<NotificationsPane />)
    const row = await screen.findByRole('button', { name: /App address/ })
    expect(row).toHaveTextContent('box.lan:3000')
    expect(screen.queryByText('Advanced')).toBeNull()
    expect(document.querySelector('details')).toBeNull()
    await userEvent.click(row)
    expect(await screen.findByRole('textbox', { name: 'App address' })).toHaveValue('http://box.lan:3000/x')
  })

  test('App address row without one reads Default (fallback)', async () => {
    serve([place])
    wrap(<NotificationsPane />)
    expect(await screen.findByRole('button', { name: /App address/ })).toHaveTextContent('Default (http://chores.local)')
  })

  test('Quiet hours row is hidden with no places', async () => {
    serve([])
    wrap(<NotificationsPane />)
    await screen.findByText('No places yet')
    expect(screen.queryByRole('button', { name: /Quiet hours/ })).toBeNull()
    expect(screen.getByRole('button', { name: /App address/ })).toBeTruthy()
  })

  test('?open=place-1 opens that place', async () => {
    fakeRouter.reset('/settings', { section: 'notifications', open: 'place-1' })
    serve([place])
    wrap(<NotificationsPane />)
    expect(await screen.findByRole('region', { name: 'Dad phone' })).toBeTruthy()
  })
})

describe('iPhones row summary', () => {
  test('says Not set up when the box has no phone alerts', async () => {
    apiMock.mockImplementation(async (p, i) => {
      if (p === '/notify/places' && !i?.method) return [place]
      if (p === '/notify/settings') return base
      if (p === '/family') return { name: 'F', ntfy_upstream_relay: false }
      if (p === '/kids') return [{ id: 7, full_name: 'Mia', username: 'mia', avatar: null, has_pin: false, age_group: 'kid' }]
      if (p === '/kids/7/push') return { enabled: false, upstream: false, server: '', topic: '', link: '', qr_svg: '' }
      return {}
    })
    wrap(<NotificationsPane />)
    await waitFor(() => expect(screen.getByRole('button', { name: /iPhones/ })).toHaveTextContent('Not set up'))
  })
})
