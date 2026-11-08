import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { notifications } from '@mantine/notifications'
import { TodayPage } from '@/v2/today/TodayPage'
import { fakeRouter } from './helpers/fakeRouter'
import type { Today, TodayKid } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/contexts/UnifiedAuthContext', () => ({
  useUnifiedAuth: () => ({ logout: jest.fn(), user: { id: 1 } }),
}))
jest.mock('@/v2/chat/ChatDock', () => ({ ChatDock: () => null }))
jest.mock('@/v2/components/BlockerBanner', () => ({ BlockerBanner: () => null }))
jest.mock('@mantine/notifications')

const apiMock = api as unknown as Mock<
  (p: string, init?: { method?: string; body?: unknown }) => Promise<unknown>
>

const kid = (id: number, name = `Kid${id}`, done = 0, total = 2): TodayKid => ({
  id,
  name,
  avatar: null,
  online_all: true,
  done,
  total,
  needs_you_count: 0,
  last_active: null,
  progress: { level: 1, title: 'Rookie', xp: 0, floor: 0, next: 50, streak: 3 },
  points: 860,
  next_reward: 40,
  locks_at: '2026-10-25T20:00:00Z',
  chores: [
    { id: 10 + id, title: 'Dishes', points: 10, state: 'todo', due_time: null },
    { id: 20 + id, title: 'Laundry', points: 20, state: 'todo', due_time: null },
  ],
  devices: [],
})

const todayData = (overrides: Partial<Today> = {}): Today => ({
  day: '2026-10-24',
  pending_approvals: 0,
  new_devices: [],
  kids: [kid(1), kid(2)],
  ...overrides,
})

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>
  )

beforeEach(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as never
  apiMock.mockReset()
  fakeRouter.reset('/') // the onboarding card stays hidden: /me/tips is unanswered, which reads as dismissed
  apiMock.mockImplementation(async (p) => {
    if (p.endsWith('/deduct')) return { balance: 5, deducted: 20 }
    if (p === '/today') return todayData()
    if (p.match(/^\/chores\/\d+$/) && !p.endsWith('/approve') && !p.endsWith('/send-back'))
      return { id: 1, title: 'Dishes', points: 10, state: 'todo', due_time: null, kid_ids: [1], steps: [{ id: 1, title: 'Step 1', done: false, done_at: null }, { id: 2, title: 'Step 2', done: false, done_at: null }], photos: [] }
    if (p.startsWith('/chores/') && p.endsWith('/approve'))
      return { ok: true }
    if (p.startsWith('/chores/') && p.endsWith('/send-back'))
      return { ok: true }
    if (p.startsWith('/chat/threads'))
      return { total: 0, threads: [] }
    return undefined
  })
})

/** The calm row that focuses a kid (not the avatar details button). */
const kidRow = (name: string) => screen.findByRole('button', { name: new RegExp(`^${name}(?! details)`, 'i') })
const openKid = async (name = 'Kid1') => userEvent.click(await kidRow(name))

describe('TodayPage', () => {
  test('no leaderboard on Today', async () => {
    wrap(<TodayPage />)
    await waitFor(() => expect(screen.queryByText(/leaderboard|rankings/i)).not.toBeInTheDocument())
  })

  test('no new devices banner on parent Today', async () => {
    wrap(<TodayPage />)
    await waitFor(() => expect(screen.queryByText(/new device/i)).not.toBeInTheDocument())
  })

  test('no PINs nudge on parent Today', async () => {
    wrap(<TodayPage />)
    await waitFor(() => expect(screen.queryByText(/without pin|shared/i)).not.toBeInTheDocument())
  })

  test('no kids shows Add your first kid', async () => {
    apiMock.mockImplementation(async (p) => {
      if (p === '/today') return todayData({ kids: [] })
      return undefined
    })
    wrap(<TodayPage />)
    expect(await screen.findByText(/add your first kid/i)).toBeInTheDocument()
  })

  test('Needs strip shows the count, with no tabs', async () => {
    const data = todayData({
      needs_you: [{ type: 'chore', id: 1, kid_id: 1, kid_name: 'Kid1', title: 'Dishes' }],
    })
    apiMock.mockImplementation(async (p) => {
      if (p === '/today') return data
      return undefined
    })
    wrap(<TodayPage />)
    expect(await screen.findByRole('button', { name: /^needs you · 1/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab')).toBeNull()
  })

  test('focusing a kid shows their day with View as kid and Add chore buttons', async () => {
    wrap(<TodayPage />)
    await openKid()
    expect(await screen.findByRole('region', { name: /kid1.*s day/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /view as kid/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /add chore/i })).toHaveAttribute('href', '/kids?section=chores&item=new')
  })

  test('details pop-over shows real stats and the row shows the points', async () => {
    wrap(<TodayPage />)
    expect(await screen.findAllByText('860 pts')).toHaveLength(2)
    const avatar = await screen.findByRole('button', { name: 'Kid1 details' })
    expect(avatar).toHaveTextContent('K')
    expect(avatar).toHaveClass('pt-kav')
    await userEvent.click(avatar)
    const pop = await screen.findByText('Streak')
    const facts = pop.closest('.p-kid-facts') as HTMLElement
    expect(facts).toHaveTextContent('3 days')
    expect(facts).toHaveTextContent('40 pts')
    expect(facts).toHaveTextContent(/\d+:\d\d [AP]M/)
    expect(within(facts).getByText('Last active').nextSibling).toHaveTextContent('—')
  })

  test('chat opens beside the chore and closes', async () => {
    wrap(<TodayPage />)
    await openKid()
    await userEvent.click((await screen.findAllByRole('button', { name: /dishes/i }))[0])
    expect(screen.queryByTestId('chat-column')).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /open chat/i }))
    expect(screen.getByTestId('chat-column')).toBeInTheDocument()
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/chat/threads/chore/11', expect.anything()))
    await userEvent.click(screen.getByRole('button', { name: /close chat/i }))
    expect(screen.queryByTestId('chat-column')).not.toBeInTheDocument()
  })

  test('approve shows only for Needs OK and posts approve', async () => {
    const k = { ...kid(1), chores: [{ id: 11, title: 'Dishes', points: 10, state: 'needs_you' as const, due_time: null }] }
    const base = apiMock.getMockImplementation()!
    apiMock.mockImplementation(async (p, init) => (p === '/today' ? todayData({ kids: [k] }) : base(p, init)))
    wrap(<TodayPage />)
    await openKid()
    await userEvent.click(await screen.findByRole('button', { name: /dishes/i }))
    await userEvent.click(await screen.findByRole('button', { name: /approve \+10/i }))
    // withUndo holds the call for the undo window and shows a toast first
    expect(notifications.show).toHaveBeenCalled()
    expect(apiMock).not.toHaveBeenCalledWith('/chores/11/approve', expect.anything())
  })

  test('send back on an open chore needs a note', async () => {
    const k = { ...kid(1), chores: [{ id: 11, title: 'Dishes', points: 10, state: 'needs_you' as const, due_time: null }] }
    const base = apiMock.getMockImplementation()!
    apiMock.mockImplementation(async (p, init) => (p === '/today' ? todayData({ kids: [k] }) : base(p, init)))
    wrap(<TodayPage />)
    await openKid()
    await userEvent.click(await screen.findByRole('button', { name: /dishes/i }))
    await userEvent.click(await screen.findByRole('button', { name: /^send back$/i }))
    const send = screen.getAllByRole('button', { name: /^send back$/i }).at(-1)!
    expect(send).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Note for sending back'), 'Pans too')
    await userEvent.click(send)
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/chores/11/send-back', { method: 'POST', body: { note: 'Pans too' } }))
  })

  test('to-do chore has no approve; deduct posts amount and reason', async () => {
    wrap(<TodayPage />)
    await openKid()
    await userEvent.click((await screen.findAllByRole('button', { name: /dishes/i }))[0])
    await screen.findByRole('button', { name: /open chat/i })
    expect(screen.queryByRole('button', { name: /approve/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /deduct points/i }))
    await userEvent.click(screen.getByRole('button', { name: '−20' }))
    await userEvent.type(screen.getByLabelText('Reason'), 'Left plates')
    await userEvent.click(screen.getByRole('button', { name: /^deduct$/i }))
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/chores/11/deduct', { method: 'POST', body: { kid_id: 1, amount: 20, note: 'Left plates' } }),
    )
  })

  test('every kid row shows its chores progress ring', async () => {
    apiMock.mockImplementation(async (p) => (p === '/today' ? todayData({ kids: [kid(1, 'Kid1', 1, 2)] }) : undefined))
    wrap(<TodayPage />)
    expect(await screen.findByRole('img', { name: '1 of 2 done' })).toBeInTheDocument()
  })

  test('chore rows start collapsed', async () => {
    wrap(<TodayPage />)
    await openKid()
    const chores = await screen.findAllByText(/dishes|laundry/i)
    chores.forEach((chore) => {
      const row = chore.closest('[data-testid="chore-row"]')
      expect(row).toHaveAttribute('data-open', 'false')
    })
  })

  test('opening a second chore closes the first', async () => {
    wrap(<TodayPage />)
    await openKid()
    const rows = await screen.findAllByTestId('chore-row')
    const buttons = rows.map((r) => r.querySelector('button'))
    if (buttons[0]) await userEvent.click(buttons[0])
    await waitFor(() => expect(rows[0]).toHaveAttribute('data-open', 'true'))
    if (buttons[1]) await userEvent.click(buttons[1])
    await waitFor(() => {
      expect(rows[0]).toHaveAttribute('data-open', 'false')
      expect(rows[1]).toHaveAttribute('data-open', 'true')
    })
  })

  test('done chore shows line-through and Done time', async () => {
    const data = todayData({
      kids: [
        {
          ...kid(1),
          chores: [
            { id: 11, title: 'Dishes', points: 10, state: 'done', due_time: null, done_at: '2026-10-24T16:30:00Z' },
          ],
        },
      ],
    })
    apiMock.mockImplementation(async (p) => {
      if (p === '/today') return data
      return undefined
    })
    wrap(<TodayPage />)
    await openKid()
    const row = (await screen.findAllByTestId('chore-row'))[0]
    expect(row).toHaveAttribute('data-state', 'done')
    expect(await screen.findByText(/^done \d+:\d+ [ap]m · approved$/i)).toBeInTheDocument()
  })

  test('the old summary strip is gone', async () => {
    wrap(<TodayPage />)
    await kidRow('Kid1')
    expect(screen.queryByTestId('summary-strip')).toBeNull()
  })

  test('Earned today is the server\'s awarded points, in the avatar pop-over', async () => {
    const k = { ...kid(1), earned: 10 }
    apiMock.mockImplementation(async (p) => (p === '/today' ? todayData({ kids: [k] }) : undefined))
    wrap(<TodayPage />)
    await userEvent.click(await screen.findByRole('button', { name: 'Kid1 details' }))
    expect(await screen.findByText('Earned today: 10')).toBeInTheDocument()
  })

  test('needs you lists all kids\' items', async () => {
    const data = todayData({
      needs_you: [
        { type: 'chore', id: 1, kid_id: 1, kid_name: 'Kid1', title: 'Dishes' },
        { type: 'chore', id: 2, kid_id: 2, kid_name: 'Kid2', title: 'Laundry' },
      ],
      kids: [],
    })
    apiMock.mockImplementation(async (p) => {
      if (p === '/today') return data
      return undefined
    })
    wrap(<TodayPage />)
    await userEvent.click(await screen.findByRole('button', { name: /^needs you · 2/i }))
    const dishesItems = screen.getAllByText(/dishes/i)
    expect(dishesItems.length).toBeGreaterThan(0)
    expect(await screen.findByText(/laundry/i)).toBeInTheDocument()
  })
})
