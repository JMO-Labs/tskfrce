import { afterEach, beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { useState } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { TrustBody, TrustLine } from '@/v2/manage/TrustSection'
import { WasntDoneSheet } from '@/v2/today/WasntDoneSheet'
import { ChoreRow } from '@/v2/today/ChoreRow'
import type { Kid, TodayChore, TodayKid } from '@/v2/types'
import type { SelfApproved } from '@/v2/trustTypes'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>

const kid = (over: Partial<Kid> = {}): Kid => ({
  id: 7, full_name: 'Maya', username: 'kid-maya', avatar: null, has_pin: false, age_group: 'kid',
  trust_mode: true, trust_level: 1, trust_clean: 18, trust_goal: 30, ...over,
})
const row = (id: number, over: Partial<SelfApproved> = {}): SelfApproved => ({
  id, title: `Chore ${id}`, day: '2026-11-06', approved_at: new Date().toISOString(), approved_via: 'trust', points: 20, photos: 0, ...over,
})
let rows: SelfApproved[] = []
const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  )
// the Trust row: calm line plus body, as KidDetail lays them out
const TrustSection = ({ kid: k }: { kid: Kid }) => (
  <>
    <TrustLine kid={k} />
    <TrustBody kid={k} />
  </>
)
const sent = (path: string, method = 'PATCH') => apiMock.mock.calls.find(([p, i]) => p === path && i?.method === method)?.[1]?.body

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  global.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
})
beforeEach(() => {
  rows = []
  apiMock.mockReset().mockImplementation(async (p) => (p.endsWith('/self-approved') ? rows : p === '/today' ? { day: '2026-11-06' } : {}))
})

describe('trust card', () => {
  test('off: one line, no picker; the switch PATCHes trust_mode true', async () => {
    wrap(<TrustSection kid={kid({ trust_mode: false })} />)
    expect(screen.getByText('Off: you approve every chore. Turn on to let chores approve themselves as Maya earns it.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Change' })).toBeNull()
    await userEvent.click(screen.getByRole('switch', { name: 'Trust mode' }))
    await waitFor(() => expect(sent('/kids/7')).toEqual({ trust_mode: true }))
  })

  test('on: chip, progress text from trust_goal, Change; switch off PATCHes false', async () => {
    wrap(<TrustSection kid={kid()} />)
    expect(screen.getByText('Trusted')).toBeInTheDocument()
    expect(screen.getByText('18/30')).toBeInTheDocument()
    expect(screen.getByText('Next level: Proven')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: 'Trust mode' }))
    await waitFor(() => expect(sent('/kids/7')).toEqual({ trust_mode: false }))
  })

  test('Proven has no progress line', () => {
    wrap(<TrustSection kid={kid({ trust_level: 2, trust_goal: null })} />)
    expect(screen.getByText('Proven')).toBeInTheDocument()
    expect(screen.queryByText(/^\d+\/\d+$|Next level/)).toBeNull()
  })

  test('Change opens the level sheet; the line follows the pick; Save PATCHes trust_level', async () => {
    wrap(<TrustSection kid={kid()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    const d = await screen.findByRole('dialog', { name: 'Trust level' })
    expect(within(d).getByText('Trusted: chores approve themselves. 1 in 5 waits for you as a spot check.')).toBeInTheDocument()
    await userEvent.click(within(d).getByRole('button', { name: 'Proven' }))
    expect(within(d).getByText(/^Proven: .* 1 in 20 /)).toBeInTheDocument()
    await userEvent.click(within(d).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(sent('/kids/7')).toEqual({ trust_level: 2 }))
  })

  test('Cancel sends nothing', async () => {
    wrap(<TrustSection kid={kid()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Change' }))
    const d = await screen.findByRole('dialog', { name: 'Trust level' })
    await userEvent.click(within(d).getByRole('button', { name: 'New' }))
    await userEvent.click(within(d).getByRole('button', { name: 'Cancel' }))
    expect(sent('/kids/7')).toBeUndefined()
  })
})

describe('approved on their own', () => {
  test('no rows: the sub-section is hidden', async () => {
    wrap(<TrustSection kid={kid()} />)
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/kids/7/self-approved'))
    expect(screen.queryByText('Approved on their own')).toBeNull()
  })

  test('2 newest show; See all lists the rest; Wasn\'t done posts lower_trust true by default', async () => {
    rows = [row(1), row(2), row(3, { approved_via: 'bedtime' })]
    wrap(<TrustSection kid={kid()} />)
    expect(await screen.findByText('3 this week')).toBeInTheDocument()
    expect(screen.getByText('Chore 1')).toBeInTheDocument()
    expect(screen.queryByText('Chore 3')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'See all' }))
    const all = await screen.findByRole('dialog', { name: 'Approved on their own' })
    expect(within(all).getByText('Chore 3')).toBeInTheDocument()
    expect(within(all).getByText(/at bedtime/)).toBeInTheDocument()
    await userEvent.click(within(all).getAllByRole('button', { name: "Wasn't done" })[0])
    const sheet = await screen.findByRole('dialog', { name: "Wasn't done?" })
    expect(within(sheet).getByRole('checkbox', { name: /Also lower trust level/ })).toBeChecked()
    await userEvent.click(within(sheet).getByRole('button', { name: "Wasn't done" }))
    await waitFor(() => expect(sent('/chores/1/take-back', 'POST')).toEqual({ lower_trust: true }))
  })

  test('still shown when trust mode is off but rows exist', async () => {
    rows = [row(1)]
    wrap(<TrustSection kid={kid({ trust_mode: false })} />)
    expect(await screen.findByText('Approved on their own')).toBeInTheDocument()
  })
})

describe("Wasn't done sheet", () => {
  const run = { id: 9, title: 'Clean room', day: '2026-11-06', points: 20 }
  const open = (r = run, today = '2026-11-06') =>
    wrap(<WasntDoneSheet run={r} today={today} kidName="Maya" level={1} onClose={() => {}} />)

  test('unticked sends lower_trust false', async () => {
    open()
    expect(screen.getByText(/“Clean room” goes back on Maya's list for today, and the 20 points it earned come off/)).toBeInTheDocument()
    expect(screen.getByText('Maya goes from Trusted to New.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('checkbox', { name: /Also lower trust level/ }))
    await userEvent.click(screen.getByRole('button', { name: "Wasn't done" }))
    await waitFor(() => expect(sent('/chores/9/take-back', 'POST')).toEqual({ lower_trust: false }))
  })

  test('New kid: no lower-trust box, says the count starts over, sends false', async () => {
    wrap(<WasntDoneSheet run={run} today="2026-11-06" kidName="Maya" level={0} onClose={() => {}} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    expect(screen.getByText("Maya's count toward Trusted starts over.")).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: "Wasn't done" }))
    await waitFor(() => expect(sent('/chores/9/take-back', 'POST')).toEqual({ lower_trust: false }))
  })

  test('an older day says it will not come back', () => {
    open({ ...run, day: '2026-11-02' }, '2026-11-06')
    expect(screen.getByText(/This chore was from Monday, so it won't come back\./)).toBeInTheDocument()
  })

  test('no amount known: the sentence drops the number', () => {
    open({ ...run, points: null })
    expect(screen.getByText(/and the points it earned come off\./)).toBeInTheDocument()
  })

  test('trust off: no lower-trust box and lower_trust false', async () => {
    wrap(<WasntDoneSheet run={run} today="2026-11-06" kidName="Maya" level={1} trustOn={false} onClose={() => {}} />)
    expect(screen.queryByRole('checkbox')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: "Wasn't done" }))
    await waitFor(() => expect(sent('/chores/9/take-back', 'POST')).toEqual({ lower_trust: false }))
  })

  test('confirm waits until today is known', () => {
    open(run, '')
    expect(screen.getByRole('button', { name: "Wasn't done" })).toBeDisabled()
  })

  test('Keep closes without a request', async () => {
    open()
    await userEvent.click(screen.getByRole('button', { name: 'Keep' }))
    expect(sent('/chores/9/take-back', 'POST')).toBeUndefined()
  })
})

describe('Today mark', () => {
  const tk = { id: 1, name: 'Maya', chores: [], devices: [] } as unknown as TodayKid
  const chore = (via?: string): TodayChore => ({ id: 3, title: 'Dishes', points: 10, state: 'done', approved_via: via, done_at: '2026-11-06T17:40:00Z' })
  const show = (c: TodayChore) =>
    wrap(<ChoreRow chore={c} kid={tk} isOpen={false} onToggle={() => undefined} />)

  test.each(['trust', 'bedtime'])('approved_via %s shows the mark', (via) => {
    show(chore(via))
    expect(screen.getByText('Approved on its own')).toBeInTheDocument()
  })
  test.each(['parent', null, undefined])('approved_via %s shows no mark', (via) => {
    show(chore(via as string | undefined))
    expect(screen.queryByText('Approved on its own')).toBeNull()
  })
})

describe('focus returns after a sheet closes', () => {
  test('Trust level sheet: Escape lands on Change', async () => {
    wrap(<TrustSection kid={kid()} />)
    const change = screen.getByRole('button', { name: 'Change' })
    await userEvent.click(change)
    await screen.findByRole('dialog', { name: 'Trust level' })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(change).toHaveFocus())
  })

  test("Wasn't done sheet from See all: Keep lands on See all", async () => {
    rows = [row(1), row(2), row(3)]
    wrap(<TrustSection kid={kid()} />)
    const seeAll = await screen.findByRole('button', { name: 'See all' })
    await userEvent.click(seeAll)
    const all = await screen.findByRole('dialog', { name: 'Approved on their own' })
    await userEvent.click(within(all).getAllByRole('button', { name: "Wasn't done" })[0])
    const sheet = await screen.findByRole('dialog', { name: "Wasn't done?" })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Keep' }))
    await waitFor(() => expect(seeAll).toHaveFocus())
  })

  test("Wasn't done sheet from an inline row: Keep lands on that row's button", async () => {
    rows = [row(1), row(2), row(3)]
    wrap(<TrustSection kid={kid()} />)
    await screen.findByRole('button', { name: 'See all' })
    const btn = screen.getAllByRole('button', { name: "Wasn't done" })[1]
    await userEvent.click(btn)
    const sheet = await screen.findByRole('dialog', { name: "Wasn't done?" })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Keep' }))
    await waitFor(() => expect(btn).toHaveFocus())
  })

  test("Wasn't done sheet opened from a button: Escape refocuses that button", async () => {
    const Host = () => {
      const [o, setO] = useState(false)
      return (
        <>
          <button type="button" onClick={() => setO(true)}>open</button>
          {o && <WasntDoneSheet run={{ id: 9, title: 'Dishes', day: '2026-11-06', points: 5 }} today="2026-11-06" kidName="Maya" level={1} onClose={() => setO(false)} />}
        </>
      )
    }
    wrap(<Host />)
    const btn = screen.getByRole('button', { name: 'open' })
    await userEvent.click(btn)
    await screen.findByRole('dialog', { name: "Wasn't done?" })
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(btn).toHaveFocus())
  })

  test('Trust switch keeps focus while saving', async () => {
    wrap(<TrustSection kid={kid()} />)
    const sw = screen.getByRole('switch', { name: 'Trust mode' })
    sw.focus()
    await userEvent.keyboard(' ')
    await waitFor(() => expect(sent('/kids/7')).toEqual({ trust_mode: false }))
    expect(sw).toHaveFocus()
    expect(sw).not.toBeDisabled()
  })
})
