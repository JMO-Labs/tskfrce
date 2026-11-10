import { describe, expect, test, beforeEach } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { PenaltyCards } from '@/v2/kid/PenaltyCard'
import type { KidPenalty } from '@/v2/penaltyTypes'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
const apiMock = api as unknown as Mock<(p: string, i?: { method?: string }) => Promise<unknown>>
const pen = (o: Partial<KidPenalty> = {}) =>
  ({ id: 5, kind: 'points', amount_taken: 20, amount_returned: 5, back_total: 10, label: null, reason: 'Said dishes were done', by_name: 'Mom', ends_at: null, seen_by_kid: false,
    makeup: [{ run_id: 1, title: 'Wipe counters', status: 'done' }, { run_id: 2, title: 'Sweep kitchen', status: 'todo' }, { run_id: 3, title: 'Mop', status: 'submitted' }], ...o }) as KidPenalty
const wrap = (list: KidPenalty[], done = { mutate: jest.fn(), isPending: false }) => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PenaltyCards list={list} done={done} />
    </QueryClientProvider>,
  )
  return done
}
beforeEach(() => apiMock.mockReset().mockResolvedValue({}))

describe('PenaltyCards', () => {
  test('title, reason, meter, items', () => {
    wrap([pen()])
    expect(screen.getByText('20 points taken')).toBeTruthy()
    expect(screen.getByText('“Said dishes were done”, Mom')).toBeTruthy()
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('5')
    expect(screen.getByText('✓ Wipe counters')).toBeTruthy()
    expect(screen.getByText('… Mop')).toBeTruthy()
    expect(screen.getByText('1 of 3 done')).toBeTruthy()
  })
  test('no reason shows only the giver', () => {
    wrap([pen({ reason: null })])
    expect(screen.getByText('Mom')).toBeTruthy()
  })
  test('tapping a todo chore marks it done', async () => {
    const done = wrap([pen()])
    await userEvent.click(screen.getByRole('button', { name: '○ Sweep kitchen' }))
    expect(done.mutate).toHaveBeenCalledWith(2)
  })
  test('no earn-back: no meter, marked seen once', async () => {
    wrap([pen({ back_total: 0, makeup: [] })])
    expect(screen.queryByRole('progressbar')).toBeNull()
    await waitFor(() => expect(apiMock.mock.calls.filter((c) => c[0] === '/kid/penalties/5/seen')).toHaveLength(1))
  })
  test('already seen or earn-back card: no seen post', async () => {
    wrap([pen({ back_total: 0, makeup: [], seen_by_kid: true }), pen({ id: 6 })])
    await new Promise((r) => setTimeout(r, 20))
    expect(apiMock.mock.calls.filter((c) => String(c[0]).includes('/seen'))).toHaveLength(0)
  })
  test('empty renders nothing', () => {
    wrap([])
    expect(screen.queryByTestId('penalty-card')).toBeNull()
  })
})
