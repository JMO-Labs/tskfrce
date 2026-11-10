import { expect, test } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { KidFacts } from '@/v2/today/KidFacts'
import type { TodayKid } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn(async () => ({ timezone: 'UTC' })) }))

const kid = (o: Partial<TodayKid>): TodayKid => ({ id: 1, name: 'Mia', avatar: null, online_all: true, points: 99, chores: [], devices: [], ...o })
const show = (k: TodayKid) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <KidFacts kid={k} />
    </QueryClientProvider>,
  )

test('facts are Streak, Last active, Next reward, Locks at (no Points)', () => {
  show(kid({ last_active: '2026-10-24T19:44:00Z' }))
  expect([...document.querySelectorAll('.p-kid-facts span')].map((e) => e.textContent)).toEqual(['Streak', 'Last active', 'Next reward', 'Locks at'])
  expect(screen.queryByText('Points')).toBeNull()
})

test('Last active shows the clock time, or a dash when never', () => {
  const { unmount } = show(kid({ last_active: '2026-10-24T19:44:00Z' }))
  expect(screen.getByText('Last active').nextSibling).toHaveTextContent(/\d+:\d\d [AP]M/)
  unmount()
  show(kid({ last_active: null }))
  expect(screen.getByText('Last active').nextSibling).toHaveTextContent('—')
})
