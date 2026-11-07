import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { RecapBody } from '@/v2/recap/RecapPage'
import { Sparkline } from '@/v2/recap/Sparkline'
import { FLAG_RANK, looksOf, type Recap, type RecapFlag, type RecapKid } from '@/v2/recap/recapTypes'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@/v2/today/HappyHourButton', () => ({
  HappyHourButton: ({ kidId, label, accent }: { kidId?: number; label?: string; accent?: boolean }) => <button type="button" data-variant={accent ? 'accent' : undefined}>{label} for {kidId}</button>,
}))
const apiMock = api as unknown as Mock<(p: string) => Promise<unknown>>

const flag = (kind: string, text: string, action: string, n: object = { count: 2, now: 6, was: 11 }) => ({ kind, text, action, ...n }) as RecapFlag
const kid = (id: number, name: string, over: Partial<RecapKid> = {}): RecapKid => ({
  id, name, flags: [], done: 5, done_trend: [12, 11, 10, 11, 5], on_time_pct: 64, on_time_avg: 88,
  points_earned: 400, points_spent: 150, screen_minutes_bought: 100, streak: 16, enough_history: true, ...over,
})
const week = (kids: RecapKid[], over: Partial<Recap> = {}): Recap => ({
  week_start: '2026-10-26', week_end: '2026-11-01', prev: '2026-10-19', next: null, kids,
  family_line: null, all_good: !kids.some((k) => k.flags.length), ...over,
})
const FLAGGED = week([
  kid(1, 'Leo', {
    flags: [
      flag('catches', 'Leo had 2 spot-check catches this week.', 'trust', { count: 2 }),
      flag('dropping', "Leo's chores are down 45% over 2 weeks.", 'happy_hour'),
      flag('later', 'Leo is finishing chores later than usual.', 'kid'),
    ],
  }),
  kid(2, 'Maya', { done: 20, enough_history: true, flags: [flag('streak_ended', "Maya's 9-day streak ended this week.", 'kid', { count: 9 })] }),
])
const serve = (r: Recap) => apiMock.mockImplementation(async (p) => (p.startsWith('/recap') ? r : undefined))
const show = async () => {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <RecapBody />
    </QueryClientProvider>,
  )
  await screen.findByRole('region', { name: 'This week' })
}

beforeEach(() => apiMock.mockReset())

describe('looksOf', () => {
  test('most serious first across kids, stable inside a rank', () => {
    const a = kid(1, 'A', { flags: [flag('later', 't', 'kid')] })
    const b = kid(2, 'B', { flags: [flag('catches', 't', 'trust'), flag('later', 't', 'kid')] })
    const c = kid(3, 'C', { flags: [flag('later', 't', 'kid')] })
    expect(looksOf([a, b, c]).map((l) => [l.kid.id, l.flag.kind])).toEqual([[2, 'catches'], [1, 'later'], [2, 'later'], [3, 'later']])
  })
  test('rank follows the backend flag order', () => {
    expect(Object.keys(FLAG_RANK)).toEqual(['catches', 'dropping', 'later', 'streak_ended'])
  })
})

describe('Worth a look', () => {
  test('one family list, max 3, most serious first, with See all', async () => {
    serve(FLAGGED)
    await show()
    const card = screen.getByRole('region', { name: 'Worth a look' })
    const titles = within(card).getAllByRole('listitem').map((li) => li.querySelector('b')?.textContent)
    expect(titles).toEqual(['Leo: 2 needed another go', 'Leo: fewer chores', 'Leo: finishing later'])
    expect(within(card).getByText('6 a week, was 11')).toBeTruthy()
    await userEvent.click(within(card).getByRole('button', { name: 'See all' }))
    expect(within(card).getAllByRole('listitem')).toHaveLength(4)
    expect(card.textContent).toContain('Maya: 9‑day streak ended')
    expect(within(card).queryByRole('button', { name: 'See all' })).toBeNull()
  })
  test('hidden when no kid has flags', async () => {
    serve(week([kid(1, 'Leo'), kid(2, 'Maya')]))
    await show()
    expect(screen.queryByRole('region', { name: 'Worth a look' })).toBeNull()
    expect(screen.getByText('All good this week. Nothing needs a look.')).toBeTruthy()
  })
  test('each action goes to its target', async () => {
    serve(FLAGGED)
    await show()
    const card = screen.getByRole('region', { name: 'Worth a look' })
    expect(within(card).getByRole('button', { name: 'Happy Hour for 1' })).toBeTruthy()
    const links = within(card).getAllByRole('link', { name: 'Open' })
    expect(links[0].getAttribute('href')).toBe('/kids?section=kids&kid=1#trust') // trust
    expect(links[1].getAttribute('href')).toBe('/kids?section=kids&kid=1') // kid
    expect(links[0].getAttribute('href')).not.toBe(links[1].getAttribute('href'))
  })
})

describe('This week', () => {
  test('one line per kid with chip', async () => {
    serve(FLAGGED)
    await show()
    const card = screen.getByRole('region', { name: 'This week' })
    expect(within(card).getByText('3 to look at')).toBeTruthy()
    expect(within(card).getByText('1 to look at')).toBeTruthy()
    expect(within(card).getByText('5 chores')).toBeTruthy()
    expect(within(card).getAllByText('avg 11')[0]).toBeTruthy()
    const i = within(card).getByRole('button', { name: 'About these numbers' })
    expect(i.getAttribute('aria-expanded')).toBe('false')
    expect(within(card).queryByText(/Arrows compare with the average/)).toBeNull()
    await userEvent.click(i)
    expect(i.getAttribute('aria-expanded')).toBe('true')
    expect(within(card).getByText(/^Arrows compare with the average of the 4 weeks before\. Screen time is minutes bought/)).toBeTruthy()
  })
  test('accordion: one open at a time with the five rows', async () => {
    serve(FLAGGED)
    await show()
    const [leo, maya] = within(screen.getByRole('region', { name: 'This week' })).getAllByRole('button', { expanded: false, name: /Leo|Maya/ })
    await userEvent.click(leo)
    expect(leo.getAttribute('aria-expanded')).toBe('true')
    for (const t of ['On time', 'Points earned', 'Points spent', 'Screen time bought', 'Streak']) expect(screen.getByText(t)).toBeTruthy()
    expect(screen.getByText('100 min')).toBeTruthy()
    await userEvent.click(maya)
    expect(leo.getAttribute('aria-expanded')).toBe('false')
    expect(maya.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getAllByText('Streak')).toHaveLength(1)
  })
  test('new kid: line, no comparison, no sparkline', async () => {
    serve(week([kid(1, 'Zed', { enough_history: false, done_trend: [0, 0, 0, 0, 3], done: 3 })]))
    await show()
    expect(screen.getByText('Trends start after 2 weeks.')).toBeTruthy()
    expect(screen.queryByText(/avg/)).toBeNull()
    expect(screen.queryByRole('img', { name: /chores done per week/ })).toBeNull()
  })
  test('family line shows when not all good', async () => {
    serve({ ...FLAGGED, family_line: 'Best week in a month.' })
    await show()
    expect(screen.getByText('Best week in a month.')).toBeTruthy()
  })
})

describe('Happy Hour action', () => {
  test('is the accent button', async () => {
    serve(FLAGGED)
    await show()
    expect(screen.getByRole('button', { name: /Happy Hour for 1/ }).getAttribute('data-variant')).toBe('accent')
  })
})

describe('empty family', () => {
  test('no kids: says so and offers Add a kid', async () => {
    serve(week([]))
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <RecapBody />
      </QueryClientProvider>,
    )
    expect(await screen.findByText('No kids yet')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Add a kid' }).getAttribute('href')).toBe('/kids?section=kids')
  })
})

describe('week navigation', () => {
  test('prev loads the earlier week, next is disabled at latest', async () => {
    serve(FLAGGED)
    await show()
    expect(screen.getByText('Oct 26 – Nov 1')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Next week' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: 'Previous week' }))
    expect(apiMock).toHaveBeenLastCalledWith('/recap?week=2026-10-19')
  })
})

describe('Sparkline', () => {
  test('aria-label states the numbers', () => {
    render(<Sparkline name="Leo" values={[12, 11, 10, 11, 5]} />)
    expect(screen.getByRole('img', { name: 'Leo chores done per week, last 5 weeks: 12, 11, 10, 11, 5' })).toBeTruthy()
  })
})

describe('first-recap intro', () => {
  const tips = (dismissed: string[]) => apiMock.mockImplementation(async (p) => (p === '/me/tips' ? { dismissed } : p.startsWith('/recap') ? FLAGGED : {}))
  test('shows until Got it, which dismisses intro.recap', async () => {
    tips([])
    await show()
    expect(await screen.findByText(/New every Sunday at 7:30 PM/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(apiMock.mock.calls.some(([p, o]) => p === '/me/tips/intro.recap/dismiss' && (o as { method?: string })?.method === 'POST')).toBe(true)
  })
  test('hidden once dismissed', async () => {
    tips(['intro.recap'])
    await show()
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/me/tips', expect.anything()))
    expect(screen.queryByText(/New every Sunday at 7:30 PM/)).toBeNull()
  })
})
