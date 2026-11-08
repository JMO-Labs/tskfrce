import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { KidDetail } from '@/v2/manage/KidDetail'
import { aliasQuery } from '@/v2/parent/focusAliases'
import type { Kid } from '@/v2/types'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>

const kid: Kid = { id: 7, full_name: 'Maya', username: 'kid-maya', avatar: null, has_pin: true, age_group: 'teen', trust_mode: true, trust_level: 1, trust_clean: 18, trust_goal: 30, celebrate: 'full' }
const at = new Date().toISOString()
const points = Array.from({ length: 8 }, (_, i) => ({ id: i + 1, amount: i === 1 ? -5 : 10, reason: 'chore', label: `Reason ${i + 1}`, at }))
const selfApproved = [1, 2, 3, 4].map((id) => ({ id, title: `Chore ${id}`, day: '2026-11-06', approved_at: at, approved_via: 'trust', points: 20, photos: 0 }))
const asg = (over = {}) => ({ id: 1, kid_ids: [7], active: true, repeat: { type: 'daily', days: [] }, ...over })
const chores = [400, 401, 402].map((id) => ({ id, title: `Chore ${id}`, type_id: 1, assignments: [asg({ id })] }))
const sent = (path: string, method = 'PATCH') => apiMock.mock.calls.find(([p, i]) => p === path && i?.method === method)?.[1]?.body

const view = (query: Record<string, string> = {}) => {
  fakeRouter.reset('/kids', { section: 'kids', item: '7', ...query })
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test">
        <KidDetail kid={kid} onDeleted={() => {}} />
      </MantineProvider>
    </QueryClientProvider>,
  )
}
const q = () => fakeRouter.query
const rowHead = (id: string) => document.querySelector<HTMLElement>(`[data-focus-head="${id}"]`)!

beforeEach(() => {
  apiMock.mockReset().mockImplementation(async (p) => {
    if (p.startsWith('/kids/7/points')) return points
    if (p === '/today') return { day: '2026-11-06', kids: [{ id: 7, points: 240, progress: { level: 7 }, next_reward: 60 }] }
    if (p === '/devices') return [
      { id: 1, name: 'iPad', owner_ids: [7], online: true, exempt: false },
      { id: 2, name: 'Xbox', owner_ids: [7], online: true, exempt: false },
    ]
    if (p === '/chores/') return chores
    if (p === '/chore-types') return [{ id: 1, name: 'Chore', glyph: 'task_alt' }]
    if (p.endsWith('/self-approved')) return selfApproved
    if (p === '/kids/7/phones') return []
    return {}
  })
})

describe('calm', () => {
  test('header with one points chip, Level, Edit, … and four rows', async () => {
    view()
    expect(screen.getByRole('heading', { name: 'Maya', level: 2 })).toBeInTheDocument()
    expect(await screen.findByText('240 pts')).toBeInTheDocument()
    expect(screen.getAllByText('240 pts')).toHaveLength(1)
    expect(screen.getByText('Level 7')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More' })).toBeInTheDocument()
    for (const id of ['trust', 'devices', 'chores', 'settings']) expect(rowHead(id)).toBeInTheDocument()
    expect(screen.queryByText('Points history')).toBeNull()
    expect(await screen.findByText('4 approved on their own')).toBeInTheDocument()
    expect(rowHead('trust')).toBeInTheDocument()
    expect(await screen.findByText('2 devices · all open')).toBeInTheDocument()
    expect(await screen.findByText('3 daily')).toBeInTheDocument()
    expect(screen.getByText('Celebrations: Full')).toBeInTheDocument()
  })

  test('points chip pop-over shows the last 6 changes', async () => {
    view()
    await userEvent.click(await screen.findByRole('button', { name: /240 pts/ }))
    expect(await screen.findByText('Last 6 changes')).toBeInTheDocument()
    expect(screen.getAllByText(/^(Today .*|Yesterday|\w{3}, \w{3} \d+) · Reason \d$/)).toHaveLength(6)
    expect(screen.getByText('−5')).toBeInTheDocument()
    expect(screen.queryByText(/Reason 7/)).toBeNull()
  })

  test('… menu: Bonus, Deduct, View as kid, Remove', async () => {
    view()
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    const items = (await screen.findAllByRole('menuitem')).map((e) => e.textContent)
    expect(items).toEqual(['add_circleBonus', 'remove_circleDeduct', 'visibilityView as kid', 'closeRemove Maya'])
  })

  test('Bonus opens the form and the menu does not take focus back', async () => {
    view()
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    await userEvent.click((await screen.findAllByRole('menuitem'))[0])
    const pts = await screen.findByLabelText(/^Points \(/)
    await new Promise((r) => setTimeout(r, 400))
    expect(pts).toHaveFocus()
  })

  test('no Happy Hour button on the kid page', () => {
    view()
    expect(screen.queryByRole('button', { name: /happy hour/i })).toBeNull()
  })
})

describe('rows', () => {
  test('Trust row: switch on the calm line, list in the body', async () => {
    view()
    const sw = screen.getByRole('switch', { name: 'Trust mode' })
    expect(screen.getByText('18/30')).toBeInTheDocument()
    expect(screen.queryByText('Chore 1')).toBeNull()
    await userEvent.click(sw)
    await waitFor(() => expect(sent('/kids/7')).toEqual({ trust_mode: false }))
    await userEvent.click(rowHead('trust'))
    expect(q().open).toBe('trust')
    expect(await screen.findByText('Chore 1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change' })).toBeInTheDocument()
  })

  test('self-approved rows are quiet action rows with a … menu (up to 4)', async () => {
    view({ open: 'trust' })
    const more = await screen.findAllByRole('button', { name: /^More for Chore/ })
    expect(more).toHaveLength(4)
    expect(screen.queryByRole('button', { name: "Wasn't done" })).toBeNull()
    expect(more[0].closest('.p-arow')).not.toBeNull()
    await userEvent.click(more[0])
    expect((await screen.findAllByRole('menuitem')).map((e) => e.textContent)).toEqual(["undoWasn't done", 'chatOpen chat'])
    await userEvent.click(screen.getByRole('menuitem', { name: /Wasn't done/ }))
    const sheet = await screen.findByRole('dialog', { name: "Wasn't done?" })
    await userEvent.click(within(sheet).getByRole('button', { name: "Wasn't done" }))
    await waitFor(() => expect(sent('/chores/1/take-back', 'POST')).toEqual({ lower_trust: true }))
  })

  test('Trust row says None yet when nothing approved itself', async () => {
    apiMock.mockImplementation(async (p) => (p.endsWith('/self-approved') ? [] : p === '/today' ? { kids: [] } : []))
    view()
    expect(await screen.findByText('None yet')).toBeInTheDocument()
  })

  test('Devices row merges phones and ends with + Add a phone', async () => {
    apiMock.mockImplementation(async (p) =>
      p === '/kids/7/phones' ? [{ id: 5, label: 'Pixel', created_at: at, last_seen_at: at }]
      : p === '/devices' ? [{ id: 1, name: 'iPad', owner_ids: [7], online: true, exempt: false }, { id: 2, name: 'Xbox', owner_ids: [7], online: false, exempt: false }]
      : p === '/today' ? { kids: [] } : [],
    )
    view({ open: 'devices' })
    expect(await screen.findByText('1 open · 1 locked')).toBeInTheDocument()
    expect(await screen.findByText('Pixel')).toBeInTheDocument()
    const body = document.getElementById('srow-devices-body')!
    const last = body.querySelector('.kd-add')!
    await userEvent.click(within(last as HTMLElement).getByRole('button', { name: 'About phones' }))
    expect(await screen.findByText(/Not every kid has a phone/)).toBeInTheDocument()
    expect(within(last as HTMLElement).getByRole('button', { name: /Add a phone/ })).toBeInTheDocument()
    expect(within(body).getByText('iPad')).toBeInTheDocument()
    expect(within(body).getByText('Locked')).toBeInTheDocument()
  })

  test('Chores row: "6 daily" and each chore links to its editor', async () => {
    view({ open: 'chores' })
    const link = await screen.findByRole('link', { name: /Chore 400/ })
    expect(link).toHaveAttribute('href', '/kids?section=chores&item=400')
    expect(screen.getByRole('link', { name: /Edit in Chores/ })).toBeInTheDocument()
    expect(screen.getByText('3 daily')).toBeInTheDocument()
  })
})

describe('edit in place', () => {
  test('Edit turns Profile into inputs in place with a Save bar', async () => {
    view()
    fakeRouter.push.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    expect(fakeRouter.push).toHaveBeenCalledTimes(1)
    expect(fakeRouter.replace).not.toHaveBeenCalled()
    expect(q()).toEqual({ section: 'kids', item: '7', open: 'settings', edit: '1' })
    const name = await screen.findByRole('textbox', { name: 'Name' })
    expect(name).toHaveValue('Maya')
    expect(screen.getAllByText('Name')).toHaveLength(1)
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeInTheDocument()
    await userEvent.type(name, 's')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('/kids/7')).toEqual({ full_name: 'Mayas' }))
  })

  test('Cancel with changes asks Discard changes?', async () => {
    view({ open: 'settings', edit: '1' })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Name' }), 'x')
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    const d = await screen.findByRole('dialog', { name: 'Discard changes?' })
    expect(q().edit).toBe('1')
    await userEvent.click(within(d).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(q().edit).toBeUndefined())
    expect(q().open).toBe('settings')
  })

  test('Edit while Settings is already open moves focus into the form', async () => {
    view({ open: 'settings' })
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }))
    const name = await screen.findByRole('textbox', { name: 'Name' })
    await waitFor(() => expect(name).toHaveFocus())
  })

  test('closing edit drops pin=1 from the URL', async () => {
    view({ open: 'settings', edit: '1', pin: '1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(q().edit).toBeUndefined())
    expect(q().pin).toBeUndefined()
    expect(q().open).toBe('settings')
  })

  test('a link out of the page (back link, View as kid, tabs) asks first while dirty', async () => {
    view({ open: 'settings', edit: '1' })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Name' }), 'x')
    const go = () => fakeRouter.events.emit('routeChangeStart', '/kid?as=7', { shallow: false })
    expect(go).toThrow()
    const d = await screen.findByRole('dialog', { name: 'Discard changes?' })
    fakeRouter.push.mockClear()
    await userEvent.click(within(d).getByRole('button', { name: 'Discard' }))
    expect(fakeRouter.push).toHaveBeenCalledWith('/kid?as=7')
    // the push itself must pass the guard now
    expect(go).not.toThrow()
  })

  test('same-page changes and clean forms are never blocked', async () => {
    view({ open: 'settings', edit: '1' })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Name' }), 'x')
    expect(() => fakeRouter.events.emit('routeChangeStart', '/kids?section=kids&item=7&open=trust', { shallow: true })).not.toThrow()
    expect(() => fakeRouter.events.emit('routeChangeStart', '/kids?section=chores&item=7', { shallow: true })).toThrow()
  })

  test('Cancel without changes just closes edit', async () => {
    view({ open: 'settings', edit: '1' })
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(q().edit).toBeUndefined())
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('browser Back with changes asks Discard changes?', async () => {
    view({ open: 'settings', edit: '1' })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Name' }), 'x')
    expect(fakeRouter.beforePopState).toHaveBeenCalled()
    let go = true
    act(() => { go = fakeRouter.popHandler({}) })
    expect(go).toBe(false)
    expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument()
  })

  test('Esc with changes asks first and Keep stays in edit', async () => {
    view({ open: 'settings', edit: '1' })
    const name = await screen.findByRole('textbox', { name: 'Name' })
    await userEvent.type(name, 'x')
    await userEvent.keyboard('{Escape}')
    expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument()
    expect(q().edit).toBe('1')
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(q().edit).toBe('1')
  })

  test('closing the Settings row while dirty asks first', async () => {
    view({ open: 'settings', edit: '1' })
    await userEvent.type(await screen.findByRole('textbox', { name: 'Name' }), 'x')
    await userEvent.click(rowHead('settings'))
    expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument()
    expect(q().open).toBe('settings')
  })
})

describe('old links', () => {
  test('old &kid=&pin=1 link opens Settings in edit with PIN focused', async () => {
    expect(aliasQuery('/kids', { kid: '7', pin: '1' }, '')).toEqual({ section: 'kids', item: '7', open: 'settings', edit: '1', pin: '1' })
    view({ open: 'settings', edit: '1', pin: '1' })
    const pin = await screen.findByLabelText(/PIN \(4 digits\)/)
    await waitFor(() => expect(pin).toHaveFocus())
  })

  test('old #trust link opens Trust', async () => {
    expect(aliasQuery('/kids', { kid: '7' }, '#trust')).toEqual({ section: 'kids', item: '7', open: 'trust' })
    view({ open: 'trust' })
    expect(await screen.findByText('Chore 1')).toBeInTheDocument()
  })
})
