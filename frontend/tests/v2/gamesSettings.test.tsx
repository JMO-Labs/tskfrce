import { beforeAll, beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { FamilyCard } from '@/v2/manage/FamilyCards'
import { gamesLine } from '@/v2/manage/GamesRow'
import { ChoreDetail, clearChoreDrafts } from '@/v2/manage/ChoreDetail'
import { TryCards } from '@/v2/today/TryCards'
import { RecapKids } from '@/v2/recap/RecapKids'
import { StepFinish } from '@/v2/setup/StepFinish'
import type { Family, Kid, LibChore } from '@/v2/types'
import type { RecapKid } from '@/v2/recap/recapTypes'
import { fakeRouter } from './helpers/fakeRouter'

const push = jest.fn()
jest.mock('next/router', () => ({ useRouter: () => ({ ...require('./helpers/fakeRouter').useFakeRouter(), push: (...a: unknown[]) => push(...a) }) }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('@/v2/components/InstallHint', () => ({ InstallHint: () => null }))

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>
const baseFam = { name: 'R', timezone: 'UTC', reset_time: '06:00', early_bonus_cap: 5, streak_freeze: true, recap_weekly: true, games_on: true, games_earn: 'every', games_cap_pct: 10, games_board: true, games_rounds: 0 }
const fam = (o: Partial<Family> = {}) => ({ ...baseFam, ...o }) as Family
const kids = [
  { id: 7, full_name: 'Maya', username: 'maya', games_on: true },
  { id: 8, full_name: 'Leo', username: 'leo', games_on: false },
] as unknown as Kid[]
const qc = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrap = (ui: React.ReactNode, client = qc()) => (
  <QueryClientProvider client={client}><MantineProvider env="test">{ui}</MantineProvider></QueryClientProvider>
)
const show = (f: Family, open = 'games') => {
  fakeRouter.reset('/settings', { section: 'family', open })
  return render(wrap(<FamilyCard fam={f} />))
}
const patches = (path = '/family') => apiMock.mock.calls.filter((c) => c[0] === path && c[1]?.method === 'PATCH').map((c) => c[1]?.body)

beforeAll(() => {
  window.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as never
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})
beforeEach(() => {
  localStorage.clear()
  push.mockReset()
  apiMock.mockReset().mockImplementation(async (p, i) => {
    if (i?.method) return i.body
    if (p === '/kids') return kids
    return undefined
  })
})

test('gamesLine summarises on and off', () => {
  expect(gamesLine(fam({ games_on: false }))).toBe('Off')
  expect(gamesLine(fam())).toBe('Every chore · Cap 10% · Board on')
  expect(gamesLine(fam({ games_earn: 'custom', games_cap_pct: 0, games_board: false }))).toBe('Custom · Cap 0% · Board off')
})

test('closed row shows the summary and no form', () => {
  show(fam(), '')
  expect(screen.getByText('Every chore · Cap 10% · Board on')).toBeInTheDocument()
  expect(screen.queryByRole('switch', { name: 'Minigames' })).toBeNull()
})

test('minigames switch PATCHes games_on; controls hide when off', async () => {
  show(fam({ games_on: false }))
  expect(screen.queryByRole('switch', { name: 'Family leaderboard' })).toBeNull()
  await userEvent.click(screen.getByRole('switch', { name: 'Minigames' }))
  await waitFor(() => expect(patches()).toEqual([{ games_on: true }]))
})

test('frequency, cap and leaderboard PATCH their fields', async () => {
  show(fam())
  await userEvent.click(screen.getByLabelText('Once a day'))
  await userEvent.selectOptions(screen.getByLabelText('Game points cap'), '25')
  await userEvent.click(screen.getByRole('switch', { name: 'Family leaderboard' }))
  await waitFor(() => expect(patches()).toEqual([{ games_earn: 'daily' }, { games_cap_pct: 25 }, { games_board: false }]))
})

test('custom shows the chore-editor hint', () => {
  show(fam({ games_earn: 'custom' }))
  expect(screen.getByText(/Earns a game/)).toBeInTheDocument()
})

test('per-kid switch PATCHes the kid', async () => {
  show(fam())
  await userEvent.click(await screen.findByRole('switch', { name: 'Leo plays games' }))
  await waitFor(() => expect(patches('/kids/8')).toEqual([{ games_on: true }]))
  expect(screen.getByRole('switch', { name: 'Maya plays games' })).toBeChecked()
})

const lib = { id: 1, title: 'Dishes', points: 5, needs_photo: false, type_id: 1, steps: [], assignments: [] } as unknown as LibChore
const editor = (f: Family) => {
  clearChoreDrafts()
  apiMock.mockImplementation(async (p, i) => (i?.method ? i.body : p === '/family' ? f : p === '/chore-types' ? [] : undefined))
  fakeRouter.reset('/chores', { open: 'opts' })
  return render(wrap(<ChoreDetail kids={kids} chore={lib} onSelect={() => {}} />))
}

test('chore editor offers Earns a game only for custom', async () => {
  editor(fam({ games_earn: 'custom' }))
  expect(await screen.findByRole('switch', { name: 'Earns a game' })).toBeInTheDocument()
})

test('chore editor hides Earns a game when not custom', async () => {
  editor(fam())
  await screen.findByRole('switch', { name: 'Always check' })
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/family'))
  expect(screen.queryByRole('switch', { name: 'Earns a game' })).toBeNull()
})

const tryApi = (f: Partial<Family>) =>
  apiMock.mockImplementation(async (p, o) => {
    if (p === '/me/tips') return { dismissed: [] }
    if (p === '/family') return o?.method ? o.body : { ...baseFam, hh_auto_boost: true, streak_freeze: true, ...f }
    if (p === '/kids') return [{ id: 1, full_name: 'Mia', username: 'mia', age_group: 'kid', celebrate: 'off' }]
    if (p === '/happy-hour') return { active: [{}], recent: [] }
    if (p === '/today') return { kids: [], try_trust_kid: null, waiting_at_reset_days: 0 }
    return {}
  })

test('try.games card shows when games are on and unplayed, and links to settings', async () => {
  tryApi({})
  render(wrap(<TryCards />))
  expect(await screen.findByText('Each approved chore earns a short game that pays a few points.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'See settings' }))
  expect(push).toHaveBeenCalledWith('/settings?section=family&open=games')
})

test('try.games card hides once games were played or are off', async () => {
  tryApi({ games_rounds: 3 })
  render(wrap(<TryCards />))
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/today'))
  expect(screen.queryByText(/Each approved chore earns/)).toBeNull()
})

test('setup finish names minigames', () => {
  render(wrap(<StepFinish chores={0} kids={0} lock={false} />))
  expect(screen.getByText('Minigames are on. Kids earn a quick game for each chore.')).toBeInTheDocument()
})

const rk = (o: Partial<RecapKid>) => ({ id: 1, name: 'Mia', flags: [], done: 3, done_trend: [1, 2, 3], on_time_pct: null, on_time_avg: null, points_earned: 0, points_spent: 0, screen_minutes_bought: 0, streak: 0, enough_history: false, ...o }) as RecapKid

test('recap kid line shows games and badges only when played', () => {
  const { rerender } = render(<RecapKids kids={[rk({ games: 3, game_badges: 1 })]} line={null} />)
  expect(screen.getByText('Played 3 games · 1 badge')).toBeInTheDocument()
  rerender(<RecapKids kids={[rk({ games: 1, game_badges: 2 })]} line={null} />)
  expect(screen.getByText('Played 1 game · 2 badges')).toBeInTheDocument()
  rerender(<RecapKids kids={[rk({ games: 0 })]} line={null} />)
  expect(screen.queryByText(/Played/)).toBeNull()
})
