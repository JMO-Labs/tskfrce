import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import type { ReactNode } from 'react'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fridgeTheme } from '@/v2/theme'
import { api } from '@/v2/api'
import { BadgesCustom } from '@/v2/manage/BadgesCustom'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn(), hide: jest.fn() } }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))

const apiMock = api as unknown as Mock<(p: string, o?: { method?: string; body?: unknown }) => Promise<unknown>>
const kids = [
  { id: 7, full_name: 'Mia', username: 'kid-mia', avatar: null, has_pin: false },
  { id: 8, full_name: 'Leo', username: 'kid-leo', avatar: null, has_pin: false },
]
const badges = [
  { id: 1, name: 'Kindness', icon: 'favorite', description: 'Was extra kind' },
  { id: 2, name: 'Brave try', icon: 'rocket_launch', description: 'Tried something hard' },
]
const overview = [{ key: 'custom:1', name: 'Kindness', description: '', icon: 'favorite', custom: true, tiers: { '7': 1, '8': 0 } }]
const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MantineProvider theme={fridgeTheme}>{ui}</MantineProvider>
  </QueryClientProvider>
)
let release: (v: unknown) => void = () => {}
let live = badges
const serve = (pending = false) => {
  live = [...badges]
  return apiMock.mockReset().mockImplementation(async (path, o) => {
    if (path === '/custom-badges' && o?.method === 'POST') { live = [...live, { id: 9, ...(o.body as object) } as (typeof badges)[0]]; return { id: 9 } }
    if (path === '/custom-badges' && !o?.method) return pending ? new Promise((r) => { release = r }).then(() => live) : live
    if (path === '/kids') return kids
    if (path === '/badges/overview') return overview
    if (path.endsWith('/award')) return { tier: 2 }
    return {}
  })
}
const show = (query: Record<string, string> = {}) => {
  fakeRouter.reset('/kids', { section: 'badges', item: 'custom', ...query })
  return render(wrap(<BadgesCustom />))
}
const writes = () => apiMock.mock.calls.filter(([, o]) => o?.method)

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  global.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
  Element.prototype.scrollIntoView = jest.fn()
})
beforeEach(() => serve())

describe('custom badges, calm', () => {
  test('one line per badge with who has it', async () => {
    show()
    const row = (await screen.findByRole('button', { name: /Kindness/ })).closest('section') as HTMLElement
    expect(row).toHaveTextContent('Mia · Copper')
    expect(row).not.toHaveTextContent('Leo')
    expect((screen.getByRole('button', { name: /Brave try/ })).closest('section')).toHaveTextContent('Not awarded yet')
    expect(screen.getByRole('heading', { name: 'Custom badges' })).toBeInTheDocument()
    expect(screen.getByText('Each award moves a kid up a tier.')).toBeInTheDocument()
    expect(screen.queryByLabelText('Badge name')).toBeNull()
    expect(screen.queryByRole('region', { name: /^Award / })).toBeNull()
  })

  test('focusing a badge opens its editor in place', async () => {
    show()
    await userEvent.click(await screen.findByRole('button', { name: /Kindness/ }))
    expect(fakeRouter.query.pick).toBe('1')
    expect(await screen.findByLabelText('Badge name')).toHaveValue('Kindness')
    expect(screen.getByLabelText('Description')).toHaveValue('Was extra kind')
    expect(screen.getByText('Tiers so far')).toBeInTheDocument()
    expect(screen.getByText('Mia Copper · Leo –')).toBeInTheDocument()
  })

  test('icon grid is in a pop-over', async () => {
    show({ pick: '1' })
    await screen.findByLabelText('Badge name')
    expect(screen.queryByTitle('pets')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Change icon' }))
    await userEvent.click(await screen.findByTitle('pets'))
    expect(await screen.findByRole('region', { name: 'Unsaved changes' })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByTitle('pets')).toBeNull()) // the pop-over closes on pick
    await waitFor(() => expect(screen.getByRole('button', { name: 'Change icon' })).toHaveFocus())
  })

  test('award form appears only after tapping Award', async () => {
    show({ pick: '1' })
    await screen.findByLabelText('Badge name')
    expect(screen.queryByLabelText(/Note to/)).toBeNull()
    const toggle = screen.getByRole('button', { name: 'Award' })
    expect(toggle).not.toHaveAttribute('aria-controls')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-controls', 'award-1')
    const form = await screen.findByRole('region', { name: 'Award Kindness' })
    expect(within(form).getByRole('group', { name: 'Award to' })).toBeInTheDocument()
    expect(within(form).getByTestId('award-preview')).toHaveTextContent(/Mia gets\s*Silver/)
    await userEvent.type(within(form).getByLabelText('Note to Mia (optional)'), 'Shared')
    await userEvent.click(within(form).getByRole('button', { name: 'Award Kindness' }))
    await waitFor(() => expect(writes()[0]).toEqual(['/custom-badges/1/award', { method: 'POST', body: { kid_id: 7, note: 'Shared' } }]))
  })

  test('Award is disabled while the award is in flight and a failure is shown', async () => {
    show({ pick: '1' })
    await screen.findByLabelText('Badge name')
    await userEvent.click(screen.getByRole('button', { name: 'Award' }))
    let fail: (e: Error) => void = () => {}
    apiMock.mockImplementation(async (p, o) => (o?.method ? new Promise((_, rej) => { fail = rej }) : p === '/kids' ? kids : p === '/badges/overview' ? overview : badges))
    const give = await screen.findByRole('button', { name: 'Award Kindness' })
    await userEvent.click(give)
    await waitFor(() => expect(give).toBeDisabled())
    fail(new Error('nope'))
    expect(await screen.findByRole('alert')).toHaveTextContent(/nope|didn't work/i)
    await waitFor(() => expect(give).toBeEnabled())
  })

  test('Save bar only after a change; Delete only in …', async () => {
    show({ pick: '1' })
    const name = await screen.findByLabelText('Badge name')
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete badge' })).toBeNull()
    await userEvent.type(name, ' really')
    await userEvent.click(await screen.findByRole('button', { name: 'Save badge' }))
    await waitFor(() => expect(writes()[0]).toEqual(['/custom-badges/1', { method: 'PATCH', body: { name: 'Kindness really', icon: 'favorite', description: 'Was extra kind' } }]))
    await userEvent.click(screen.getByRole('button', { name: 'More for Kindness' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete badge' }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Delete' }))
    await waitFor(() => expect(writes().some(([p, o]) => p === '/custom-badges/1' && o?.method === 'DELETE')).toBe(true))
  })

  test('?pick= deep link survives the list loading', async () => {
    serve(true)
    show({ pick: '2' })
    await new Promise((r) => setTimeout(r, 30))
    expect(fakeRouter.replace).not.toHaveBeenCalled()
    release(null)
    expect(await screen.findByLabelText('Badge name')).toHaveValue('Brave try')
    expect(fakeRouter.query.pick).toBe('2')
  })

  test('an unknown pick is dropped once the list is known', async () => {
    show({ pick: '99' })
    await waitFor(() => expect(fakeRouter.query.pick).toBeUndefined())
  })

  test('editor has an Award button and a … menu named for the badge', async () => {
    show({ pick: '1' })
    await screen.findByLabelText('Badge name')
    expect(screen.getByRole('button', { name: 'Award' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'More for Kindness' }))
    expect(await screen.findByRole('menuitem', { name: 'Delete badge' })).toBeInTheDocument()
  })

  test('+ New opens a new row at the top', async () => {
    show()
    await userEvent.click(await screen.findByRole('button', { name: 'New' }))
    expect(fakeRouter.query.pick).toBe('new')
    expect(await screen.findByLabelText('Badge name')).toHaveValue('')
    expect(screen.queryByRole('button', { name: 'Award' })).toBeNull()
    await userEvent.type(screen.getByLabelText('Badge name'), 'Pet hero')
    expect(screen.getByRole('button', { name: 'Add badge' })).toBeDisabled()
    await userEvent.click(screen.getByRole('button', { name: 'Change icon' }))
    await userEvent.click(await screen.findByTitle('pets'))
    await userEvent.click(screen.getByRole('button', { name: 'Add badge' }))
    await waitFor(() => expect(writes()[0]).toEqual(['/custom-badges', { method: 'POST', body: { name: 'Pet hero', icon: 'pets', description: '' } }]))
    await waitFor(() => expect(fakeRouter.query.pick).toBe('9'))
    expect(await screen.findByRole('button', { name: /Pet hero/, expanded: true })).toBeInTheDocument()
    expect(screen.getByLabelText('Badge name')).toHaveValue('Pet hero')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('custom badges, unsaved edits', () => {
  test('opening another badge asks once; Discard discards', async () => {
    show({ pick: '1' })
    await userEvent.type(await screen.findByLabelText('Badge name'), 'X')
    await userEvent.click(screen.getByRole('button', { name: /Brave try/ }))
    const dlg = await screen.findByRole('dialog')
    expect(fakeRouter.query.pick).toBe('1')
    await userEvent.click(within(dlg).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(fakeRouter.query.pick).toBe('2'))
    expect(await screen.findByLabelText('Badge name')).toHaveValue('Brave try')
    await userEvent.click(screen.getByRole('button', { name: /Kindness/ }))
    expect(await screen.findByLabelText('Badge name')).toHaveValue('Kindness')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('closing an edited row asks and stays open', async () => {
    show({ pick: '1' })
    await userEvent.type(await screen.findByLabelText('Badge name'), 'X')
    await userEvent.click(screen.getByRole('button', { name: /Kindness/, expanded: true }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(fakeRouter.query.pick).toBe('1')
  })

  test('browser Back out of an edited badge asks instead of dropping the edits', async () => {
    show({})
    await userEvent.click(await screen.findByRole('button', { name: /Brave try/ })) // pushes ?pick=
    await waitFor(() => expect(fakeRouter.query.pick).toBe('2'))
    await userEvent.type(await screen.findByLabelText('Badge name'), 'X')
    const go = jest.spyOn(window.history, 'go').mockImplementation(() => {})
    act(() => { expect(fakeRouter.popHandler({ as: '/kids?section=badges&item=custom' })).toBe(false) })
    go.mockRestore()
    expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument()
    expect(fakeRouter.query.pick).toBe('2')
  })

  test('Esc on an edited row asks instead of closing', async () => {
    show({ pick: '1' })
    await userEvent.type(await screen.findByLabelText('Badge name'), 'X')
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(fakeRouter.query.pick).toBe('1')
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(fakeRouter.query.pick).toBeUndefined())
  })

  test('Esc with the icon pop-over or the menu open closes only that', async () => {
    show({ pick: '1' })
    await userEvent.type(await screen.findByLabelText('Badge name'), 'X')
    await userEvent.click(screen.getByRole('button', { name: 'Change icon' }))
    await screen.findByTitle('pets')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByTitle('pets')).toBeNull())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fakeRouter.query.pick).toBe('1')
    await userEvent.click(screen.getByRole('button', { name: 'More for Kindness' }))
    await screen.findByRole('menuitem', { name: 'Delete badge' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: 'Delete badge' })).toBeNull())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(fakeRouter.query.pick).toBe('1')
  })

  test('+ New asks too', async () => {
    show({ pick: '1' })
    await userEvent.type(await screen.findByLabelText('Badge name'), 'X')
    await userEvent.click(screen.getByRole('button', { name: 'New' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(fakeRouter.query.pick).toBe('1')
  })
})
