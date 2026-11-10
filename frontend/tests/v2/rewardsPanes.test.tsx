import { describe, expect, test } from '@jest/globals'
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { notifications } from '@mantine/notifications'
import { KidsPage } from '@/v2/manage/KidsPage'
import { apiMock, calls, detail, list, mockRoute, serve, setupLibrary, wrap } from './libraryHelpers'

jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn(), hide: jest.fn() } }))
jest.mock('next/router', () => ({
  useRouter: () => ({ query: mockRoute.query, push: mockRoute.push, replace: mockRoute.replace, pathname: '/kids' }),
}))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
const mockDownload = jest.fn()
jest.mock('@/v2/manage/historyCsv', () => ({
  ...jest.requireActual<object>('@/v2/manage/historyCsv'),
  downloadCsv: (...a: unknown[]) => mockDownload(...a),
}))
jest.mock('@/v2/parent/ParentShell', () => ({
  ParentShell: ({ list, children }: { list: ReactNode; children: ReactNode }) => (
    <>
      <div data-testid="list">{list}</div>
      <div data-testid="detail">{children}</div>
    </>
  ),
}))
jest.mock('@/v2/components/RequireParent', () => ({
  RequireParent: ({ children }: { children: ReactNode }) => <>{children}</>,
  startSignOut: jest.fn(),
  cancelSignOut: jest.fn(),
}))

setupLibrary()

const pending = [
  { id: 41, kid_id: 7, kid_name: 'Maya', kind: 'reward', name: 'Movie night', icon: 'movie', minutes: null, cost: 100, created_at: '2026-10-25T17:51:00Z', kid_balance: 300, kid_balance_after: 200 },
  { id: 42, kid_id: 8, kid_name: 'Leo', kind: 'reward', name: 'Ice cream trip', icon: 'icecream', minutes: null, cost: 150, created_at: '2026-10-25T18:10:00Z', kid_balance: 95, kid_balance_after: -55 },
]
const rewards = [
  { id: 3, name: 'Movie night', price: 150, icon: 'movie', visible: true, needs_approval: true },
  { id: 4, name: 'Birthday pick', price: 500, icon: 'cake', visible: false, needs_approval: true },
]
const screenTime = {
  enabled: true,
  price: 20,
  kids: [
    { kid_id: 7, name: 'Maya', balance: 300, bought_today: 0, max_minutes: null, limit: null },
    { kid_id: 8, name: 'Leo', balance: 95, bought_today: 0, max_minutes: null, limit: null },
  ],
}
const data = (over: Record<string, unknown> = {}) =>
  serve({ '/redemptions': pending, '/rewards': rewards, '/screen-time': screenTime, ...over })

const leoCard = async () => (await within(detail()).findByText('Ice cream trip')).closest('article') as HTMLElement

describe('rewards: requests', () => {
  test('a short request shows the negative balance, Not enough points and a disabled Approve', async () => {
    data()
    mockRoute.query = { section: 'rewards', item: 'requests' }
    render(wrap(<KidsPage />))
    const card = await leoCard()
    expect(card).toHaveTextContent('95 → -55')
    expect(card).toHaveTextContent('Not enough points')
    expect(within(card).getByRole('button', { name: 'Approve' })).toBeDisabled()
    expect(within(card).getByRole('button', { name: 'Decline' })).toBeEnabled()
  })

  test('Decline sends the note to /deny', async () => {
    data()
    mockRoute.query = { section: 'rewards', item: 'requests' }
    render(wrap(<KidsPage />))
    const card = await leoCard()
    await userEvent.type(within(card).getByPlaceholderText('Add a note (optional)…'), 'Save up first')
    await userEvent.click(within(card).getByRole('button', { name: 'Decline' }))
    await waitFor(() =>
      expect(calls('POST')[0]).toEqual(['/redemptions/42/deny', { method: 'POST', body: { note: 'Save up first' } }]),
    )
  })

  test('Approve all posts /approve-all and reports skipped requests', async () => {
    data({ '/redemptions/approve-all': { approved: 1, skipped: 1 } })
    mockRoute.query = { section: 'rewards', item: 'requests' }
    render(wrap(<KidsPage />))
    await userEvent.click(await within(detail()).findByRole('button', { name: 'Approve all' }))
    await waitFor(() => expect(calls('POST')[0]).toEqual(['/redemptions/approve-all', { method: 'POST' }]))
    await waitFor(() =>
      expect(notifications.show).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Approved 1, 1 skipped (not enough points)' }),
      ),
    )
  })

  test('nav shows the waiting count; no requests shows the empty state', async () => {
    data({ '/redemptions': [] })
    mockRoute.query = { section: 'rewards', item: 'requests' }
    render(wrap(<KidsPage />))
    expect(await within(detail()).findByText('No requests')).toBeInTheDocument()
    expect(within(list()).getByRole('button', { name: /Requests/ })).toHaveTextContent('Nothing waiting')
    await waitFor(() => expect(within(list()).getByRole('button', { name: /Catalogue/ })).toHaveTextContent('2 rewards · 1 hidden'))
  })

  test('while requests are loading nothing claims 0 waiting', async () => {
    data({ '/redemptions': new Promise(() => {}) })
    mockRoute.query = { section: 'rewards', item: 'requests' }
    render(wrap(<KidsPage />))
    await waitFor(() => expect(within(list()).getByRole('button', { name: /Catalogue/ })).toHaveTextContent('2 rewards'))
    expect(within(list()).getByRole('button', { name: /Requests/ })).not.toHaveTextContent(/waiting/i)
    expect(within(detail()).queryByText(/waiting/)).not.toBeInTheDocument()
  })
})

test('a screen-time request card names the device', async () => {
  data({ '/redemptions': [{ ...pending[0], id: 61, kind: 'screen_time', name: '30 min of screen time', icon: null, minutes: 30, device_name: 'Kitchen tablet' }] })
  mockRoute.query = { section: 'rewards', item: 'requests' }
  render(wrap(<KidsPage />))
  expect(await within(detail()).findByText(/from Kitchen tablet/)).toBeInTheDocument()
})

test('request cards use the icon sent with the request, not a name match', async () => {
  data({
    '/redemptions': [
      { ...pending[0], id: 51, name: 'Treat', icon: 'cake' },
      { ...pending[0], id: 52, kind: 'screen_time', name: '30 min of screen time', icon: null, minutes: 30 },
      { ...pending[0], id: 53, name: 'Gone', icon: null },
    ],
    '/rewards': [{ id: 9, name: 'Treat', price: 10, icon: 'movie', visible: true, needs_approval: true }],
  })
  mockRoute.query = { section: 'rewards', item: 'requests' }
  render(wrap(<KidsPage />))
  const glyph = async (name: string) =>
    ((await within(detail()).findByText(name)).closest('article') as HTMLElement).querySelector('.rw-glyph')?.textContent
  expect(await glyph('Treat')).toBe('cake')
  expect(await glyph('30 min of screen time')).toBe('timer')
  expect(await glyph('Gone')).toBe('redeem')
})

describe('rewards: catalogue', () => {
  test('hidden rewards get a Hidden chip; dots say who can afford it', async () => {
    data()
    mockRoute.query = { section: 'rewards', item: 'catalogue' }
    render(wrap(<KidsPage />))
    const card = (await within(detail()).findByRole('button', { name: /Birthday pick/ })) as HTMLElement
    expect(card).toHaveTextContent('Hidden')
    const movie = within(detail()).getByRole('button', { name: /Movie night/ })
    expect(await within(movie).findByLabelText('Maya can afford it')).toBeInTheDocument()
    expect(within(movie).getByLabelText("Leo can't afford it yet")).toBeInTheDocument()
  })

  test('with nothing picked the first reward opens in the editor', async () => {
    data()
    mockRoute.query = { section: 'rewards', item: 'catalogue' }
    render(wrap(<KidsPage />))
    expect(await within(detail()).findByRole('button', { name: 'Save reward' })).toBeInTheDocument()
    expect(within(detail()).getAllByRole('button', { name: /pts/ })[0]).toHaveAttribute('data-selected', 'true')
  })

  test('turning Needs approval off saves needs_approval:false', async () => {
    data()
    mockRoute.query = { section: 'rewards', item: 'catalogue', pick: '3' }
    render(wrap(<KidsPage />))
    const sw = await within(detail()).findByRole('switch', { name: 'Needs approval' })
    await userEvent.click(sw)
    expect(within(detail()).getByText('Points come off right away and you get a ping.')).toBeInTheDocument()
    await userEvent.click(within(detail()).getByRole('button', { name: 'Save reward' }))
    await waitFor(() =>
      expect(calls('PATCH')[0]).toEqual([
        '/rewards/3',
        { method: 'PATCH', body: { name: 'Movie night', price: 150, needs_approval: false } },
      ]),
    )
  })

  test('picking the movie glyph sends icon movie', async () => {
    data()
    mockRoute.query = { section: 'rewards', item: 'catalogue', pick: 'new' }
    render(wrap(<KidsPage />))
    await userEvent.type(await within(detail()).findByLabelText('Reward'), 'Film')
    await userEvent.click(within(detail()).getByTitle('movie'))
    await userEvent.click(within(detail()).getByRole('button', { name: 'Add reward' }))
    await waitFor(() =>
      expect(calls('POST')[0]).toEqual(['/rewards', { method: 'POST', body: { name: 'Film', price: 50, icon: 'movie' } }]),
    )
  })
})

const sam = { kid_id: 9, name: 'Sam', balance: 95, bought_today: 0, max_minutes: null, limit: null, saved: 0 }
const stFull = {
  enabled: true,
  price: 20,
  max_minutes_per_day: 60,
  auto_approve: false,
  only_in_allowed_hours: true,
  group_pricing: true,
  rollover: true,
  bank_cap: null,
  reset_time: '04:00',
  avg_chore_points: 20,
  kids: [
    { kid_id: 7, name: 'Maya', balance: 860, bought_today: 30, max_minutes: 60, limit: null, saved: 0 },
    { kid_id: 8, name: 'Leo', balance: 310, bought_today: 15, max_minutes: 30, limit: { max_minutes: 30, min_points: null }, saved: 0 },
    sam,
  ],
}

describe('rewards: screen time', () => {
  const show = async (st: object, row: string) => {
    data({ '/screen-time': st })
    mockRoute.query = { section: 'rewards', item: 'screen', open: row }
    render(wrap(<KidsPage />))
  }

  test('group pricing switch saves on change', async () => {
    await show({ ...stFull, group_pricing: false }, 'gprice')
    const sw = await within(detail()).findByRole('switch', { name: 'Different prices for device groups' })
    expect(sw).not.toBeChecked()
    expect(within(detail()).getByText(/Charge more for some devices, like game consoles\./)).toBeInTheDocument()
    expect(within(detail()).queryByRole('link', { name: 'Set group prices' })).toBeNull()
    await userEvent.click(sw)
    await waitFor(() => expect(calls('PATCH')[0]).toEqual(['/screen-time', { method: 'PATCH', body: { group_pricing: true } }]))
  })

  test('saved group pricing shows the Set group prices link', async () => {
    await show(stFull, 'gprice')
    expect(await within(detail()).findByRole('link', { name: 'Set group prices' })).toHaveAttribute('href', '/devices?tab=groups')
  })

  test('Approve buys without asking PATCHes only auto_approve', async () => {
    await show(stFull, 'auto')
    await userEvent.click(await within(detail()).findByRole('switch', { name: 'Approve buys without asking' }))
    await waitFor(() => expect(calls('PATCH')[0]).toEqual(['/screen-time', { method: 'PATCH', body: { auto_approve: true } }]))
  })

  test('rules summaries, what points buy in Price, and one row per kid', async () => {
    await show(stFull, 'price')
    const pane = detail()
    expect(await within(pane).findByRole('button', { name: /^Price.*20 pts = 15 min/ })).toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: /^Max per day.*60 min/ })).toBeInTheDocument()
    expect(within(pane).getByText(/An average chore \(20 pts\) buys 15 min\./)).toHaveTextContent('An average chore (20 pts) buys 15 min. Today Maya can buy up to 10h 45m, Leo 3h 45m, Sam 1h.')
    expect(within(pane).getByText('bought today · resets 4:00 AM')).toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: /^Leo.*30 min\/day/ })).toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: /^Maya.*Family max/ })).toBeInTheDocument()
    expect(within(pane).queryByRole('region', { name: 'What points buy' })).toBeNull()
  })

  test("a kid's minimum of 100 PUTs the limit", async () => {
    await show(stFull, 'kid-9')
    await userEvent.type(await within(detail()).findByRole('textbox', { name: 'Sam not allowed until (pts)' }), '100')
    await userEvent.tab()
    await waitFor(() =>
      expect(calls('PUT')[0]).toEqual(['/screen-time/limits/9', { method: 'PUT', body: { max_minutes: null, min_points: 100 } }]),
    )
  })
})

const hist = {
  totals: { spent: 2140, screen_minutes: 375, approved: 18, declined: 3 },
  rows: [
    { id: 1, kid_id: 7, kid_name: 'Maya', kind: 'screen_time', name: '15 min screen time', minutes: 15, cost: 20, status: 'approved', auto: true, decided_by_name: null, note: null, created_at: '2026-10-25T17:12:00Z', decided_at: '2026-10-25T17:12:00Z' },
    { id: 2, kid_id: 8, kid_name: 'Leo', kind: 'reward', name: 'New game', minutes: null, cost: 300, status: 'denied', auto: false, decided_by_name: 'Mom', note: "let's talk Sat", created_at: '2026-10-24T17:12:00Z', decided_at: '2026-10-24T17:12:00Z' },
  ],
}

describe('rewards: history', () => {
  const open = () => {
    mockRoute.query = { section: 'rewards', item: 'history' }
    render(wrap(<KidsPage />))
    return detail()
  }

  test('calm: one totals chip, no KPI tiles; rows show name, kid and when, Auto and Declined chips, amounts', async () => {
    data({ '/redemptions/history?days=30': hist })
    const pane = open()
    expect(await within(pane).findByRole('button', { name: /2,140 pts spent/ })).toBeInTheDocument()
    expect(within(pane).queryByText('Screen time bought')).toBeNull()
    const maya = within(pane).getByText('15 min screen time').closest('li') as HTMLElement
    expect(maya).toHaveTextContent('Maya')
    expect(maya).toHaveTextContent('Auto')
    expect(maya).toHaveTextContent('−20')
    expect(maya).not.toHaveTextContent('auto-approved')
    const leo = within(pane).getByText('New game').closest('li') as HTMLElement
    expect(leo).toHaveTextContent('Declined')
    expect(leo).not.toHaveTextContent('Mom')
  })

  test('totals pop-over holds all four figures', async () => {
    data({ '/redemptions/history?days=30': hist })
    const pane = open()
    await userEvent.click(await within(pane).findByRole('button', { name: /pts spent/ }))
    const pop = await screen.findByText('Screen time bought')
    expect(pop.parentElement).toHaveTextContent('6h 15m')
    expect(screen.getByText('Approved').parentElement).toHaveTextContent('18')
    expect(screen.getByText('Declined', { selector: 'div' }).parentElement).toHaveTextContent('3')
  })

  test('a row opens a pop-over with who decided and the note', async () => {
    data({ '/redemptions/history?days=30': hist })
    const pane = open()
    await userEvent.click((await within(pane).findByText('New game')).closest('button') as HTMLElement)
    expect(await screen.findByText('Declined by Mom')).toBeInTheDocument()
    expect(screen.getByText('“let\'s talk Sat”')).toBeInTheDocument()
  })

  test('a kid pill refetches with kid_id; All kids resets', async () => {
    data({ '/redemptions/history?days=30': hist, '/redemptions/history?days=30&kid_id=8': { ...hist, rows: [hist.rows[1]] } })
    const pane = open()
    await within(pane).findByText('15 min screen time')
    await userEvent.click(within(pane).getByRole('button', { name: 'Leo' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/redemptions/history?days=30&kid_id=8'))
    await waitFor(() => expect(within(pane).queryByText('15 min screen time')).toBeNull())
    expect(within(pane).getByRole('button', { name: 'Leo' })).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(within(pane).getByRole('button', { name: 'All kids' }))
    expect(await within(pane).findByText('15 min screen time')).toBeInTheDocument()
  })

  test('type switch All / Rewards / Screen time refetches with kind', async () => {
    data({ '/redemptions/history?days=30': hist, '/redemptions/history?days=30&kind=reward': { ...hist, rows: [hist.rows[1]] } })
    const pane = open()
    await within(pane).findByText('15 min screen time')
    const group = within(pane).getByRole('group', { name: 'Type' })
    expect(within(group).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Rewards', 'Screen time'])
    await userEvent.click(within(group).getByRole('button', { name: 'Rewards' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/redemptions/history?days=30&kind=reward'))
    await userEvent.click(within(group).getByRole('button', { name: 'All' }))
    expect(await within(pane).findByText('15 min screen time')).toBeInTheDocument()
  })

  test('CSV export is reachable and downloads rewards-history.csv with a header line', async () => {
    data({ '/redemptions/history?days=30': hist })
    const pane = open()
    await userEvent.click(await within(pane).findByRole('button', { name: 'Export CSV' }))
    expect(mockDownload).toHaveBeenCalledWith('rewards-history.csv', expect.stringMatching(/^date,kid,item,kind,status,points,decided_by,note\n/))
  })

  test('no rows shows Nothing yet and disables Export CSV', async () => {
    data({ '/redemptions/history?days=30': { totals: { spent: 0, screen_minutes: 0, approved: 0, declined: 0 }, rows: [] } })
    const pane = open()
    expect(await within(pane).findByText('Nothing yet')).toBeInTheDocument()
    expect(within(pane).getByRole('button', { name: 'Export CSV' })).toBeDisabled()
  })
})
