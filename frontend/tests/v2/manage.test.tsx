import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import type { ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { notifications } from '@mantine/notifications'
import { fridgeTheme } from '@/v2/theme'
import { api } from '@/v2/api'
import { DeviceDetail } from '@/v2/manage/DeviceDetail'
import { GroupDetail } from '@/v2/manage/GroupDetail'
import { KidProfileForm } from '@/v2/manage/KidEditor'
import { DevicesPage } from '@/v2/manage/DevicesPage'
import { SettingsPage } from '@/v2/manage/SettingsPage'
import type { Device, Family, Kid } from '@/v2/types'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@/v2/parent/ParentShell', () => ({
  ParentShell: ({ children }: { children: ReactNode }) => <>{children}</>,
}))
jest.mock('@/v2/components/RequireParent', () => ({
  RequireParent: ({ children }: { children: ReactNode }) => <>{children}</>,
  startSignOut: jest.fn(),
  cancelSignOut: jest.fn(),
}))
jest.mock('@/v2/parent/useLook', () => ({
  useLook: jest.fn(),
}))
jest.mock('@/contexts/UnifiedAuthContext', () => ({
  useUnifiedAuth: jest.fn(() => ({
    user: { id: '1', username: 'testuser' },
    logout: jest.fn(),
  })),
}))
jest.mock('@/v2/chat/ChatDock', () => ({
  ChatDock: () => null,
}))
jest.mock('@/v2/components/BlockerBanner', () => ({
  BlockerBanner: () => null,
}))
jest.mock('@/v2/components/Bell', () => ({
  Bell: () => null,
}))
jest.mock('@/v2/hooks/useChat', () => ({
  useThreads: jest.fn(() => ({
    data: { total: 0 },
  })),
}))

const apiMock = api as unknown as Mock<(p: string, init?: { method?: string; body?: unknown }) => Promise<unknown>>

const kids: Kid[] = [
  { id: 7, full_name: 'Maya', username: 'kid-maya', avatar: null, has_pin: false },
  { id: 8, full_name: 'Leo', username: 'kid-leo', avatar: null, has_pin: true },
]
const device: Device = {
  id: 1,
  name: 'Maya laptop',
  mac: 'aa:bb',
  vendor: 'Dell',
  status: 'unassigned',
  owner_ids: [],
  group_ids: [],
  online: false,
  override: null,
  last_seen: null,
  resisting: false,
}
const family: Family = {
  name: 'Soto',
  timezone: 'America/New_York',
  reset_time: '04:00',
  new_devices_blocked: true,
  points_unlock_early: false,
  early_bonus_cap: 5,
  screen_time_price: 20,
  gifs_enabled: false,
  gif_rating: 'g',
  giphy_key_set: false, ntfy_upstream_relay: false,
}

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MantineProvider theme={fridgeTheme}>{ui}</MantineProvider>
  </QueryClientProvider>
)
const menu = async (name: RegExp) => {
  await userEvent.click(screen.getByRole('button', { name: 'More' }))
  return userEvent.click(await screen.findByRole('menuitem', { name }))
}
const openRow = (open: string) => fakeRouter.reset('/devices', { item: '1', open })
const openGroupRow = (open: string) => fakeRouter.reset('/devices', { tab: 'groups', item: '3', open })
const calls = (method: string) => apiMock.mock.calls.filter(([, i]) => i?.method === method)

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  global.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  Element.prototype.scrollIntoView = jest.fn()
})

beforeEach(() => {
  fakeRouter.reset('/devices')
  jest.mocked(notifications.show).mockClear()
  apiMock.mockReset().mockImplementation(async (path) => {
    if (path === '/family') return family
    if (path === '/hours') return { today: null, rules: [] }
    if (path === '/groups') return []
    if (path === '/kids') return kids
    return {}
  })
})

describe('devices', () => {
  test('assigning an owner PATCHes owner_ids', async () => {
    render(wrap(<DeviceDetail device={device} kids={kids} onRequestOverride={() => {}} />))
    await userEvent.click(screen.getByRole('button', { name: 'Maya' }))
    await waitFor(() =>
      expect(calls('PATCH')[0]).toEqual(['/devices/1', { method: 'PATCH', body: { owner_ids: [7] } }]),
    )
  })

  test('guest toggle PATCHes status guest', async () => {
    render(wrap(<DeviceDetail device={device} kids={kids} onRequestOverride={() => {}} />))
    await userEvent.click(screen.getByRole('switch', { name: /Guest/ }))
    await waitFor(() =>
      expect(calls('PATCH')[0]).toEqual(['/devices/1', { method: 'PATCH', body: { status: 'guest' } }]),
    )
  })

  test('delete asks first, then toasts Deleted', async () => {
    render(wrap(<DeviceDetail device={device} kids={kids} onRequestOverride={() => {}} />))
    await menu(/Delete$/)
    expect(calls('DELETE')).toHaveLength(0)
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls('DELETE')[0][0]).toBe('/devices/1'))
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Deleted' })))
  })

  test('shows the got-around chip when device.resisting', () => {
    render(wrap(<DeviceDetail device={{ ...device, resisting: true }} kids={kids} onRequestOverride={() => {}} />))
    expect(screen.getByRole('button', { name: /Got around the lock/ })).toBeInTheDocument()
  })

  test('hides the chip otherwise', () => {
    render(wrap(<DeviceDetail device={device} kids={kids} onRequestOverride={() => {}} />))
    expect(screen.queryByRole('button', { name: /Got around the lock/ })).toBeNull()
  })

  test('Test block button posts and toasts message', async () => {
    apiMock.mockImplementation(async () => ({ reason: 'ok', message: 'Blocked fine', offline: false, router_resisted: false }))
    render(wrap(<DeviceDetail device={device} kids={kids} onRequestOverride={() => {}} />))
    await menu(/Test block$/)
    await waitFor(() => expect(calls('POST')[0]).toEqual(['/devices/1/test-block', { method: 'POST' }]))
    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Blocked fine', color: 'fridgeGreen' })),
    )
  })

  test('Test block non-ok reason toasts red', async () => {
    apiMock.mockImplementation(async () => ({ reason: 'router', message: 'x' }))
    render(wrap(<DeviceDetail device={device} kids={kids} onRequestOverride={() => {}} />))
    await menu(/Test block$/)
    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'x', color: 'fridgeRed' })),
    )
  })

  test('Test block failure shows the fail toast', async () => {
    apiMock.mockImplementation(async () => {
      throw new Error("The home box didn't answer. Is it plugged in?")
    })
    render(wrap(<DeviceDetail device={device} kids={kids} onRequestOverride={() => {}} />))
    await menu(/Test block$/)
    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ title: "That didn't work", color: 'fridgeRed' }),
      ),
    )
  })

  test('Test block ignores a second run while the first is pending', async () => {
    apiMock.mockImplementation(() => new Promise(() => {}))
    render(wrap(<DeviceDetail device={device} kids={kids} onRequestOverride={() => {}} />))
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.dblClick(await screen.findByRole('menuitem', { name: /Test block$/ }))
    expect(calls('POST')).toHaveLength(1)
  })

  test('Lock now shows busy while an override is running', () => {
    render(wrap(<DeviceDetail device={device} kids={kids} pendingAction="lock" onRequestOverride={() => {}} />))
    expect(screen.getByRole('button', { name: /Lock now/ })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('button', { name: /Unlock 30 min/ })).toBeNull()
  })

  test('Unlock is disabled while another override is running', () => {
    render(wrap(<DeviceDetail device={{ ...device, status: 'assigned', owner_ids: [7] }} kids={kids} pendingAction="clear" onRequestOverride={() => {}} />))
    expect(screen.getByRole('button', { name: /Unlock 30 min/ })).toBeDisabled()
  })

  test('rename saves on blur and reverts when emptied', async () => {
    render(wrap(<DeviceDetail device={device} kids={kids} onRequestOverride={() => {}} />))
    const input = screen.getByRole('textbox', { name: 'Device name' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Den laptop')
    await userEvent.tab()
    await waitFor(() => expect(calls('PATCH')[0]).toEqual(['/devices/1', { method: 'PATCH', body: { name: 'Den laptop' } }]))
    await userEvent.clear(input)
    await userEvent.tab()
    expect(input).toHaveValue('Maya laptop')
    expect(calls('PATCH')).toHaveLength(1)
  })

  test('an unknown device opens Details; the chip copy follows the block-new-devices setting', async () => {
    render(wrap(<DeviceDetail device={device} kids={kids} onRequestOverride={() => {}} />))
    expect(await screen.findByRole('group', { name: 'Owners' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText(/new and blocked until you say/)).toBeInTheDocument() // family fixture blocks
    await userEvent.click(screen.getByRole('button', { name: 'Maya' }))
    await waitFor(() => expect(calls('PATCH')[0]).toEqual([`/devices/${device.id}`, { method: 'PATCH', body: { owner_ids: [kids[0].id] } }]))
  })

  test('learning mode says the new device stays online', async () => {
    apiMock.mockImplementation(async (path) => (path === '/family' ? { ...family, new_devices_blocked: false } : []))
    render(wrap(<DeviceDetail device={device} kids={kids} onRequestOverride={() => {}} />))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/family'))
    await userEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(await screen.findByText(/stays online until you say/)).toBeInTheDocument()
  })

  test('guest disables the owner pills', () => {
    openRow('details')
    render(wrap(<DeviceDetail device={{ ...device, status: 'guest' }} kids={kids} onRequestOverride={() => {}} />))
    expect(screen.getByRole('button', { name: 'Maya' })).toBeDisabled()
  })

  test('a group pill adds the device to that group', async () => {
    const g = { id: 3, name: 'Tablets', device_ids: [9], owner_ids: [] }
    render(wrap(<DeviceDetail device={device} kids={kids} groups={[g]} onRequestOverride={() => {}} />))
    await userEvent.click(screen.getByRole('button', { name: 'Tablets' }))
    await waitFor(() =>
      expect(calls('PATCH')[0]).toEqual(['/groups/3', { method: 'PATCH', body: { name: 'Tablets', device_ids: [9, 1] } }]),
    )
  })

  test('group create POSTs name and members', async () => {
    const onSelect = jest.fn()
    render(wrap(<GroupDetail devices={[device]} kids={kids} onSelect={onSelect} onRequestOverride={() => {}} />))
    await userEvent.type(screen.getByLabelText('Group name'), 'Tablets')
    await userEvent.click(screen.getByRole('button', { name: 'Maya laptop' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create group' }))
    await waitFor(() =>
      expect(calls('POST')[0]).toEqual(['/groups', { method: 'POST', body: { name: 'Tablets', device_ids: [1] } }]),
    )
  })

  describe('group screen price', () => {
    const g = { id: 3, name: 'Tablets', device_ids: [1], owner_ids: [], icon: 'tv', chore_lock: true, screen_price: null as number | null }
    const mount = (grp = g, group_pricing = true) => {
      openGroupRow('gset')
      apiMock.mockImplementation(async (path) => (path === '/screen-time' ? { enabled: true, price: 20, group_pricing } : {}))
      render(wrap(<GroupDetail group={grp} devices={[device]} kids={kids} onSelect={() => {}} onRequestOverride={() => {}} />))
    }
    test('hidden while group pricing is off', async () => {
      mount(g, false)
      await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p === '/screen-time')).toBe(true))
      await act(() => new Promise((r) => setTimeout(r, 0))) // let the query settle
      expect(screen.queryByLabelText('Screen time price')).toBeNull()
    })
    test('hidden while screen time is off, even with group pricing on', async () => {
      openGroupRow('gset')
      apiMock.mockImplementation(async (path) => (path === '/screen-time' ? { enabled: false, price: 20, group_pricing: true } : {}))
      render(wrap(<GroupDetail group={g} devices={[device]} kids={kids} onSelect={() => {}} onRequestOverride={() => {}} />))
      await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p === '/screen-time')).toBe(true))
      await act(() => new Promise((r) => setTimeout(r, 0)))
      expect(screen.queryByLabelText('Screen time price')).toBeNull()
    })
    test('hidden on a free group (chore lock off)', async () => {
      mount({ ...g, chore_lock: false })
      await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p === '/screen-time')).toBe(true))
      await act(() => new Promise((r) => setTimeout(r, 0))) // let the query settle
      expect(screen.queryByLabelText('Screen time price')).toBeNull()
      expect(screen.queryByText(/Leave empty to use the family price/)).toBeNull()
    })
    test('a price blur during another save is retried after it', async () => {
      let release = () => {}
      let patches = 0
      apiMock.mockImplementation(async (path, opts) => {
        if (path === '/screen-time') return { enabled: true, price: 20, group_pricing: true }
        if ((opts as { method?: string } | undefined)?.method === 'PATCH' && patches++ === 0) await new Promise<void>((r) => (release = r))
        return {}
      })
      openGroupRow('gset')
      render(wrap(<GroupDetail group={g} devices={[device]} kids={kids} onSelect={() => {}} onRequestOverride={() => {}} />))
      const input = await screen.findByLabelText('Screen time price')
      await userEvent.click(screen.getByRole('switch', { name: /Lock with the kids/ })) // another save, held open
      await userEvent.type(input, '40')
      await userEvent.tab() // dropped: a save is in flight
      expect(calls('PATCH')).toHaveLength(1)
      release()
      await waitFor(() => expect(calls('PATCH')[1]).toEqual(['/groups/3', { method: 'PATCH', body: { name: 'Tablets', device_ids: [1], screen_price: 40 } }]))
    })
    test('placeholder shows the family price; typing 40 saves screen_price 40', async () => {
      mount()
      const input = await screen.findByPlaceholderText('Family price (20)')
      await userEvent.type(input, '40')
      await userEvent.tab()
      await waitFor(() => expect(calls('PATCH')[0]).toEqual(['/groups/3', { method: 'PATCH', body: { name: 'Tablets', device_ids: [1], screen_price: 40 } }]))
    })
    test('clearing sends screen_price null', async () => {
      mount({ ...g, screen_price: 40 })
      const input = await screen.findByLabelText('Screen time price')
      await userEvent.clear(input)
      await userEvent.tab()
      await waitFor(() => expect(calls('PATCH')[0][1].body).toEqual({ name: 'Tablets', device_ids: [1], screen_price: null }))
    })
    test('out of range shows an error and does not save', async () => {
      mount()
      await userEvent.type(await screen.findByLabelText('Screen time price'), '5000')
      await userEvent.tab()
      expect(screen.getByText('Must be 1000 or less.')).toBeInTheDocument()
      expect(calls('PATCH')).toHaveLength(0)
    })
  })

  test('group delete asks first, then DELETEs', async () => {
    const g = { id: 3, name: 'Tablets', device_ids: [1], owner_ids: [] }
    render(wrap(<GroupDetail group={g} devices={[device]} kids={kids} onSelect={() => {}} onRequestOverride={() => {}} />))
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete group/ }))
    expect(calls('DELETE')).toHaveLength(0)
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(calls('DELETE')[0][0]).toBe('/groups/3'))
  })

  test('group rename saves on blur', async () => {
    openGroupRow('gset')
    const g = { id: 3, name: 'Tablets', device_ids: [1], owner_ids: [] }
    render(wrap(<GroupDetail group={g} devices={[device]} kids={kids} onSelect={() => {}} onRequestOverride={() => {}} />))
    const input = screen.getByLabelText('Group name')
    await userEvent.clear(input)
    await userEvent.type(input, 'Screens')
    await userEvent.tab()
    await waitFor(() =>
      expect(calls('PATCH')[0]).toEqual(['/groups/3', { method: 'PATCH', body: { name: 'Screens', device_ids: [1] } }]),
    )
  })
})

describe('devices page', () => {
  const serve = (devices: Device[]) =>
    apiMock.mockImplementation(async (path) => (path === '/devices' ? devices : path === '/kids' ? kids : path === '/groups' ? [] : {}))

  test('opens the first device and Lock now calls the box', async () => {
    serve([device])
    render(wrap(<DevicesPage />))
    await userEvent.click(await screen.findByRole('button', { name: /lock now/i }))
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`/devices/${device.id}/override`, {
        method: 'POST',
        body: { action: 'lock', minutes: null },
      }),
    )
  })

  test('a locked device offers Unlock 30 min instead', async () => {
    serve([{ ...device, status: 'assigned', owner_ids: [7] }])
    render(wrap(<DevicesPage />))
    expect(screen.queryByRole('button', { name: /lock now/i })).toBeNull()
    await userEvent.click(await screen.findByRole('button', { name: /unlock 30 min/i }))
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith(`/devices/${device.id}/override`, {
        method: 'POST',
        body: { action: 'unlock', minutes: 30 },
      }),
    )
  })
})

describe('groups deep link', () => {
  test('?tab=groups&item=1 opens group 1, not the device that shares id 1', async () => {
    apiMock.mockImplementation(async (path) => {
      if (path === '/devices') return [{ ...device, status: 'assigned', owner_ids: [7] }]
      if (path === '/kids') return kids
      if (path === '/groups') return [{ id: 1, name: 'Tablets', device_ids: [1] }]
      return []
    })
    fakeRouter.reset('/devices', { item: '1', tab: 'groups' })
    render(wrap(<DevicesPage />))
    expect(await screen.findByRole('heading', { name: 'Tablets' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Devices.*1 of 1 device/ })).toBeTruthy()
    expect(screen.queryByLabelText('Device name')).toBeNull()
  })
})

describe('PIN', () => {
  test('Remove PIN sends clear_pin, and only shows when a PIN is set', async () => {
    apiMock.mockResolvedValue({})
    const { unmount } = render(wrap(<KidProfileForm kid={kids[0]} onSaved={() => {}} />))
    expect(screen.queryByRole('button', { name: 'Remove PIN' })).toBeNull()
    unmount()
    render(wrap(<KidProfileForm kid={kids[1]} onSaved={() => {}} />))
    await userEvent.click(screen.getByRole('button', { name: 'Remove PIN' }))
    await waitFor(() =>
      expect(calls('PATCH')[0]).toEqual(['/kids/8', { method: 'PATCH', body: { clear_pin: true } }]),
    )
  })
})

describe('settings', () => {
  test('the Household row opens to the name, and nothing needs a Save button', async () => {
    fakeRouter.reset('/settings', { section: 'family', open: 'hh' })
    render(wrap(<SettingsPage />))
    expect(await screen.findByLabelText('Family name')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
  })

  test('an empty family name asks for one and is not sent', async () => {
    fakeRouter.reset('/settings', { section: 'family', open: 'hh' })
    render(wrap(<SettingsPage />))
    await userEvent.clear(await screen.findByLabelText('Family name'))
    expect(screen.getByText('Give your family a name.')).toBeInTheDocument()
    await userEvent.tab()
    expect(apiMock.mock.calls.some((c) => (c as unknown[])[1] && (c[1] as { method?: string }).method === 'PATCH')).toBe(false)
  })
})

describe('props passing', () => {
  test('DevicesPage passes groups and hour rules props correctly', async () => {
    const testGroup = { id: 1, name: 'Test Group', device_ids: [1], owner_ids: [7] }
    apiMock.mockImplementation(async (path) => {
      if (path === '/devices') return [device]
      if (path === '/kids') return kids
      if (path === '/groups') return [testGroup]
      if (path === '/hours') return { today: null, rules: [] }
      return {}
    })
    fakeRouter.reset('/devices', { item: '1' })
    render(wrap(<DevicesPage />))
    await waitFor(() => {
      expect(apiMock).toHaveBeenCalledWith('/devices')
      expect(apiMock).toHaveBeenCalledWith('/groups')
      expect(apiMock).toHaveBeenCalledWith('/hours')
    })
  })
})
