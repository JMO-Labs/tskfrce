import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { openChat } from '@/v2/chat/dock'
import { TodayPage } from '@/v2/today/TodayPage'
import { fakeRouter } from './helpers/fakeRouter'
import type { NeedsItem, Today, TodayKid } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn(), kidToken: () => null }))
jest.mock('@/v2/chat/dock', () => {
  const real = jest.requireActual<typeof import('@/v2/chat/dock')>('@/v2/chat/dock')
  return { ...real, openChat: jest.fn(real.openChat) }
})
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/contexts/UnifiedAuthContext', () => ({ useUnifiedAuth: () => ({ logout: jest.fn(), user: { id: 1 } }) }))
jest.mock('@/v2/chat/ChatDock', () => ({ ChatDock: () => null }))
jest.mock('@/v2/components/BlockerBanner', () => ({ BlockerBanner: () => null }))
jest.mock('@/v2/components/Bell', () => ({ Bell: () => null }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const apiMock = api as unknown as Mock<(p: string, init?: { method?: string; body?: unknown }) => Promise<unknown>>

const maya: TodayKid = {
  id: 3, name: 'Maya', avatar: null, online_all: true, done: 1, total: 3, needs_you_count: 3, last_active: '2026-10-24T19:44:00Z',
  progress: { level: 3, title: 'Pro', xp: 10, floor: 0, next: 50, streak: 16 }, points: 240, earned: 35, next_reward: 60,
  locks_at: '2026-10-25T21:30:00Z', devices: [],
  chores: [
    { id: 101, title: 'Dishes', points: 10, state: 'todo', due_time: null },
    { id: 102, title: 'Walk dog', points: 5, state: 'done', due_time: null },
    { id: 103, title: 'Make bed', points: 5, state: 'needs_you', due_time: null },
  ],
}
const leo: TodayKid = { ...maya, id: 4, name: 'Leo', done: 1, total: 4, needs_you_count: 0, points: 85, chores: [{ id: 202, title: 'Homework', points: 8, state: 'todo', due_time: null }] }
const ava: TodayKid = { ...maya, id: 5, name: 'Ava', done: 2, total: 2, needs_you_count: 1, points: 10, chores: [] }
const items: NeedsItem[] = [
  { type: 'chore', id: 103, kid_id: 3, kid_name: 'Maya', title: 'Make bed' },
  { type: 'screen_time', id: 7, kid_id: 3, kid_name: 'Maya', title: '30 min screen time', cost: 30, kid_balance: 240, device_name: 'Tablet' },
  { type: 'note', id: 101, kid_id: 3, kid_name: 'Maya', title: 'Dishes', note: 'Out of soap' },
  { type: 'reward', id: 9, kid_id: 5, kid_name: 'Ava', title: 'Ice cream', cost: 20, kid_balance: 40 },
]
const base = (o: Partial<Today> = {}): Today => ({ day: '2026-10-24', pending_approvals: 0, new_devices: [], kids: [maya, leo, ava], needs_you: items, ...o })
let today: Today
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrap = () => {
  qc.clear()
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider env="test"><TodayPage /></MantineProvider>
    </QueryClientProvider>,
  )
}
const MAYA = /^Maya(?! details)/

beforeEach(() => {
  localStorage.clear()
  fakeRouter.reset('/', { kid: '3' })
  today = base()
  apiMock.mockReset()
  apiMock.mockImplementation(async (p, init) => {
    if (init?.method) return {}
    if (p === '/today') return today
    if (p === '/devices' || p === '/hours' || p === '/parents') return p === '/hours' ? { rules: [] } : []
    if (p.startsWith('/integration-widgets')) return []
    const run = p.match(/^\/chores\/(\d+)$/)
    if (run) return { id: Number(run[1]), title: 'Dishes', points: 10, state: 'todo', kid_ids: [3], steps: [], photos: [], can_move: true }
    if (p.startsWith('/chat/threads/')) return { id: 5, kind: 'chore', title: 'Dishes', messages: [], has_more: false }
    if (p.startsWith('/chat/threads')) return { total: 0, threads: [] }
    if (p === '/happy-hour') return { active: [], recent: [] }
    if (p === '/me/tips') return { dismissed: ['onboard.parent'] }
    if (p === '/family') return { timezone: 'UTC' }
    if (p === '/kids') return [{ id: 3, full_name: 'Maya', username: 'maya', age_group: 'teen' }]
    return {}
  })
})

const focused = async () => within(await screen.findByRole('region', { name: "Maya's day" }))

describe('Today kid focus', () => {
  test('?kid= opens that kid in place and collapses others into the strip', async () => {
    wrap()
    const body = await focused()
    expect(body.getByText('Chores')).toBeInTheDocument()
    expect(body.getByText('Make bed')).toBeInTheDocument()
    const strip = within(screen.getByRole('navigation', { name: 'Kids' }))
    expect(strip.getByRole('button', { name: /^Leo/ })).toBeInTheDocument()
    expect(strip.getByRole('button', { name: /^Ava/ })).toBeInTheDocument()
    expect(strip.getByRole('button', { name: /^Maya/ })).toHaveAttribute('aria-pressed', 'true')
    expect(strip.getByRole('button', { name: /All/ })).toBeInTheDocument()
    expect(document.querySelectorAll('.pt-kcard')).toHaveLength(1)
    expect(screen.queryByRole('button', { name: /^Needs you ·/ })).toBeNull()
  })

  test('‹ All returns to calm', async () => {
    wrap()
    await focused()
    await userEvent.click(screen.getByRole('button', { name: /All/ }))
    await waitFor(() => expect(document.querySelectorAll('.pt-kcard')).toHaveLength(3))
    expect(fakeRouter.query.kid).toBeUndefined()
  })

  test('strip shows waiting dots and the Needs total', async () => {
    wrap()
    await focused()
    const strip = within(screen.getByRole('navigation', { name: 'Kids' }))
    expect(strip.getByRole('button', { name: /^Ava/ })).toHaveTextContent('1')
    expect(strip.getByRole('button', { name: /^Leo/ })).not.toHaveTextContent(/\d/)
    const needs = strip.getByRole('button', { name: /^Needs/ })
    expect(needs).toHaveTextContent('4')
    await userEvent.click(needs)
    expect(fakeRouter.query.focus).toBe('needs')
    expect(fakeRouter.query.kid).toBeUndefined()
  })

  test('picking another kid in the strip swaps the focus', async () => {
    wrap()
    await focused()
    await userEvent.click(screen.getByRole('button', { name: /^Leo/ }))
    expect(fakeRouter.query.kid).toBe('4')
  })

  test('waiting chore shows Approve and … once, not in Requests', async () => {
    wrap()
    const body = await focused()
    const row = body.getByText('Make bed').closest('[data-testid="chore-row"]') as HTMLElement
    expect(within(row).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(within(row).queryByText('Needs OK')).toBeNull()
    expect(body.getAllByText('Make bed')).toHaveLength(1)
    const reqs = within(body.getByText('Requests').parentElement as HTMLElement)
    expect(reqs.queryByText('Make bed')).toBeNull()
  })

  test('waiting chore actions are not inside the row button', async () => {
    wrap()
    const body = await focused()
    const rowBtn = body.getByText('Make bed').closest('button.pt-row') as HTMLElement
    expect(within(rowBtn).queryByRole('button')).toBeNull()
    const row = rowBtn.closest('[data-testid="chore-row"]') as HTMLElement
    expect(rowBtn).not.toContainElement(within(row).getByRole('button', { name: 'Approve' }))
  })

  test('Approve on a waiting chore approves that run', async () => {
    wrap()
    const body = await focused()
    const row = body.getByText('Make bed').closest('[data-testid="chore-row"]') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: 'Approve' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/chores/103/approve', expect.anything()))
  })

  test('non-chore requests show as a Requests group', async () => {
    wrap()
    const body = await focused()
    const grp = within(body.getByText('Requests').parentElement as HTMLElement)
    expect(grp.getByText('30 min screen time')).toBeInTheDocument()
    expect(grp.getByText('Dishes')).toBeInTheDocument() // the note
    expect(grp.getAllByRole('button', { name: 'Approve' })).toHaveLength(1) // screen time; the note has Reply
    expect(grp.getByRole('button', { name: 'Reply' })).toBeInTheDocument()
    await userEvent.click(grp.getAllByRole('button', { name: /^More/ })[0])
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Decline' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/redemptions/7/deny', expect.anything()))
  })

  test('no Requests group when the kid has none', async () => {
    today = base({ needs_you: [items[0]] })
    wrap()
    await focused()
    expect(screen.queryByText('Requests')).toBeNull()
  })

  test('Reply on a waiting chore keeps the kid in the URL', async () => {
    wrap()
    const body = await focused()
    const row = body.getByText('Make bed').closest('[data-testid="chore-row"]') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: /^More/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Reply' }))
    expect(fakeRouter.push).toHaveBeenCalledWith({ pathname: '/', query: { kid: '3', chore: '103' } })
    expect(openChat).toHaveBeenCalledWith('chore', '103')
  })

  test('Send back on a waiting chore asks for a note', async () => {
    wrap()
    const body = await focused()
    const row = body.getByText('Make bed').closest('[data-testid="chore-row"]') as HTMLElement
    await userEvent.click(within(row).getByRole('button', { name: /^More/ }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Send back' }))
    await userEvent.type(await screen.findByLabelText('Note for sending back'), 'Corners')
    await userEvent.click(screen.getByRole('button', { name: 'Send back' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/chores/103/send-back', expect.anything()))
  })

  test('kid … menu has Bonus, Deduct, View as kid, Open page and no Happy Hour', async () => {
    wrap()
    await focused()
    await userEvent.click(screen.getByRole('button', { name: 'More for Maya' }))
    expect(await screen.findByRole('menuitem', { name: 'Bonus' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Deduct' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'View as kid' })).toHaveAttribute('href', expect.stringContaining('/kid?as=3'))
    expect(screen.getByRole('menuitem', { name: 'Open page' })).toHaveAttribute('href', '/kids?section=kids&item=3')
    expect(screen.queryByRole('menuitem', { name: /Happy Hour/i })).toBeNull()
    expect(screen.getByRole('link', { name: /Add chore/ })).toHaveAttribute('href', '/kids?section=chores&item=new')
  })

  test('Bonus opens the points form under the bar', async () => {
    wrap()
    await focused()
    await userEvent.click(screen.getByRole('button', { name: 'More for Maya' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Bonus' }))
    expect(await screen.findByLabelText(/note/i)).toBeInTheDocument()
  })

  test('?kid=&chore= opens the chore sheet; Esc closes only the chore', async () => {
    fakeRouter.reset('/', { kid: '3', chore: '101' })
    wrap()
    const body = await focused()
    const row = body.getByText('Dishes', { selector: '.pt-title' }).closest('button.pt-row') as HTMLElement
    expect(row).toHaveAttribute('aria-expanded', 'true')
    await userEvent.keyboard('{Escape}')
    expect(fakeRouter.query.chore).toBeUndefined()
    expect(fakeRouter.query.kid).toBe('3')
    await userEvent.keyboard('{Escape}')
    expect(fakeRouter.query.kid).toBeUndefined()
  })

  test('tapping a chore row toggles ?chore=', async () => {
    wrap()
    const body = await focused()
    await userEvent.click(body.getByText('Dishes', { selector: '.pt-title' }).closest('button.pt-row') as HTMLElement)
    expect(fakeRouter.query.chore).toBe('101')
  })

  test('old ?chore= link focuses the chore on its kid', async () => {
    fakeRouter.reset('/', { chore: '103' })
    wrap()
    await waitFor(() => expect(fakeRouter.replace).toHaveBeenCalledWith(expect.objectContaining({ query: { kid: '3', chore: '103' } }), undefined, expect.anything()))
  })

  test('old ?item= link focuses that kid', async () => {
    fakeRouter.reset('/', { item: '4' })
    wrap()
    await waitFor(() => expect(fakeRouter.query.kid).toBe('4'))
  })

  test('unknown kid id falls back to calm', async () => {
    fakeRouter.reset('/', { kid: '999' })
    wrap()
    await waitFor(() => expect(fakeRouter.replace).toHaveBeenCalledWith(expect.objectContaining({ query: {} }), undefined, expect.anything()))
  })

  test('focused kid survives a refetch with fewer chores', async () => {
    wrap()
    await focused()
    today = base({ kids: [{ ...maya, chores: [maya.chores[0]] }, leo, ava] })
    await qc.invalidateQueries({ queryKey: ['today'] })
    await waitFor(() => expect(within(screen.getByRole('region', { name: "Maya's day" })).queryByText('Walk dog')).toBeNull())
    expect(fakeRouter.query.kid).toBe('3')
    expect(document.querySelectorAll('.pt-kcard')).toHaveLength(1)
  })

  test('Requests sub-line reads Asked <time> · <pts> pts', async () => {
    today = base({ needs_you: [items[0], { ...items[1], submitted_at: '2026-10-24T19:40:00Z' }] })
    wrap()
    const body = await focused()
    expect(body.getByText(/^Asked .* · 30 pts$/)).toBeInTheDocument()
  })

  test('focused rows drop the Approved and To do chips', async () => {
    wrap()
    const body = await focused()
    expect(body.queryByText('Approved')).toBeNull()
    expect(body.queryByText('To do')).toBeNull()
  })

  test('a team chore credited to another kid still gets Approve on this kid\'s row', async () => {
    today = base({ needs_you: [{ ...items[0], kid_id: 4, kid_name: 'Leo' }] })
    wrap()
    const body = await focused()
    const row = body.getByText('Make bed').closest('[data-testid="chore-row"]') as HTMLElement
    expect(within(row).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(within(row).queryByText('Needs OK')).toBeNull()
  })

  test('one lock: approving a row disables the other Approve buttons', async () => {
    let release: (v: unknown) => void = () => undefined
    const gate = new Promise((r) => (release = r))
    const impl = apiMock.getMockImplementation()!
    apiMock.mockImplementation(async (p, init) => (init?.method && p === '/chores/103/approve' ? gate : impl(p, init)))
    wrap()
    const body = await focused()
    await userEvent.click(body.getAllByRole('button', { name: 'Approve' })[0])
    await waitFor(() => body.getAllByRole('button', { name: 'Approve' }).forEach((b) => expect(b).toBeDisabled()))
    release({})
  })

  test('Bonus and Deduct are disabled until the kid record loads', async () => {
    const impl = apiMock.getMockImplementation()!
    apiMock.mockImplementation(async (p, init) => (p === '/kids' ? new Promise(() => undefined) : impl(p, init)))
    wrap()
    await focused()
    await userEvent.click(screen.getByRole('button', { name: 'More for Maya' }))
    expect(await screen.findByRole('menuitem', { name: 'Bonus' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Deduct' })).toBeDisabled()
  })

  test('header and tab bar are the same in calm and focus', async () => {
    fakeRouter.reset('/')
    wrap()
    await screen.findByRole('button', { name: MAYA })
    const shell = () => [document.querySelector('h1')?.textContent, document.querySelector('nav.p-tabbar, .p-tabbar')?.textContent, document.querySelector('.p-rail')?.textContent]
    const calm = shell()
    await userEvent.click(screen.getByRole('button', { name: MAYA }))
    await focused()
    expect(shell()).toEqual(calm)
  })

  test('opening a kid moves focus into its body; ‹ All returns focus to the kid row', async () => {
    fakeRouter.reset('/')
    wrap()
    const opener = await screen.findByRole('button', { name: MAYA })
    await userEvent.click(opener)
    const region = await screen.findByRole('region', { name: "Maya's day" })
    await waitFor(() => expect(document.activeElement).toBe(region))
    await userEvent.click(screen.getByRole('button', { name: /All/ }))
    await waitFor(() => expect(document.activeElement).toBe(document.querySelector('.pt-krow')))
  })

  test('opening a chore moves focus into its sheet; Esc returns focus to its row', async () => {
    wrap()
    const body = await focused()
    const row = body.getByText('Dishes', { selector: '.pt-title' }).closest('button.pt-row') as HTMLElement
    await userEvent.click(row)
    const sheet = await screen.findByRole('region', { name: 'Dishes details' })
    await waitFor(() => expect(document.activeElement).toBe(sheet))
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(document.activeElement).toBe(row))
  })
})
