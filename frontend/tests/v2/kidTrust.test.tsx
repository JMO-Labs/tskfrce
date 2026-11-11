import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { useMarkDone } from '@/v2/hooks/useKid'
import { TrustChip, trustLine } from '@/v2/kid/TrustChip'
import { detect } from '@/v2/kid/celebrate/triggers'
import { planShow } from '@/v2/kid/celebrate/plan'
import type { KidToday } from '@/v2/types'
import type { KidTrust } from '@/v2/trustTypes'

jest.mock('@/v2/api', () => ({ api: jest.fn(), AuthError: class extends Error {}, ApiError: class extends Error {}, kidToken: () => null }))
jest.mock('@/v2/notify', () => ({ toastOk: jest.fn(), toastFail: jest.fn(), retryIfOffline: jest.fn() }))
const apiMock = api as unknown as Mock<(p: string, i?: unknown) => Promise<unknown>>

const GOAL = [10, 30, null] as const
const tr = (level: 0 | 1 | 2, to_next: number | null): KidTrust => ({ level, to_next, goal: GOAL[level] })
const today = (trust: KidTrust | null | undefined, chore = 'todo'): KidToday => ({
  locked: false, points_balance: 0, age_group: 'kid', locks_at: null, trust,
  chores: [{ id: 1, title: 'Dishes', points: 10, state: chore as 'todo' }],
})

describe('TrustChip', () => {
  test('hidden when trust mode is off', () => {
    const { container } = render(<TrustChip trust={null} mode="kid" />)
    expect(container).toBeEmptyDOMElement()
    expect(render(<TrustChip mode="kid" />).container).toBeEmptyDOMElement()
  })

  test.each([
    [tr(0, 3), 'little', 'New', '3 more chores to Trusted!', 'today', 'lg'],
    [tr(1, 12), 'kid', 'Trusted', '12 more chores to Proven. Nice going.', 'done', 'md'],
    [tr(1, 8), 'teen', 'Trusted', '22 of 30 toward Proven.', 'done', 'sm'],
    [tr(0, 7), 'teen', 'New', '3 of 10 toward Trusted.', 'today', 'sm'],
    [tr(2, null), 'kid', 'Proven', 'You made it to Proven. Keep it up!', 'sun', 'md'],
    [tr(2, null), 'teen', 'Proven', 'You made it to Proven.', 'sun', 'sm'],
  ] as const)('%j in %s mode', (t, mode, word, line, tone, size) => {
    render(<TrustChip trust={t} mode={mode} />)
    const chip = screen.getByText(word).closest('.k-chip')!
    expect(chip).toHaveAttribute('data-tone', tone)
    expect(chip).toHaveAttribute('data-size', size)
    expect(screen.getByText(line)).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/level/i)
  })

  test('one chore left is singular', () => {
    expect(trustLine(tr(0, 1), 'kid')).toBe('1 more chore to Trusted!')
  })
})

describe('level-up celebration', () => {
  test('fires once when the level rises, and never replays', () => {
    const a = detect(null, today(tr(0, 1)))
    expect(a.events).toEqual([])
    const b = detect(a.next, today(tr(1, 30)))
    expect(b.events.map((e) => e.kind)).toEqual(['level'])
    expect(b.events[0]).toMatchObject({ key: 't:1', big: true })
    expect(detect(b.next, today(tr(1, 29))).events).toEqual([])
  })

  test('seen on the next open: the stored track still fires it', () => {
    const stored = JSON.parse(JSON.stringify(detect(null, today(tr(0, 1))).next))
    expect(detect(stored, today(tr(1, 30))).events.map((e) => e.key)).toEqual(['t:1'])
  })

  test('quiet when trust is off, first look, drops, or an older stored track', () => {
    expect(detect(null, today(tr(2, null))).events).toEqual([])
    expect(detect(detect(null, today(null)).next, today(tr(1, 30))).events).toEqual([])
    expect(detect(detect(null, today(tr(2, null))).next, today(tr(1, 30))).events).toEqual([])
    const old = detect(null, today(undefined)).next
    delete (old as { trust?: unknown }).trust
    expect(detect(old, today(tr(1, 30))).events).toEqual([])
  })

  test('reduced motion plays it as the static badge', () => {
    const e = detect(detect(null, today(tr(0, 1))).next, today(tr(1, 30))).events[0]
    const ctx = { level: 'full', mode: 'kid', reduced: true, rng: Math.random, last: null, kidLevel: 1, date: new Date() } as const
    expect(planShow(e, ctx)!.kind).toBe('static')
  })
})

describe('useMarkDone', () => {
  const run = (status: string) => {
    const qc = new QueryClient()
    qc.setQueryData(['kid', 'today', false], today(null))
    apiMock.mockReset().mockImplementation(async (p: string) => (p.endsWith('/done') ? { status } : today(null, status === 'done' ? 'done' : 'needs_you')))
    const w = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
    const h = renderHook(() => useMarkDone(() => {}), { wrapper: w })
    return { qc, h }
  }
  const state = (qc: QueryClient) => (qc.getQueryData(['kid', 'today', false]) as KidToday).chores[0].state

  test('done goes straight to done in the cache', async () => {
    apiMock.mockReset()
    const { qc, h } = run('done')
    apiMock.mockImplementation(async (p: string) => (p.endsWith('/done') ? { status: 'done' } : new Promise(() => {})))
    await act(async () => { h.result.current.mutate(1) })
    await waitFor(() => expect(state(qc)).toBe('done'))
  })

  test('a wait and a spot check look the same: both leave the chore waiting for OK', async () => {
    apiMock.mockReset()
    const { qc, h } = run('submitted_for_approval')
    apiMock.mockImplementation(async (p: string) => (p.endsWith('/done') ? { status: 'submitted_for_approval' } : new Promise(() => {})))
    await act(async () => { h.result.current.mutate(1) })
    await waitFor(() => expect(state(qc)).toBe('needs_you'))
  })
})

beforeEach(() => localStorage.clear())

test('teen total comes from the API goal, not a copy of the backend thresholds', () => {
  expect(trustLine({ level: 1, to_next: 10, goal: 12 }, 'teen')).toBe('2 of 12 toward Proven.')
})
