import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import type { ReactNode } from 'react'
import { isInaccessible, render, screen, waitFor } from '@testing-library/react'
import { computeAccessibleName } from 'dom-accessibility-api'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { TodayPage } from '@/v2/today/TodayPage'
import { KidsPage } from '@/v2/manage/KidsPage'
import { SettingsPage } from '@/v2/manage/SettingsPage'
import { DeviceDetail } from '@/v2/manage/DeviceDetail'
import { GroupDetail } from '@/v2/manage/GroupDetail'
import { fakeRouter } from './helpers/fakeRouter'
import type { Device, Group, Kid, NeedsItem, Today } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn(), kidToken: () => null }))
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/contexts/UnifiedAuthContext', () => ({ useUnifiedAuth: () => ({ logout: jest.fn(), user: { id: 1 } }) }))
jest.mock('@/v2/chat/ChatDock', () => ({ ChatDock: () => null }))
jest.mock('@/v2/components/BlockerBanner', () => ({ BlockerBanner: () => null }))
jest.mock('@/v2/components/Bell', () => ({ Bell: () => null }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn(), hide: jest.fn() } }))
jest.mock('@/v2/components/RequireParent', () => ({ RequireParent: ({ children }: { children: ReactNode }) => <>{children}</> }))
jest.mock('@/v2/parent/ParentShell', () => ({
  ParentShell: ({ list, children, title }: { list?: ReactNode; children: ReactNode; title: string }) => (
    <><header className="p-header"><h1>{title}</h1></header>{list}<main>{children}</main></>
  ),
}))

const apiMock = api as unknown as Mock<(p: string, init?: { method?: string; body?: unknown }) => Promise<unknown>>

const kids: Kid[] = [{ id: 7, full_name: 'Maya', username: 'kid-maya', avatar: null, has_pin: false }, { id: 8, full_name: 'Leo', username: 'kid-leo', avatar: '🦊', has_pin: true }]
const tk = (id: number, name: string) => ({
  id, name, avatar: null, online_all: true, done: 1, total: 2, needs_you_count: id === 3 ? 1 : 0, last_active: null,
  progress: { level: 1, title: 'New', xp: 0, floor: 0, next: 50, streak: 0 }, points: 12, earned: 0, next_reward: null, locks_at: null, devices: [], chores: [],
})
const needs: NeedsItem[] = [{ type: 'chore', id: 1, kid_id: 3, kid_name: 'Maya', title: 'Make bed', submitted_at: '2026-10-24T19:00:00Z' }]
const today = { day: '2026-10-24', pending_approvals: 0, new_devices: [], kids: [tk(3, 'Maya'), tk(4, 'Leo')], needs_you: needs } as unknown as Today
const asg = { id: 11, chore_id: 5, kid_ids: [7], mode: 'each', repeat: { type: 'daily', days: [] }, on_date: null, due_time: '19:00', active: true }
const chore = { id: 5, title: 'Clean room', points: 15, needs_photo: false, steps: [{ id: 1, title: 'Fold', due_time: null, after_previous: false }], assignments: [asg] }
const dev = (id: number, name: string): Device => ({
  id, name, mac: `aa:bb:cc:dd:ee:0${id}`, vendor: null, status: 'assigned', owner_ids: [7], group_ids: [3], online: true, override: null, last_seen: null,
  seen_now: true, resisting: false, exempt: false, reason: 'schedule', chores_done: 0, chores_total: 0, locks_at: '2026-10-26T20:00:00Z', alerts: 0,
})
const devices = [dev(1, 'Maya iPad'), dev(2, 'Fire tablet')]
const group: Group = { id: 3, name: 'Tablets', device_ids: [1, 2], owner_ids: [], icon: 'tablet_mac', chore_lock: true, screen_price: null }
const screenKid = (id: number, name: string) => ({ kid_id: id, name, balance: 240, bought_today: 30, max_minutes: 120, limit: null, saved: 45 })
const screen_ = {
  enabled: true, price: 20, max_minutes_per_day: 120, auto_approve: false, only_in_allowed_hours: true, group_pricing: true, rollover: true, bank_cap: 240,
  reset_time: '06:00', avg_chore_points: 20, kids: [screenKid(3, 'Maya'), screenKid(4, 'Leo')],
}
const settings = { quiet_start: null, quiet_end: null, quiet_security: true, app_address: null, app_address_default: null, events: [{ key: 'chore_ok', label: 'Chore needs OK', security: false }] }
const GET: Record<string, unknown> = {
  '/today': today, '/kids': kids, '/chores/': [chore], '/devices': devices, '/groups': [group], '/hours': { rules: [] }, '/parents': [], '/screen-time': screen_,
  '/family': { timezone: 'UTC', name: 'Fam' }, '/notify/places': [{ id: 1, name: 'Signal', url_mask: 'signal://x', enabled: true, events: ['chore_ok'], readable: true }], '/notify/settings': settings,
  '/custom-badges': [{ id: 3, name: 'Kindness', icon: 'volunteer_activism', description: 'Helped someone' }], '/badges/overview': [], '/badges/recent': [],
  '/happy-hour': { active: [], recent: [] }, '/me/tips': { dismissed: ['onboard.parent'] }, '/chat/threads': { total: 0, threads: [] }, '/rewards': [], '/chore-types': [],
}

const wrap = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MantineProvider env="test">{ui}</MantineProvider>
  </QueryClientProvider>
)

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  global.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
  Element.prototype.scrollIntoView = jest.fn()
})
beforeEach(() => {
  localStorage.clear()
  apiMock.mockReset().mockImplementation(async (p, init) => {
    if (init?.method) return {}
    const key = Object.keys(GET).find((k) => p === k || p.startsWith(`${k}?`))
    return key ? GET[key] : p.startsWith('/integration-widgets') ? [] : {}
  })
  global.fetch = jest.fn(() => Promise.resolve({ ok: false })) as unknown as typeof fetch
})

const nameOf = (el: Element) => computeAccessibleName(el).trim()
const idsOf = (el: Element) => (el.getAttribute('aria-controls') ?? '').split(/\s+/).filter(Boolean)

/** ParentShell and Bell are mocked here, so the header back link and bell are not audited. */
function audit() {
  const expanders = [...document.querySelectorAll('[aria-expanded]')]
  expect(expanders.length).toBeGreaterThan(0)
  for (const el of expanders) {
    const label = `${el.tagName.toLowerCase()}.${el.className} "${nameOf(el)}"`
    expect({ label, tag: el.tagName }).toEqual({ label, tag: 'BUTTON' })
    if (el.getAttribute('aria-expanded') === 'true') {
      if (el.hasAttribute('data-focus-head')) expect({ label, ids: idsOf(el).length > 0 }).toEqual({ label, ids: true })
      for (const id of idsOf(el)) expect({ label, id, found: !!document.getElementById(id) }).toEqual({ label, id, found: true })
    }
  }
  const unnamed = [...document.querySelectorAll('button, [role="button"]')].filter((b) => !isInaccessible(b) && !nameOf(b)).map((b) => b.outerHTML.slice(0, 200))
  expect(unnamed).toEqual([])
}

const cases: [string, Record<string, string>, () => ReactNode, string | RegExp][] = [
  ['Today', { focus: 'needs' }, () => <TodayPage />, /Needs you/],
  ['Today (kid focus)', { kid: '3' }, () => <TodayPage />, /Maya/],
  ['Kid', { section: 'kids', item: '8', open: 'settings' }, () => <KidsPage />, 'Settings'],
  ['Kid (editing)', { section: 'kids', item: '8', open: 'settings', edit: '1' }, () => <KidsPage />, 'Settings'],
  ['Chore', { section: 'chores', item: '5', open: 'basics' }, () => <KidsPage />, 'Clean room'],
  ['Screen time', { section: 'rewards', item: 'screen', open: 'price' }, () => <KidsPage />, /Price/],
  ['Badges', { section: 'badges', item: 'custom', pick: '3' }, () => <KidsPage />, 'Kindness'],
  ['Notifications', { section: 'notifications', open: 'quiet' }, () => <SettingsPage />, /Quiet/],
  ['Device', { item: '1', open: 'details' }, () => <DeviceDetail device={devices[0]} kids={kids} groups={[group]} onRequestOverride={() => {}} />, /Maya iPad/],
  ['Group', { tab: 'groups', item: '3', open: 'gset' }, () => <GroupDetail group={group} devices={devices} kids={kids} rules={[]} onSelect={() => {}} onRequestOverride={() => {}} />, 'Tablets'],
]

describe('focus screens: expanders and icon buttons', () => {
  test.each(cases)('%s', async (_n, query, ui, ready) => {
    fakeRouter.reset(query.tab ? '/devices' : query.section === 'notifications' ? '/settings' : query.section ? '/kids' : '/', query)
    render(wrap(ui()))
    await waitFor(() => expect(screen.getAllByText(ready).length).toBeGreaterThan(0))
    await waitFor(() => expect(document.querySelector('[aria-expanded="true"]')).not.toBeNull()) // the URL's section is open
    if (_n === 'Today') expect(document.querySelector('[data-focus-head="needs"][aria-controls="needs-body"]')).not.toBeNull()
    audit()
  })
})
