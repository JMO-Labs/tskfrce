import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { HappyHourButton } from '@/v2/today/HappyHourButton'
import { HappyHourPane } from '@/v2/manage/HappyHourPane'
import { KidCelebrations } from '@/v2/manage/KidCelebrations'
import { FamilyCard } from '@/v2/manage/FamilyCards'
import { KidAlerts } from '@/v2/kid/KidAlerts'
import { severity } from '@/v2/components/bellRules'
import { InboxRow } from '@/v2/components/InboxRow'
import type { Family, Kid } from '@/v2/types'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('@/v2/chat/dock', () => ({ openChat: jest.fn(), openChatList: jest.fn() }))

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>
const fam = (o: Partial<Family> = {}) =>
  ({ name: 'R', timezone: 'UTC', reset_time: '06:00', new_devices_blocked: false, early_bonus_cap: 5, gifs_enabled: false, gif_rating: 'g', giphy_key_set: false,
    hh_default_mult_x10: 20, hh_default_minutes: 60, hh_weekly_surprise: false, hh_auto_boost: true, streak_freeze: true, ...o }) as Family
const kids = [{ id: 3, full_name: 'Ana', username: 'ana', avatar: null, has_pin: false, age_group: 'kid' }, { id: 4, full_name: 'Bo', username: 'bo', avatar: null, has_pin: false, age_group: 'teen' }]
const hh = (o = {}) => ({ id: 7, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 25 * 60000).toISOString(), multiplier: 2, mult_x10: 20, source: 'parent', kid_ids: null, ...o })
let active: object[] = []
let family = fam()
const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test">{ui}</MantineProvider>
    </QueryClientProvider>,
  )
const sent = (p: string, method = 'POST') => apiMock.mock.calls.filter((c) => c[0] === p && c[1]?.method === method).map((c) => c[1]?.body)

beforeEach(() => {
  active = []
  family = fam()
  apiMock.mockReset()
  apiMock.mockImplementation(async (p, i) => {
    if (i?.method) return i.method === 'PATCH' && p === '/family' ? { ...family, ...(i.body as object) } : {}
    if (p === '/happy-hour') return { active, recent: [] }
    if (p === '/family') return family
    if (p === '/kids') return kids
    if (p === '/notifications') return { items: [], unread: 0, has_more: false }
    return undefined
  })
})

describe('Happy Hour button', () => {
  test('one-tap Start uses the family defaults', async () => {
    family = fam({ hh_default_mult_x10: 30, hh_default_minutes: 90 })
    wrap(<HappyHourButton />)
    await userEvent.click(await screen.findByRole('button', { name: 'Start Happy Hour' }))
    await waitFor(() => expect(screen.getByRole('button', { name: '×3' }).getAttribute('aria-pressed')).toBe('true'))
    expect(screen.getByRole('button', { name: '90 min' }).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(sent('/happy-hour')).toEqual([{ minutes: 90, mult_x10: 30 }]))
  })

  test('picked length, multiplier and kids are sent', async () => {
    wrap(<HappyHourButton />)
    await userEvent.click(await screen.findByRole('button', { name: 'Start Happy Hour' }))
    await userEvent.click(await screen.findByRole('button', { name: '30 min' }))
    await userEvent.click(screen.getByRole('button', { name: '×1.5' }))
    await userEvent.click(screen.getByRole('button', { name: 'Bo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(sent('/happy-hour')).toEqual([{ minutes: 30, mult_x10: 15, kid_ids: [4] }]))
  })

  test('on a kid page that kid is preselected', async () => {
    wrap(<HappyHourButton kidId={3} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Start Happy Hour' }))
    expect((await screen.findByRole('button', { name: 'Ana' })).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(sent('/happy-hour')).toEqual([{ minutes: 60, mult_x10: 20, kid_ids: [3] }]))
  })

  test('while running it shows the time left and Stop', async () => {
    active = [hh()]
    wrap(<HappyHourButton />)
    expect((await screen.findByRole('status')).textContent).toBe('25 min left')
    expect(screen.getByText(/everyone/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Start Happy Hour' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /Stop/ }))
    await waitFor(() => expect(sent('/happy-hour/7/stop')).toHaveLength(1))
  })

  test("a Happy Hour for another kid does not take over this kid's button", async () => {
    active = [hh({ kid_ids: [4] })]
    wrap(<HappyHourButton kidId={3} />)
    expect(await screen.findByRole('button', { name: 'Start Happy Hour' })).toBeTruthy()
  })
})

describe('scoped running state', () => {
  test('several Happy Hours: a kid page shows and stops only the ones covering that kid', async () => {
    active = [hh({ id: 1, kid_ids: [4] }), hh({ id: 2, kid_ids: [3] }), hh({ id: 3, kid_ids: [3, 4], mult_x10: 30 })]
    wrap(<HappyHourButton kidId={3} />)
    expect(await screen.findAllByRole('status')).toHaveLength(2)
    expect(screen.getByText(/· Ana$/)).toBeTruthy()
    expect(screen.queryByText(/· Bo$/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Stop Happy Hour for Ana' }))
    await waitFor(() => expect(sent('/happy-hour/2/stop')).toHaveLength(1))
    expect(sent('/happy-hour/1/stop')).toHaveLength(0)
  })

  test('stopping an all-kids Happy Hour from a kid page asks first', async () => {
    active = [hh()]
    const ask = jest.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    wrap(<HappyHourButton kidId={3} />)
    const stop = await screen.findByRole('button', { name: /Stop/ })
    await userEvent.click(stop)
    expect(ask).toHaveBeenCalledWith('This Happy Hour is for everyone. Stop it for all kids?')
    expect(sent('/happy-hour/7/stop')).toHaveLength(0)
    await userEvent.click(stop)
    await waitFor(() => expect(sent('/happy-hour/7/stop')).toHaveLength(1))
    ask.mockRestore()
  })

  test('Today: sheet defaults to All kids even with a kid in scope; Escape closes it', async () => {
    wrap(<HappyHourButton kidId={3} allKids />)
    await userEvent.click(await screen.findByRole('button', { name: 'Start Happy Hour' }))
    expect((await screen.findByRole('button', { name: 'All kids' })).getAttribute('aria-pressed')).toBe('true')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Start' })).toBeNull())
  })
})

describe('placement', () => {
  const src = (f: string) => require('fs').readFileSync(require('path').join(__dirname, '../../src/v2', f), 'utf8') as string
  test('Start Happy Hour is in the Today header menu, not on the kid page', () => {
    expect(src('today/TodayPage.tsx')).toContain("label: 'Start Happy Hour'")
    expect(src('today/TodayPage.tsx')).not.toContain('<HappyHourButton')
    expect(src('manage/KidDetail.tsx')).not.toContain('HappyHour')
  })
})

describe('settings', () => {
  test('Happy Hour pane saves each change on its own', async () => {
    wrap(<HappyHourPane />)
    await userEvent.click(await screen.findByRole('button', { name: '×3' }))
    await waitFor(() => expect(sent('/family', 'PATCH')).toContainEqual({ hh_default_mult_x10: 30 }))
    await userEvent.click(screen.getByRole('button', { name: '30 min' }))
    await waitFor(() => expect(sent('/family', 'PATCH')).toContainEqual({ hh_default_minutes: 30 }))
    expect(screen.getByText("We'll pick a random weekday afternoon.")).toBeTruthy()
    await userEvent.click(screen.getByRole('switch', { name: 'Surprise Happy Hour once a week' }))
    await waitFor(() => expect(sent('/family', 'PATCH')).toContainEqual({ hh_weekly_surprise: true }))
    await userEvent.click(screen.getByRole('switch', { name: 'Auto boost when things go quiet' }))
    await waitFor(() => expect(sent('/family', 'PATCH')).toContainEqual({ hh_auto_boost: false }))
    expect(screen.getByText(/After 2 quiet days/)).toBeTruthy()
  })

  test('Streak freezes switch in Points rules saves at once', async () => {
    fakeRouter.reset('/settings', { section: 'family', open: 'pts' })
    wrap(<FamilyCard fam={fam()} />)
    await userEvent.click(screen.getByRole('switch', { name: 'Streak freezes' }))
    await waitFor(() => expect(sent('/family', 'PATCH')).toEqual([{ streak_freeze: false }]))
    await userEvent.click(screen.getByRole('button', { name: 'About streak freezes' }))
    expect(await screen.findByText(/covers one missed day/)).toBeTruthy()
  })
})

describe('kid celebrations', () => {
  const kid = kids[0] as Kid
  test('level and Mode default PATCH the kid', async () => {
    wrap(<KidCelebrations kid={{ ...kid, celebrate: 'full' }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Off' }))
    await waitFor(() => expect(sent('/kids/3', 'PATCH')).toContainEqual({ celebrate: 'off' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mode default' }))
    await waitFor(() => expect(sent('/kids/3', 'PATCH')).toContainEqual({ celebrate: null }))
  })

  test('Preview plays a celebration and writes nothing to the server', async () => {
    const { container } = wrap(<KidCelebrations kid={kid} />)
    expect(container.querySelector('[data-celebrate]')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Preview a celebration' }))
    expect(container.ownerDocument.querySelector('[data-celebrate]')).not.toBeNull()
    expect(apiMock.mock.calls.filter((c) => c[1]?.method)).toEqual([])
  })

  test('Preview follows the level: small plays small, off is disabled', async () => {
    const { container, unmount } = wrap(<KidCelebrations kid={{ ...kid, celebrate: 'small' }} />)
    await userEvent.click(screen.getByRole('button', { name: 'Preview a celebration' }))
    expect(container.ownerDocument.querySelector('[data-celebrate]')?.getAttribute('data-celebrate')).not.toBe('full')
    unmount()
    wrap(<KidCelebrations kid={{ ...kid, celebrate: 'off' }} />)
    expect(screen.getByRole('button', { name: 'Preview a celebration' }).hasAttribute('disabled')).toBe(true)
  })

  test('Mode default is selected when the kid has no pick (null)', () => {
    wrap(<KidCelebrations kid={{ ...kid, celebrate: null }} />)
    expect(screen.getByRole('button', { name: 'Mode default' }).getAttribute('aria-pressed')).toBe('true')
  })
})

describe('alerts', () => {
  test('boost has a bolt and a See Happy Hour action', async () => {
    const n = { id: 1, kind: 'boost', glyph: null } as never
    expect(severity(n)).toEqual({ name: 'bolt', tone: 'ok' })
    const go = jest.fn(async () => {})
    const f = () => {}
    render(<MantineProvider env="test"><InboxRow n={{ ...n, pending: false, title: 'Boost', created_at: new Date().toISOString() } as never} live busy={false} sending={false} note="" onNote={f} onApprove={f} onSendBack={f} onDecide={f} onDismiss={f} onLock={f} onOpen={f} go={go} /></MantineProvider>)
    await userEvent.click(screen.getByRole('button', { name: 'More for Boost' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'See Happy Hour' }))
    expect(go).toHaveBeenCalledWith('/')
  })

  test('kid happy_hour alert gets a bolt', async () => {
    apiMock.mockImplementation(async (p) =>
      p === '/notifications' ? { items: [{ id: 1, kind: 'happy_hour', title: 'Happy Hour started!', body: null, created_at: new Date().toISOString(), read: false, run_id: null }], unread: 1, has_more: false } : undefined,
    )
    wrap(<KidAlerts onChores={() => {}} />)
    const row = await screen.findByText('Happy Hour started!')
    expect(within(row.closest('button')!).getByText('bolt')).toBeTruthy()
  })
})
