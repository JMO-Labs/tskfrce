import { afterEach, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { EarnedToast } from '@/v2/games/EarnedToast'
import { GamesPage } from '@/v2/games/GamesPage'
import { KidNav } from '@/v2/kid/KidNav'
import { KidApp } from '@/v2/kid/KidApp'
import { fridgeTheme } from '@/v2/theme'
import type { FinishResult, GamesShelf, StartedPlay } from '@/v2/games/types'
import type { KidToday } from '@/v2/types'

jest.mock('@/v2/api', () => ({ ...(jest.requireActual('@/v2/api') as object), api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('@/v2/games/QuickFire', () => ({
  QuickFire: ({ onEnd }: { onEnd: (p: unknown[]) => void }) => (
    <button onClick={() => onEnd([{ game: 'flip', ok: true, ms: 600 }, { game: 'zip', ok: false, ms: 3000 }])}>end quickfire</button>
  ),
}))
jest.mock('@/v2/games/hungryCat/HungryCat', () => ({
  HungryCat: ({ onEnd }: { onEnd: (s: number) => void }) => <button onClick={() => onEnd(23)}>end cat</button>,
}))

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>
const routes: Record<string, unknown> = {}

const started: StartedPlay = { play_id: 7, token: 'tok', game: 'quickfire', kind: 'quick', level: 2, slots: ['quickfire', 'hungry-cat', 'quickfire', 'hungry-cat', 'quickfire', 'hungry-cat'], slot: 1 }
const shelf = (over: Partial<GamesShelf> = {}): GamesShelf => ({
  on: true, saved: 3, fresh: 0, started: null, asleep_until: null,
  games: [
    { key: 'quickfire', name: 'Quick-fire', kind: 'quick', icon: '⚡', stars: 2, rounds: 5, best: 1240 },
    { key: 'hungry-cat', name: 'Hungry Cat', kind: 'think', icon: '🐱', stars: 0, rounds: 0, best: 0 },
  ],
  board: { band: 'kid', rows: [{ kid_id: 3, name: 'Leo', avatar: '🦁', stars: 12, me: true }, { kid_id: 4, name: 'Maya', avatar: null, stars: 9, me: false }] },
  family_rounds: 14, cap: { left: 3, max: 5 },
  ...over,
})
const result: FinishResult = { stars: 2, tickets: 6, points: 3, capped: true, score: 1240, best: 1240, new_best: true, badges: [{ key: 'arcade_ace', name: 'Arcade Ace', icon: '🕹️', tier: 1 }], saved: 2 }

const media = (reduce: boolean) =>
  (window.matchMedia = ((q: string) => ({ matches: reduce && q.includes('reduce'), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as unknown as typeof window.matchMedia)

beforeEach(() => {
  media(true)
  localStorage.clear()
  for (const k of Object.keys(routes)) delete routes[k]
  routes['GET /kid/games'] = shelf()
  apiMock.mockReset().mockImplementation(async (p, i) => routes[`${i?.method ?? 'GET'} ${p}`] ?? undefined)
})
afterEach(() => jest.useRealTimers())

const wrap = (ui: React.ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MantineProvider theme={fridgeTheme}>{ui}</MantineProvider>
  </QueryClientProvider>
)
const page = (p: Partial<React.ComponentProps<typeof GamesPage>> = {}) =>
  render(wrap(<GamesPage mode="kid" celebrate="full" preview={false} name="Leo" kidId={3} {...p} />))
const welcomed = () => localStorage.setItem('tskfrce.games.welcome.3', '1')

describe('Shelf', () => {
  test('shows saved count, tiles and board', async () => {
    welcomed()
    page()
    expect(await screen.findByText('3 games saved')).toBeInTheDocument()
    expect(screen.getByText('Quick-fire')).toBeInTheDocument()
    expect(screen.getByText('⭐⭐')).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    expect(screen.getByText('This week, Kid group')).toBeInTheDocument()
    expect(screen.getByText('🥇 You · 12 ⭐')).toBeInTheDocument()
    expect(screen.getByText('🥈 Maya · 9 ⭐')).toBeInTheDocument()
    expect(screen.getByText('Family: 14 games this week')).toBeInTheDocument()
  })

  test('nothing saved shows the hint and no Play', async () => {
    welcomed()
    routes['GET /kid/games'] = shelf({ saved: 0 })
    page()
    expect(await screen.findByText('Finish a chore to earn a game.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
  })

  test('asleep state with the wake time', async () => {
    welcomed()
    routes['GET /kid/games'] = shelf({ asleep_until: '2026-11-11T07:00:00' })
    page()
    expect(await screen.findByText('Games are asleep')).toBeInTheDocument()
    expect(screen.getByText(/They wake up at 7:00 AM/)).toBeInTheDocument()
    expect(screen.getByText(/Your 3 saved games will be waiting/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Play' })).toBeNull()
  })

  test('preview disables Play with a hint', async () => {
    welcomed()
    page({ preview: true })
    expect(await screen.findByRole('button', { name: 'Play' })).toBeDisabled()
    expect(screen.getByText('Only Leo can play')).toBeInTheDocument()
  })

  test('server message shows as a hint', async () => {
    welcomed()
    const { ApiError } = jest.requireActual('@/v2/api') as typeof import('@/v2/api')
    apiMock.mockImplementation(async (p, i) => {
      if (i?.method === 'POST') throw new ApiError(409, 'Games are asleep until 7:00 AM.')
      return routes[`GET ${p}`]
    })
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Play' }))
    expect(await screen.findByText('Games are asleep until 7:00 AM.')).toBeInTheDocument()
  })

  test('first visit shows the welcome once', async () => {
    page()
    expect(await screen.findByText(/Finish chores, earn games!/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Got it' }))
    expect(await screen.findByText('3 games saved')).toBeInTheDocument()
    expect(localStorage.getItem('tskfrce.games.welcome.3')).toBe('1')
  })
})

describe('flow', () => {
  test('play, spin, quick-fire, finish, results, done', async () => {
    welcomed()
    routes['POST /kid/games/start'] = started
    routes['POST /kid/games/finish'] = result
    page()
    await userEvent.click(await screen.findByRole('button', { name: 'Play' }))
    expect(await screen.findByText('Spin to pick your game!')).toBeInTheDocument()
    jest.useFakeTimers()
    await act(async () => { screen.getByRole('button', { name: 'SPIN!' }).click() })
    await act(async () => { jest.advanceTimersByTime(700) })
    jest.useRealTimers()
    await userEvent.click(await screen.findByRole('button', { name: 'end quickfire' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/kid/games/finish', expect.objectContaining({ method: 'POST', body: { token: 'tok', score: 140, parts: [{ game: 'flip', ok: true, ms: 600 }, { game: 'zip', ok: false, ms: 3000 }] } })))
    expect(await screen.findByText('Great run!')).toBeInTheDocument()
    expect(screen.getByText('🎟️ +6 tickets')).toBeInTheDocument()
    expect(screen.getByText("→ +3 pts (today's cap)")).toBeInTheDocument()
    expect(screen.getByText('New best!')).toBeInTheDocument()
    expect(screen.getByText(/New badge:/)).toHaveTextContent('Arcade Ace')
    await userEvent.click(screen.getByRole('button', { name: 'Done' }))
    expect(await screen.findByText('3 games saved')).toBeInTheDocument()
  })

  test('hungry cat sends score with null parts', async () => {
    welcomed()
    routes['POST /kid/games/start'] = { ...started, game: 'hungry-cat', kind: 'think' }
    routes['POST /kid/games/finish'] = { ...result, capped: false, new_best: false, badges: [] }
    page({ autoStart: true })
    await userEvent.click(await screen.findByRole('button', { name: 'SPIN!' }))
    await userEvent.click(await screen.findByRole('button', { name: 'end cat' }, { timeout: 3000 }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/kid/games/finish', expect.objectContaining({ body: { token: 'tok', score: 23, parts: null } })))
    expect(await screen.findByText('Nice catching!')).toBeInTheDocument()
    expect(screen.getByText('→ +3 pts toward screen time')).toBeInTheDocument()
  })

  test('capped with no points', async () => {
    welcomed()
    routes['POST /kid/games/start'] = started
    routes['POST /kid/games/finish'] = { ...result, points: 0, badges: [], new_best: false }
    page({ autoStart: true })
    await userEvent.click(await screen.findByRole('button', { name: 'SPIN!' }))
    await userEvent.click(await screen.findByRole('button', { name: 'end quickfire' }, { timeout: 3000 }))
    expect(await screen.findByText("Today's game points are full")).toBeInTheDocument()
  })
})

describe('EarnedToast', () => {
  test('buttons call back', async () => {
    const onPlay = jest.fn(), onSave = jest.fn()
    render(<EarnedToast saved={2} onPlay={onPlay} onSave={onSave} celebrate="off" />)
    expect(screen.getByText('You earned a game!')).toBeInTheDocument()
    expect(screen.getByText('2 saved · play now or later')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: '▶ Play now' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save it' }))
    expect(onPlay).toHaveBeenCalledTimes(1)
    expect(onSave).toHaveBeenCalledTimes(1)
  })
})

describe('nav and app', () => {
  const nav = (over: Partial<React.ComponentProps<typeof KidNav>> = {}) =>
    render(<KidNav mode="kid" tab="chores" onTab={() => {}} badges={{ chores: 0, chat: 0, alerts: 0, games: 3 }} avatar={null} gamesOn {...over} />)

  test('Games tab sits after Chores with the saved badge', () => {
    nav()
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent)
    expect(names.slice(0, 3)).toEqual(['Chores', 'Games 3', 'Rewards'])
  })
  test('hidden when games are off', () => {
    nav({ gamesOn: false })
    expect(screen.queryByRole('button', { name: /Games/ })).toBeNull()
  })
  test('Little has it too', () => {
    nav({ mode: 'little' })
    expect(screen.getByRole('button', { name: 'Games 3' })).toBeInTheDocument()
  })

  const today = (games: KidToday['games']): KidToday => ({ locked: true, points_balance: 4, age_group: 'kid', locks_at: null, timezone: 'UTC', chores: [{ id: 7, title: 'Dishes', points: 5, state: 'todo' }], games })
  const app = (d: KidToday) =>
    render(wrap(<KidApp d={d} name="Leo" avatar="🦁" kidId={3} preview={false} onExit={() => {}} onLocker={() => {}} canSwitch={false} done={{ mutate: jest.fn(), isPending: false }} />))

  test('fresh earn shows the toast; Save it marks seen and hides it', async () => {
    app(today({ on: true, saved: 2, fresh: 1 }))
    await userEvent.click(await screen.findByRole('button', { name: 'Save it' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/kid/games/seen', expect.objectContaining({ method: 'POST' })))
    expect(screen.queryByText('You earned a game!')).toBeNull()
  })
  test('Play now marks seen and opens the Games tab', async () => {
    welcomed()
    routes['POST /kid/games/start'] = started
    app(today({ on: true, saved: 2, fresh: 1 }))
    await userEvent.click(await screen.findByRole('button', { name: '▶ Play now' }))
    expect(apiMock).toHaveBeenCalledWith('/kid/games/seen', expect.objectContaining({ method: 'POST' }))
    expect(await screen.findByText('Spin to pick your game!')).toBeInTheDocument()
  })
  test('no toast or tab when off', () => {
    app(today({ on: false, saved: 0, fresh: 0 }))
    expect(screen.queryByText('You earned a game!')).toBeNull()
    expect(screen.queryByRole('button', { name: /Games/ })).toBeNull()
  })
})
