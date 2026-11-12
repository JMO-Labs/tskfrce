import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { TodayPage } from '@/v2/today/TodayPage'
import { KID_COLORS } from '@/v2/KidAv'
import { fakeRouter } from './helpers/fakeRouter'
jest.mock('@/v2/api', () => ({ api: jest.fn(), kidToken: () => null }))
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/contexts/UnifiedAuthContext', () => ({ useUnifiedAuth: () => ({ logout: jest.fn(), user: { id: 1 } }) }))
jest.mock('@/v2/chat/ChatDock', () => ({ ChatDock: () => null }))
jest.mock('@/v2/components/BlockerBanner', () => ({ BlockerBanner: () => null }))
jest.mock('@/v2/components/Bell', () => ({ Bell: () => null }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
import { ageText, frac, hm, pct, waitingStats } from '@/v2/today/dayTime'
import type { NeedsItem, Today, TodayKid } from '@/v2/types'

const apiMock = api as unknown as Mock<(p: string, init?: { method?: string; body?: unknown }) => Promise<unknown>>

// The card button's name starts with the kid's name; the avatar bubble (KidAv) is 'Maya details'.
const CARD = /^Maya(?! details$)/
const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString()
const need = (id: number, type: NeedsItem['type'], min?: number): NeedsItem => ({ type, id, kid_id: 3, kid_name: 'Maya', title: `Item ${id}`, submitted_at: min == null ? null : ago(min) })
const done = new Date()
done.setUTCHours(15, 30, 0, 0)
const maya: TodayKid = {
  id: 3, name: 'Maya', avatar: null, online_all: true, done: 3, total: 4, needs_you_count: 0, points: 40, chores: [], devices: [{ id: 1, name: 'Pad', vendor: null, online: false }],
  online_minutes: 55, allowed_minutes: 90, allowed: [[420, 480], [900, 1140]], lock_reason: 'chores', completions: [{ title: 'Feed fish', at: done.toISOString() }],
}
let today: Today
const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test"><TodayPage /></MantineProvider>
    </QueryClientProvider>,
  )

beforeEach(() => {
  localStorage.clear()
  fakeRouter.reset('/')
  today = { day: '2026-10-24', pending_approvals: 0, new_devices: [], kids: [maya], needs_you: [] }
  apiMock.mockReset()
  apiMock.mockImplementation(async (p) => {
    if (p === '/today') return today
    if (p === '/family') return { timezone: 'UTC', penalties_enabled: false }
    if (p === '/me/tips') return { dismissed: ['onboard.parent'] }
    if (p === '/happy-hour') return { active: [], recent: [] }
    if (p === '/hours') return { rules: [] }
    if (p === '/devices' || p === '/kids' || p.startsWith('/integration-widgets') || p === '/parents') return []
    return {}
  })
})

describe('dayTime helpers', () => {
  test('timeline maps 7am-9pm to 0-100 and clamps', () => {
    expect([pct(420), pct(840), pct(1260), pct(0), pct(1400)]).toEqual([0, 50, 100, 0, 100])
  })
  test('hm, ageText and frac', () => {
    expect([hm(930), hm(0), hm(720)]).toEqual(['3:30 PM', '12:00 AM', '12:00 PM'])
    expect([ageText(42), ageText(60), ageText(135)]).toEqual(['42m', '1h', '2h 15m'])
    expect([frac(1, 4), frac(5, 0), frac(9, 3)]).toEqual([0.25, 0, 1])
  })
  test('waitingStats splits chores and rewards and finds the oldest', () => {
    const w = waitingStats([need(1, 'chore', 10), need(2, 'redo', 42), need(3, 'reward', 5), need(4, 'screen_time')], Date.now())
    expect(w).toMatchObject({ total: 4, chores: 2, rewards: 2, oldestMin: 42 })
    expect(waitingStats([need(1, 'chore')], Date.now()).oldestMin).toBeNull()
  })
})

describe('waiting banner', () => {
  test('shows count, split and oldest age; amber past 30 minutes; Review opens the list', async () => {
    today.needs_you = [need(1, 'chore', 42), need(2, 'chore', 5), need(3, 'reward', 8)]
    wrap()
    expect(await screen.findByText('3 waiting on you')).toBeInTheDocument()
    expect(screen.getByText('2 chores · 1 reward', { exact: false })).toBeInTheDocument()
    const age = screen.getByText('oldest 42m')
    expect(age).toHaveAttribute('data-stale')
    await userEvent.click(screen.getByRole('button', { name: 'Review' }))
    expect(screen.getByRole('region', { name: 'Needs you' })).toBeInTheDocument()
  })
  test('not amber when the oldest is recent', async () => {
    today.needs_you = [need(1, 'chore', 10)]
    wrap()
    expect(await screen.findByText('oldest 10m')).not.toHaveAttribute('data-stale')
  })
  test('hidden at 0', async () => {
    wrap()
    await screen.findByRole('button', { name: CARD })
    expect(screen.queryByText(/waiting on you/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Review' })).toBeNull()
  })
})

describe('kid card', () => {
  test('facts say Screen, hours render as h/m; ring has both arcs; lock pill shows why', async () => {
    wrap()
    const card = await screen.findByRole('button', { name: CARD })
    expect(within(card).getByText('3/4')).toBeInTheDocument()
    expect(within(card).getByText('55m of 1h 30m allowed')).toBeInTheDocument()
    expect(within(card).getByText('40 pts')).toBeInTheDocument()
    expect(within(card).getByRole('img', { name: '3 of 4 chores done, 55 of 90 minutes online' })).toBeInTheDocument()
    expect(within(card).getByText('Chores', { selector: '.pt-lockpill' })).toBeInTheDocument()
    expect(within(card).getByText('Screen')).toBeInTheDocument()
    expect(card.textContent).not.toMatch(/screen time|Online/i)
    expect(card.querySelectorAll('circle')).toHaveLength(4)
  })
  test('open kid shows an Open pill and no lock', async () => {
    today.kids = [{ ...maya, lock_reason: null, devices: [{ id: 1, name: 'Pad', vendor: null, online: true }] }]
    wrap()
    const card = await screen.findByRole('button', { name: CARD })
    expect(within(card).getByText('Open')).toHaveClass('pt-lockpill')
    expect(card.querySelector('[data-locked]')).toBeNull()
  })
  test('timeline has allowed windows and a chore dot, each with a tooltip', async () => {
    wrap()
    const card = await screen.findByRole('button', { name: CARD })
    const tips = [...card.querySelectorAll('[data-tip]')].map((e) => e.getAttribute('data-tip'))
    expect(tips).toContain('Online allowed 7:00 AM–8:00 AM')
    expect(tips).toContain('Online allowed 3:00 PM–7:00 PM')
    expect(tips).toContain('Feed fish · 3:30 PM')
    expect(card.querySelectorAll('.pt-tl-win')).toHaveLength(2)
    expect(card.querySelectorAll('.pt-tl-dot')).toHaveLength(1)
    expect(card.querySelector('.pt-tl-base')).toHaveAttribute('data-tip', 'Maya: locked')
  })
  test('without day data the card still renders the old facts, no timeline', async () => {
    today.kids = [{ ...maya, allowed: undefined, allowed_minutes: undefined, online_minutes: undefined }]
    wrap()
    const card = await screen.findByRole('button', { name: CARD })
    expect(within(card).getByRole('img', { name: '3 of 4 done' })).toBeInTheDocument()
    expect(card.querySelector('.pt-tl')).toBeNull()
  })
  test('tapping the card opens the kid focus', async () => {
    wrap()
    await userEvent.click(await screen.findByRole('button', { name: CARD }))
    expect(fakeRouter.query.kid).toBe('3')
    expect(await screen.findByRole('region', { name: /Maya.*s day/ })).toBeInTheDocument()
  })

  test('kid colour shows only on the KidAv name bubble; chart marks stay accent + neutrals', async () => {
    const base = apiMock.getMockImplementation()!
    apiMock.mockImplementation(async (p, i) => (p === '/kids' ? [{ id: 3, full_name: 'Maya' }] : base(p, i)))
    const { container } = wrap()
    const bubble = await screen.findByText('Ma')
    expect(bubble).toHaveClass('pt-kav')
    expect(bubble.style.background).toBe('rgb(57, 135, 229)') // KID_COLORS[0]
    const card = container.querySelector('.pt-kcard') as HTMLElement
    const hex = KID_COLORS[0].toLowerCase()
    const tinted = Array.from(card.querySelectorAll('*')).filter((el) => {
      const attrs = ['style', 'fill', 'stroke'].map((a) => (el.getAttribute(a) ?? '').toLowerCase())
      return attrs.some((v) => v.includes(hex) || v.includes('57, 135, 229'))
    })
    expect(tinted).toEqual([bubble])
  })
})
