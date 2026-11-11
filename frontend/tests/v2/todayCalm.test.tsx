import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
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

const maya: TodayKid = {
  id: 3, name: 'Maya', avatar: null, online_all: true, done: 2, total: 6, needs_you_count: 2, last_active: '2026-10-24T19:44:00Z',
  progress: { level: 3, title: 'Pro', xp: 10, floor: 0, next: 50, streak: 16 }, points: 240, earned: 35, next_reward: 60,
  locks_at: '2026-10-25T21:30:00Z', chores: [{ id: 31, title: 'Dishes', points: 10, state: 'todo', due_time: null }], devices: [],
}
const leo: TodayKid = { ...maya, id: 4, name: 'Leo', done: 1, total: 4, needs_you_count: 0, points: 85, chores: [] }
const need = (id: number): NeedsItem => ({ type: 'chore', id, kid_id: 3, kid_name: 'Maya', title: `Chore ${id}` })
const base = (o: Partial<Today> = {}): Today => ({ day: '2026-10-24', pending_approvals: 0, new_devices: [], kids: [maya, leo], needs_you: [1, 2, 3, 4, 5, 6, 7].map(need), ...o })
const dev = (id: number, seen: boolean) => ({ id, name: `Dev${id}`, mac: 'm', vendor: null, status: 'assigned', owner_ids: [3], group_ids: [], online: seen, override: null, last_seen: null, seen_now: seen, resisting: false, exempt: false })

const NEEDS = /^Review/
const MAYA = /^Maya(?! details)/
const LEO = /^Leo(?! details)/
let state: { fam: Record<string, unknown>; today: Today | Promise<never>; devices: unknown[]; widgets: unknown[]; hh: unknown[]; dismissed: string[] }
const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test"><TodayPage /></MantineProvider>
    </QueryClientProvider>,
  )

beforeEach(() => {
  localStorage.clear()
  fakeRouter.reset('/')
  state = { fam: { penalties_enabled: true, timezone: 'UTC', hh_auto_boost: true, streak_freeze: true, hh_default_mult_x10: 20, hh_default_minutes: 60 }, today: base(), devices: [], widgets: [], hh: [], dismissed: ['onboard.parent'] }
  apiMock.mockReset()
  apiMock.mockImplementation(async (p, init) => {
    if (init?.method) return {}
    if (p === '/today') return state.today
    if (p === '/devices') return state.devices
    if (p.startsWith('/integration-widgets')) return state.widgets
    if (p === '/happy-hour') return { active: state.hh, recent: [] }
    if (p === '/me/tips') return { dismissed: state.dismissed }
    if (p === '/family') return state.fam
    if (p === '/kids') return [{ id: 3, full_name: 'Maya', username: 'maya', age_group: 'teen' }]
    if (p === '/hours') return { rules: [] }
    if (p === '/parents') return []
    return {}
  })
})

describe('calm Today', () => {
  test('calm shows one card per kid with waiting chip, ring and points', async () => {
    wrap()
    const row = await screen.findByRole('button', { name: MAYA })
    expect(within(row).getByText('2 waiting')).toBeInTheDocument()
    expect(within(row).getByRole('img', { name: '2 of 6 done' })).toBeInTheDocument()
    expect(within(row).getByText('240 pts')).toBeInTheDocument()
    expect(row).toHaveAttribute('aria-expanded', 'false')
    expect(document.querySelectorAll('.pt-kcard')).toHaveLength(2)
  })

  test('no waiting chip when nothing waits', async () => {
    wrap()
    const row = await screen.findByRole('button', { name: LEO })
    expect(within(row).queryByText(/waiting/)).toBeNull()
  })

  test('Needs strip shows the total and only when something waits', async () => {
    const { unmount } = wrap()
    const strip = await screen.findByRole('button', { name: /^Review/ })
    expect(strip).toHaveAttribute('aria-expanded', 'false')
    expect(strip).not.toHaveAttribute('aria-controls') // its body is not in the DOM while closed
    unmount()
    state.today = base({ needs_you: [] })
    wrap()
    await screen.findByRole('button', { name: MAYA })
    expect(screen.queryByRole('button', { name: /^Review/ })).toBeNull()
  })

  test('Needs strip opens the waiting list in place', async () => {
    wrap()
    await userEvent.click(await screen.findByRole('button', { name: /^Review/ }))
    expect(screen.getByRole('button', { name: /^Review/ })).toHaveAttribute('aria-expanded', 'true')
    expect(fakeRouter.query.focus).toBe('needs')
    const region = screen.getByRole('region', { name: 'Needs you' })
    expect(within(region).getByText('Chore 1')).toBeInTheDocument()
  })

  test('aria-controls is set only while the body exists, and then points at it', async () => {
    state.devices = [dev(1, true)]
    wrap()
    for (const name of [NEEDS, MAYA, /Devices/]) {
      const h = await screen.findByRole('button', { name }) // rows remount while a kid is open, so look up each time
      expect(h).not.toHaveAttribute('aria-controls')
      await userEvent.click(h)
      const id = h.getAttribute('aria-controls')
      expect(id).toBeTruthy()
      expect(document.getElementById(id!)).not.toBeNull()
      await userEvent.click(h)
      expect(h).not.toHaveAttribute('aria-controls')
    }
  })

  test('there are no Today / Needs you tabs', async () => {
    wrap()
    await screen.findByRole('button', { name: MAYA })
    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.queryByRole('radiogroup', { name: 'Today view' })).toBeNull()
  })

  test('avatar opens the details pop-over, row focuses the kid', async () => {
    wrap()
    await userEvent.click(await screen.findByRole('button', { name: 'Maya details' }))
    expect(await screen.findByText('Streak')).toBeInTheDocument()
    expect(screen.getByText('Last active')).toBeInTheDocument()
    expect(screen.getByText(/Earned today: 35/)).toBeInTheDocument()
    expect(within(screen.getByText('Streak').closest('.p-kid-facts') as HTMLElement).queryByText('Points')).toBeNull() // the card facts show Points; the pop-over does not
    expect(screen.getByRole('link', { name: "Open Maya's page" })).toHaveAttribute('href', '/kids?section=kids&item=3')
    await userEvent.keyboard('{Escape}')
    await userEvent.click(screen.getByRole('button', { name: MAYA }))
    expect(fakeRouter.query.kid).toBe('3')
    expect(document.querySelector('.pt-krow')).toHaveAttribute('aria-expanded', 'true')
  })

  test('?kid= deep link survives the first render before data loads', async () => {
    fakeRouter.reset('/', { kid: '3' })
    state.today = new Promise<never>(() => {})
    wrap()
    await new Promise((r) => setTimeout(r, 50))
    expect(fakeRouter.replace).not.toHaveBeenCalled()
    expect(fakeRouter.query.kid).toBe('3')
  })

  test('one tip at most, checklist first', async () => {
    state.dismissed = []
    wrap()
    expect(await screen.findByText(/Getting started/)).toBeInTheDocument()
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/me/tips', expect.anything()))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(/comic-book cheer/)).toBeNull()
    expect(document.querySelectorAll('[aria-label="Try this"]')).toHaveLength(0)
  })

  test('a Try card shows when the checklist is dismissed', async () => {
    wrap()
    expect(await screen.findByText(/comic-book cheer/)).toBeInTheDocument()
    expect(screen.queryByText(/Getting started/)).toBeNull()
  })

  test('the tip is one dashed line; More opens its actions in place, dismiss closes it', async () => {
    wrap()
    const line = (await screen.findByText(/comic-book cheer/)).closest('.pt-tip') as HTMLElement
    expect(line).not.toBeNull()
    expect(screen.queryByRole('button', { name: 'Got it' })).toBeNull()
    const more = within(line).getByRole('button', { name: 'More' })
    expect(more).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(more)
    expect(more).toHaveAttribute('aria-expanded', 'true')
    expect(within(line).getByRole('button', { name: 'Turn off for all kids' })).toBeInTheDocument()
    await userEvent.click(within(line).getByRole('button', { name: 'Dismiss tip' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/me/tips/try.celebrate/dismiss', expect.anything()))
  })

  test('Getting started is a one-line tip whose More lists the steps', async () => {
    state.dismissed = []
    wrap()
    const line = (await screen.findByText(/Getting started/)).closest('.pt-tip') as HTMLElement
    await userEvent.click(within(line).getByRole('button', { name: 'More' }))
    expect(within(line).getByText('Add a kid')).toBeInTheDocument()
    await userEvent.click(within(line).getByRole('button', { name: 'Dismiss tip' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/me/tips/onboard.parent/dismiss', expect.anything()))
  })

  test('Not now on a nudge falls through to the plain tip', async () => {
    state.dismissed = ['onboard.parent', 'try.celebrate', 'try.happyhour', 'try.autoboost', 'try.streakfreeze', 'try.trust', 'try.bedtime']
    state.fam = { ...state.fam, hh_auto_boost: false }
    state.today = base({ kids: [{ ...maya, quiet: true }, leo] })
    wrap()
    expect(await screen.findByText(/quiet couple of days/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss tip' }))
    expect(await screen.findByText(/Name devices so you know whose they are/)).toBeInTheDocument()
    expect(screen.queryByText(/quiet couple of days/)).toBeNull()
  })

  test('Devices row counts devices online now', async () => {
    state.devices = [...Array(8)].map((_, i) => dev(i + 1, true)).concat([dev(9, false), dev(10, false)])
    wrap()
    const head = await screen.findByRole('button', { name: /Devices/ })
    await waitFor(() => expect(head).toHaveTextContent('8 online'))
    await userEvent.click(head)
    const region = await screen.findByRole('region', { name: 'Devices' })
    expect(within(region).getByText('Dev9')).toBeInTheDocument()
    expect(within(region).getAllByText('Locked')).toHaveLength(2)
    expect(within(region).getByRole('link', { name: /Open Devices/ })).toHaveAttribute('href', '/devices')
    expect(fakeRouter.query.focus).toBe('devices')
  })

  test('Add-ons row hidden without widgets, shown with them', async () => {
    const { unmount } = wrap()
    await screen.findByRole('button', { name: MAYA })
    expect(screen.queryByRole('button', { name: /Add-ons/ })).toBeNull()
    unmount()
    state.widgets = [{ install_id: 7, name: 'Demo', icon: 'extension', widgets: [{ id: 'w', root: { type: 'text', text: 'Hello widget' } }] }]
    wrap()
    const head = await screen.findByRole('button', { name: /Add-ons/ })
    expect(head).toHaveTextContent('1 add-on')
    await userEvent.click(head)
    expect(await screen.findByText('Hello widget')).toBeInTheDocument()
  })

  test('Start Happy Hour lives in the header … menu', async () => {
    wrap()
    await userEvent.click(await screen.findByRole('button', { name: 'More for Today' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Start Happy Hour' }))
    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Start Happy Hour' })).toBeNull()
  })

  test('Happy Hour chip only while running, Stop in its pop-over', async () => {
    const { unmount } = wrap()
    await screen.findByRole('button', { name: MAYA })
    expect(screen.queryByRole('button', { name: /Happy hour/i })).toBeNull()
    unmount()
    state.hh = [{ id: 7, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 44.5 * 60000).toISOString(), multiplier: 2, mult_x10: 20, source: 'parent', kid_ids: null }]
    wrap()
    const chip = await screen.findByRole('button', { name: /Happy Hour ×2 · 45 min/ })
    await userEvent.click(chip)
    expect(await screen.findByText(/everyone/i)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Stop now' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/happy-hour/7/stop', { method: 'POST' }))
    expect(screen.queryByRole('button', { name: 'Start Happy Hour' })).toBeNull()
  })

  test('old ?tab=needs link becomes ?focus=needs', async () => {
    fakeRouter.reset('/', { tab: 'needs' })
    wrap()
    await waitFor(() => expect(fakeRouter.replace).toHaveBeenCalledWith({ pathname: '/', query: { focus: 'needs' } }, undefined, { shallow: true, scroll: false }))
  })
})
