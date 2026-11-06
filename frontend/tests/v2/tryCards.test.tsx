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
let s: { dismissed: string[]; fam: Record<string, unknown>; kids: unknown[]; active: unknown[]; quiet: boolean }

beforeEach(() => {
  localStorage.clear()
  s = { dismissed: [], fam: { ...fam }, kids: [mia], active: [], quiet: false }
  apiMock.mockReset()
  apiMock.mockImplementation(async (p, o) => {
    if (p === '/me/tips') return { dismissed: s.dismissed }
    if (p.startsWith('/me/tips/')) return { dismissed: p }
    if (p === '/family') return o?.method === 'PATCH' ? { ...s.fam, ...(o.body as object) } : s.fam
    if (p === '/kids') return s.kids
    if (p === '/happy-hour') return { active: s.active, recent: [] }
    if (p === '/today') return { kids: [{ id: 1, name: 'Mia', quiet: s.quiet }] }
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
