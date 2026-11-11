import { describe, expect, test, beforeEach } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { PenaltyCards } from '@/v2/kid/PenaltyCard'
import type { KidPenalty } from '@/v2/penaltyTypes'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>
const pen = (o: Partial<KidPenalty> = {}) =>
  ({ id: 5, kind: 'points', amount_taken: 20, amount_returned: 0, back_total: 10, label: null, reason: null, by_name: 'Mom', ends_at: null, seen_by_kid: true, makeup: [], ...o }) as KidPenalty
const wrap = (jail?: number, list = [pen()]) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <PenaltyCards list={list} jail={jail} done={{ mutate: jest.fn(), isPending: false }} />
    </QueryClientProvider>,
  )
beforeEach(() => apiMock.mockReset().mockResolvedValue({ cards: 0 }))

describe('jail card button', () => {
  test('hidden without a card', () => {
    wrap(0)
    expect(screen.queryByRole('button', { name: 'Use Get out of jail free' })).toBeNull()
    wrap()
    expect(screen.queryByRole('button', { name: 'Use Get out of jail free' })).toBeNull()
  })
  test('plays the card on that penalty', async () => {
    wrap(1, [pen(), pen({ id: 6 })])
    const b = screen.getAllByRole('button', { name: 'Use Get out of jail free' })
    expect(b).toHaveLength(2)
    await userEvent.click(b[1])
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/kid/goals/jail/play', expect.objectContaining({ method: 'POST', body: { penalty_id: 6 }, kid: true })),
    )
  })
})
