import { beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { TryCards } from '@/v2/today/TryCards'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications')
jest.mock('@/v2/today/HappyHourButton', () => ({ HappyHourButton: ({ label }: { label?: string }) => <button>{label}</button> }))
jest.mock('@/v2/manage/CelebratePreview', () => ({ CelebratePreview: ({ label }: { label?: string }) => <button>{label}</button> }))

const apiMock = api as unknown as Mock<(p: string, o?: { method?: string; body?: unknown }) => Promise<unknown>>
const TODAY = new Date().toLocaleDateString('en-CA')
const fam = { hh_auto_boost: true, streak_freeze: true, hh_default_mult_x10: 20, hh_default_minutes: 60 }
const mia = { id: 1, full_name: 'Mia', username: 'mia', age_group: 'kid', celebrate: null }
let s: { dismissed: string[]; fam: Record<string, unknown>; kids: unknown[]; active: unknown[]; quiet: boolean; trust: number | null; waiting: number }

beforeEach(() => {
  localStorage.clear()
  s = { dismissed: [], fam: { ...fam }, kids: [mia], active: [], quiet: false, trust: null, waiting: 0 }
  apiMock.mockReset()
  apiMock.mockImplementation(async (p, o) => {
    if (p === '/me/tips') return { dismissed: s.dismissed }
    if (p.startsWith('/me/tips/')) return { dismissed: p }
    if (p === '/family') return o?.method === 'PATCH' ? { ...s.fam, ...(o.body as object) } : s.fam
    if (p === '/kids') return s.kids
    if (p === '/happy-hour') return { active: s.active, recent: [] }
    if (p === '/today') return { kids: [{ id: 1, name: 'Mia', quiet: s.quiet }], try_trust_kid: s.trust, waiting_at_reset_days: s.waiting }
    return {}
  })
})

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <TryCards />
    </QueryClientProvider>,
  )
const posted = (p: string) => apiMock.mock.calls.some(([path, o]) => path === p && o?.method === 'POST')
const patched = (p: string, body: unknown) => apiMock.mock.calls.some(([path, o]) => path === p && o?.method === 'PATCH' && JSON.stringify(o.body) === JSON.stringify(body))

test('celebrations card comes first, with Preview, Turn off and Got it', async () => {
  show()
  expect(await screen.findByText(/comic-book cheer/)).toBeInTheDocument()
  for (const n of ['Preview', 'Turn off for all kids', 'Got it']) expect(screen.getByRole('button', { name: n })).toBeInTheDocument()
})

test('the celebrations tip uses the sparkle, not the party popper (audit 25)', async () => {
  show()
  const tip = (await screen.findByText(/comic-book cheer/)).closest('section') as HTMLElement
  expect(tip).toHaveTextContent('auto_awesome')
  expect(tip).not.toHaveTextContent('celebration')
})

test('Got it dismisses through the tips API and the next card waits for tomorrow', async () => {
  show()
  await userEvent.click(await screen.findByRole('button', { name: 'Got it' }))
  await waitFor(() => expect(posted('/me/tips/try.celebrate/dismiss')).toBe(true))
  expect(screen.queryByText(/comic-book cheer/)).toBeNull()
  expect(screen.queryByText(/Double points/)).toBeNull()
})

test('a card shown today stays across reloads until dismissed', async () => {
  const a = show()
  await screen.findByText(/comic-book cheer/)
  a.unmount()
  show()
  expect(await screen.findByText(/comic-book cheer/)).toBeInTheDocument()
})

test('a new day brings the next card in order', async () => {
  localStorage.setItem('tskfrce.try', JSON.stringify({ day: '2000-01-01', key: 'try.celebrate' }))
  s.dismissed = ['try.celebrate']
  show()
  expect(await screen.findByText(/Double points/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start one now' })).toBeInTheDocument()
  expect(JSON.parse(localStorage.getItem('tskfrce.try')!)).toEqual({ day: TODAY, key: 'try.happyhour' })
})

test.each([
  [15, 30, '×1.5 points for 30 minutes gets chores moving.'],
  [30, 60, '×3 points for an hour gets chores moving.'],
  [20, 90, 'Double points for 90 minutes gets chores moving.'],
  [20, 60, 'Double points for an hour gets chores moving.'],
])('Happy Hour card copy uses the family defaults (x10 %i, %i min)', async (mult, minutes, text) => {
  localStorage.setItem('tskfrce.try', JSON.stringify({ day: '2000-01-01', key: 'try.celebrate' }))
  s.dismissed = ['try.celebrate']
  s.fam = { ...fam, hh_default_mult_x10: mult, hh_default_minutes: minutes }
  show()
  expect(await screen.findByText(text)).toBeInTheDocument()
})

test.each([
  ['try.happyhour', /Double points/],
  ['try.autoboost', /goes quiet for 2 days/],
  ['try.streakfreeze', /earn a freeze/],
])('order continues to %s', async (key, text) => {
  const order = ['try.celebrate', 'try.happyhour', 'try.autoboost', 'try.streakfreeze']
  s.dismissed = order.slice(0, order.indexOf(key))
  localStorage.setItem('tskfrce.try', JSON.stringify({ day: '2000-01-01', key: 'x' }))
  show()
  expect(await screen.findByText(text)).toBeInTheDocument()
})

test('Turn off on celebrations sets every kid to off and dismisses', async () => {
  show()
  await userEvent.click(await screen.findByRole('button', { name: 'Turn off for all kids' }))
  await waitFor(() => expect(patched('/kids/1', { celebrate: 'off' })).toBe(true))
  await waitFor(() => expect(posted('/me/tips/try.celebrate/dismiss')).toBe(true))
})

test('Turn off on auto boost and streak freeze PATCHes the family and dismisses', async () => {
  localStorage.setItem('tskfrce.try', JSON.stringify({ day: TODAY, key: 'try.autoboost' }))
  s.dismissed = ['try.celebrate', 'try.happyhour']
  show()
  await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }))
  await waitFor(() => expect(patched('/family', { hh_auto_boost: false })).toBe(true))
  await waitFor(() => expect(posted('/me/tips/try.autoboost/dismiss')).toBe(true))
})

test('streak freeze Turn off PATCHes streak_freeze', async () => {
  localStorage.setItem('tskfrce.try', JSON.stringify({ day: TODAY, key: 'try.streakfreeze' }))
  s.dismissed = ['try.celebrate', 'try.happyhour', 'try.autoboost']
  show()
  await userEvent.click(await screen.findByRole('button', { name: 'Turn off' }))
  await waitFor(() => expect(patched('/family', { streak_freeze: false })).toBe(true))
})

test('Preview leaves the card open', async () => {
  show()
  await userEvent.click(await screen.findByRole('button', { name: 'Preview' }))
  expect(screen.getByText(/comic-book cheer/)).toBeInTheDocument()
  expect(posted('/me/tips/try.celebrate/dismiss')).toBe(false)
})

test('hidden when the feature is already off', async () => {
  s.kids = [{ ...mia, celebrate: 'off' }]
  s.fam = { hh_auto_boost: false, streak_freeze: false }
  s.dismissed = ['try.happyhour']
  show()
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/today'))
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByRole('region', { name: 'Try this' })).toBeNull()
})

test('no Happy Hour card while one is running', async () => {
  s.dismissed = ['try.celebrate']
  s.active = [{ id: 1 }]
  s.fam = { hh_auto_boost: false, streak_freeze: false }
  show()
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/happy-hour'))
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByText(/Double points/)).toBeNull()
})

const allSeen = ['try.celebrate', 'try.happyhour', 'try.autoboost', 'try.streakfreeze']

test('quiet nudge shows only with auto boost off and a quiet kid', async () => {
  s.dismissed = allSeen
  s.fam.hh_auto_boost = false
  s.quiet = true
  show()
  expect(await screen.findByText('Mia has had a quiet couple of days. Start a Happy Hour?')).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Start for Mia' })).toBeInTheDocument()
})

test.each([
  ['auto boost on', { quiet: true, boost: true }],
  ['nobody quiet', { quiet: false, boost: false }],
])('no nudge when %s', async (_n, c) => {
  s.dismissed = allSeen
  s.fam.hh_auto_boost = c.boost
  s.quiet = c.quiet
  show()
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/today'))
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByText(/quiet couple/)).toBeNull()
})

test('Not now hides the nudge for today without a tips dismissal', async () => {
  s.dismissed = allSeen
  s.fam.hh_auto_boost = false
  s.quiet = true
  const a = show()
  await userEvent.click(await screen.findByRole('button', { name: 'Not now' }))
  expect(screen.queryByText(/quiet couple/)).toBeNull()
  expect(apiMock.mock.calls.some(([p]) => p.startsWith('/me/tips/'))).toBe(false)
  a.unmount()
  show()
  await new Promise((r) => setTimeout(r, 50))
  expect(screen.queryByText(/quiet couple/)).toBeNull()
})


test('trust card for a kid with 10 approved chores, once the older cards are seen', async () => {
  s.dismissed = allSeen
  s.trust = 1
  show()
  expect(await screen.findByText("Mia has 10+ approved chores. Trust mode lets Mia's chores approve themselves, with spot checks.")).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Turn on for Mia' }))
  await waitFor(() => expect(patched('/kids/1', { trust_mode: true })).toBe(true))
  await waitFor(() => expect(posted('/me/tips/try.trust/dismiss')).toBe(true))
})

test('acting on a card moves focus to the first kid row, not <body>', async () => {
  s.dismissed = allSeen
  s.trust = 1
  const row = document.body.appendChild(document.createElement('div'))
  row.innerHTML = '<button class="pt-krow"></button>'
  show()
  await userEvent.click(await screen.findByRole('button', { name: 'Got it' }))
  await waitFor(() => expect(document.activeElement).toBe(row.querySelector('.pt-krow')))
  row.remove()
})

test('trust card: Got it only dismisses', async () => {
  s.dismissed = allSeen
  s.trust = 1
  show()
  await userEvent.click(await screen.findByRole('button', { name: 'Got it' }))
  await waitFor(() => expect(posted('/me/tips/try.trust/dismiss')).toBe(true))
  expect(patched('/kids/1', { trust_mode: true })).toBe(false)
})

test('no trust card without a qualifying kid', async () => {
  s.dismissed = allSeen
  show()
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/today'))
  expect(screen.queryByText(/approved chores/)).toBeNull()
})

test('bedtime card after 3 days of waiting chores; Turn on patches bedtime_auto', async () => {
  s.dismissed = [...allSeen, 'try.trust']
  s.waiting = 3
  show()
  expect(await screen.findByText('Chores were still waiting at reset on 3 days. Bedtime auto-approve can clear them at 9:00 PM each night.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
  await waitFor(() => expect(patched('/family', { bedtime_auto: true, bedtime_auto_at: '21:00' })).toBe(true))
  await waitFor(() => expect(posted('/me/tips/try.bedtime/dismiss')).toBe(true))
})

test('no bedtime card at 2 days, or when it is already on', async () => {
  s.dismissed = [...allSeen, 'try.trust']
  s.waiting = 2
  show()
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/today'))
  expect(screen.queryByText(/still waiting at reset/)).toBeNull()
})

test('bedtime card stays off when auto-approve is on', async () => {
  s.dismissed = [...allSeen, 'try.trust']
  s.waiting = 5
  s.fam = { ...fam, bedtime_auto: true }
  show()
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/today'))
  expect(screen.queryByText(/still waiting at reset/)).toBeNull()
})

test('trust comes before bedtime, one card a day', async () => {
  s.dismissed = allSeen
  s.trust = 1
  s.waiting = 3
  show()
  expect(await screen.findByText(/approved chores/)).toBeInTheDocument()
  expect(screen.queryByText(/still waiting at reset/)).toBeNull()
})

test('bedtime card shows the real day count', async () => {
  s.dismissed = [...allSeen, 'try.trust']
  s.waiting = 5
  show()
  expect(await screen.findByText(/waiting at reset on 5 days\./)).toBeInTheDocument()
})

test('bedtime card: time follows the stored time, capped by the reset; a failed Turn on keeps the card', async () => {
  s.dismissed = [...allSeen, 'try.trust']
  s.waiting = 3
  s.fam = { ...fam, reset_time: '20:00', bedtime_auto_at: '21:00' }
  const base = apiMock.getMockImplementation()!
  apiMock.mockImplementation(async (p, o) => {
    if (p === '/family' && o?.method === 'PATCH') throw new Error('422')
    return base(p, o)
  })
  show()
  expect(await screen.findByText(/clear them at 7:45 PM each night/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
  await waitFor(() => expect(patched('/family', { bedtime_auto: true, bedtime_auto_at: '19:45' })).toBe(true))
  expect(posted('/me/tips/try.bedtime/dismiss')).toBe(false)
  expect(screen.getByRole('button', { name: 'Turn on' })).toBeInTheDocument()
})
