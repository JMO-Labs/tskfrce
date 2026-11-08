import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { api } from '@/v2/api'
import { TodayPage } from '@/v2/today/TodayPage'
import { fakeRouter } from './helpers/fakeRouter'
import type { NeedsItem, Today, TodayKid } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn(), kidToken: () => null }))
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/contexts/UnifiedAuthContext', () => ({ useUnifiedAuth: () => ({ logout: jest.fn(), user: { id: 1 } }) }))
jest.mock('@/v2/chat/ChatDock', () => ({ ChatDock: () => null }))
jest.mock('@/v2/components/BlockerBanner', () => ({ BlockerBanner: () => null }))
jest.mock('@/v2/components/Bell', () => ({ Bell: () => null }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const apiMock = api as unknown as Mock<(p: string, init?: { method?: string; body?: unknown }) => Promise<unknown>>

const kid = (id: number, name: string): TodayKid => ({
  id, name, avatar: null, online_all: true, done: 0, total: 0, needs_you_count: 0, last_active: null,
  progress: { level: 1, title: 'New', xp: 0, floor: 0, next: 50, streak: 0 }, points: 0, earned: 0, next_reward: null,
  locks_at: null, devices: [], chores: [],
})
const at = (t: string) => `2026-10-24T${t}:00Z`
const item = (o: Partial<NeedsItem> & Pick<NeedsItem, 'type' | 'id' | 'title'>): NeedsItem => ({ kid_id: 3, kid_name: 'Maya', ...o })
const items = (): NeedsItem[] => [
  item({ type: 'chore', id: 1, kid_id: 3, kid_name: 'Maya', title: 'Make bed', submitted_at: at('19:00') }),
  item({ type: 'chore', id: 2, kid_id: 4, kid_name: 'Leo', title: 'Homework', submitted_at: at('18:45') }),
  item({ type: 'chore', id: 3, kid_id: 4, kid_name: 'Leo', title: 'Take out bins', submitted_at: at('18:30') }),
  item({ type: 'reward', id: 9, kid_id: 5, kid_name: 'Ava', title: 'Ice cream', cost: 20, kid_balance: 40, submitted_at: at('19:45') }),
]
let today: Today
const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test"><TodayPage /></MantineProvider>
    </QueryClientProvider>,
  )
const setToday = (needs: NeedsItem[]) => { today = { day: '2026-10-24', pending_approvals: 0, new_devices: [], kids: [kid(3, 'Maya'), kid(4, 'Leo'), kid(5, 'Ava')], needs_you: needs } }

beforeEach(() => {
  localStorage.clear()
  fakeRouter.reset('/', { focus: 'needs' })
  setToday(items())
  apiMock.mockReset()
  apiMock.mockImplementation(async (p, init) => {
    if (init?.method) return {}
    if (p === '/today') return today
    if (p === '/devices' || p === '/parents') return []
    if (p === '/hours') return { rules: [] }
    if (p.startsWith('/integration-widgets')) return []
    if (p.startsWith('/chat/threads')) return { total: 0, threads: [] }
    if (p === '/happy-hour') return { active: [], recent: [] }
    if (p === '/me/tips') return { dismissed: ['onboard.parent'] }
    if (p === '/family') return { timezone: 'UTC' }
    if (p === '/kids') return []
    return {}
  })
  global.fetch = jest.fn(() => Promise.resolve({ ok: false })) as unknown as typeof fetch
})

const body = async () => within(await screen.findByRole('region', { name: 'Needs you' }))
const rowOf = (t: string) => screen.getByText(t).closest('.p-arow') as HTMLElement

describe('Today Needs focus', () => {
  test('the kid strip sits above the list; ‹ All closes, a kid swaps focus; the kid cards step aside', async () => {
    wrap()
    await body()
    const strip = within(screen.getByRole('navigation', { name: 'Kids' }))
    expect(strip.queryByRole('button', { name: /^Needs/ })).toBeNull()
    expect(document.querySelectorAll('.pt-kcard')).toHaveLength(0)
    await userEvent.click(strip.getByRole('button', { name: /^Leo/ }))
    expect(fakeRouter.query.kid).toBe('4')
    expect(fakeRouter.query.focus).toBeUndefined()
  })

  test('?focus=needs opens the list in place, grouped by kid, oldest first', async () => {
    wrap()
    const b = await body()
    const heads = b.getAllByTestId('needs-group').map((g) => g.querySelector('.pt-ngroup-h')?.textContent)
    expect(heads).toEqual(['LLeo', 'MMaya', 'AAva'])
    const leo = b.getAllByTestId('needs-group')[0]
    const titles = [...leo.querySelectorAll('.p-arow-t')].map((e) => e.firstChild?.textContent)
    expect(titles).toEqual(['Take out bins', 'Homework'])
    expect(b.getByText('Oldest first, grouped by kid')).toBeInTheDocument()
  })

  test('each row has Approve and … with Send back and Reply', async () => {
    wrap()
    await body()
    const row = rowOf('Make bed')
    expect(within(row).getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    await userEvent.click(within(row).getByRole('button', { name: 'More for Make bed' }))
    expect(await screen.findByRole('menuitem', { name: 'Send back' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Reply' })).toBeInTheDocument()
    expect(screen.queryByRole('menuitem', { name: 'Decline' })).toBeNull()
  })

  test('Send back needs a note, then posts it', async () => {
    wrap()
    await body()
    await userEvent.click(within(rowOf('Make bed')).getByRole('button', { name: 'More for Make bed' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Send back' }))
    await userEvent.type(screen.getByLabelText('Note for sending back'), 'Pillows too')
    await userEvent.click(screen.getByRole('button', { name: 'Send back' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/chores/1/send-back', { method: 'POST', body: { note: 'Pillows too' } }))
  })

  test('screen time and reward rows keep Decline in …', async () => {
    wrap()
    await body()
    await userEvent.click(within(rowOf('Ice cream')).getByRole('button', { name: 'More for Ice cream' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Decline' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/redemptions/9/deny', { method: 'POST' }))
    await waitFor(() => expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ message: 'Declined' })))
  })

  test('an item from an earlier day keeps its older-day chip', async () => {
    setToday([item({ type: 'chore', id: 1, title: 'Old one', day: '2026-10-22', submitted_at: at('10:00') }), item({ type: 'chore', id: 2, title: 'New one', day: '2026-10-24', submitted_at: at('11:00') })])
    wrap()
    await body()
    expect(within(rowOf('Old one')).getByText('Thursday')).toBeInTheDocument()
    expect(within(rowOf('New one')).queryByText('Thursday')).toBeNull()
  })

  test('items without a kid group last as A kid; null submitted time sorts last', async () => {
    setToday([
      item({ type: 'chore', id: 1, kid_id: null, kid_name: null, title: 'Mystery', submitted_at: at('08:00') }),
      item({ type: 'chore', id: 2, title: 'No time', submitted_at: null }),
      item({ type: 'chore', id: 3, title: 'Timed', submitted_at: at('12:00') }),
    ])
    wrap()
    const b = await body()
    const groups = b.getAllByTestId('needs-group')
    expect(groups.map((g) => g.querySelector('.pt-ngroup-h')?.textContent)).toEqual(['MMaya', 'AA kid'])
    expect([...groups[0].querySelectorAll('.p-arow-t')].map((e) => e.firstChild?.textContent)).toEqual(['Timed', 'No time'])
  })

  test('type icon explains itself instead of a status chip', async () => {
    wrap()
    await body()
    expect(screen.queryByText('Needs OK')).toBeNull()
    await userEvent.click(within(rowOf('Make bed')).getByRole('button', { name: 'Needs OK' }))
    expect(await screen.findByText('Needs OK: they marked it done')).toBeInTheDocument()
  })

  test('Approve all approves every approvable item', async () => {
    setToday([...items(), item({ type: 'note', id: 50, title: 'Dishes', note: 'stuck' })])
    wrap()
    const b = await body()
    await userEvent.click(b.getByRole('button', { name: /Approve all/ }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/redemptions/9/approve', { method: 'POST' }))
    for (const id of [1, 2, 3]) expect(apiMock).toHaveBeenCalledWith(`/chores/${id}/approve`, { method: 'POST' })
    expect(apiMock).not.toHaveBeenCalledWith('/chores/50/approve', expect.anything())
  })

  test('approving the last item shows All caught up and the calm strip goes away', async () => {
    setToday([items()[0]])
    wrap()
    const b = await body()
    apiMock.mockImplementationOnce(async () => (setToday([]), {}))
    await userEvent.click(b.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByText('All caught up')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Needs you/, expanded: true }))
    await waitFor(() => expect(fakeRouter.query.focus).toBeUndefined())
    expect(screen.queryByRole('button', { name: /^Needs you/ })).toBeNull()
  })

  test('Esc and the strip head close Needs focus', async () => {
    wrap()
    await body()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(fakeRouter.query.focus).toBeUndefined())
    fakeRouter.reset('/', { focus: 'needs' })
    await body()
    await userEvent.click(screen.getByRole('button', { name: /^Needs you · 4/ }))
    await waitFor(() => expect(fakeRouter.query.focus).toBeUndefined())
  })
})
