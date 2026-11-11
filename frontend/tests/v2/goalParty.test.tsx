import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { GoalParty } from '@/v2/kid/celebrate/GoalParty'
import { useKidGoals, useKidGoalAction } from '@/v2/hooks/useKidGoals'

jest.mock('@/v2/hooks/useKidGoals', () => ({ useKidGoals: jest.fn(), useKidGoalAction: jest.fn() }))

const mutate = jest.fn()
const setParty = (party: Array<{ goal_id: number; name: string; by: string }>) =>
  (useKidGoals as unknown as Mock<() => unknown>).mockReturnValue({ data: { party } })

const reduce = (on: boolean) =>
  (window.matchMedia = ((q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia)

beforeEach(() => {
  mutate.mockReset()
  ;(useKidGoalAction as unknown as Mock<() => unknown>).mockReturnValue({ mutate })
  reduce(false)
  setParty([{ goal_id: 4, name: 'Pizza night', by: 'Mom' }])
})

describe('GoalParty', () => {
  test('shows the name and who made it official', () => {
    render(<GoalParty onExpired={() => {}} celebrate="full" />)
    expect(screen.getByRole('dialog', { name: 'Goal complete' })).toBeTruthy()
    expect(screen.getByText(/Pizza night/)).toBeTruthy()
    expect(screen.getByText('Mom made it official.')).toBeTruthy()
    expect(document.querySelectorAll('img').length).toBe(6)
    expect(document.querySelectorAll('[data-confetti]').length).toBe(34)
  })

  test('a click calls party-seen and closes', async () => {
    render(<GoalParty onExpired={() => {}} celebrate="full" />)
    await userEvent.click(screen.getByRole('dialog'))
    expect(mutate).toHaveBeenCalledWith({ id: 4, action: 'party-seen' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('Escape dismisses', async () => {
    render(<GoalParty onExpired={() => {}} celebrate="full" />)
    await userEvent.keyboard('{Escape}')
    expect(mutate).toHaveBeenCalledWith({ id: 4, action: 'party-seen' })
  })

  test('reduced motion has no confetti', () => {
    reduce(true)
    render(<GoalParty onExpired={() => {}} celebrate="full" />)
    expect(document.querySelectorAll('[data-confetti]').length).toBe(0)
  })

  test('celebrate off has no confetti', () => {
    render(<GoalParty onExpired={() => {}} celebrate="off" />)
    expect(document.querySelectorAll('[data-confetti]').length).toBe(0)
  })

  test('shows the next party after the first', async () => {
    setParty([{ goal_id: 4, name: 'Pizza night', by: 'Mom' }, { goal_id: 5, name: 'Bike', by: 'Dad' }])
    render(<GoalParty onExpired={() => {}} celebrate="full" />)
    await userEvent.click(screen.getByRole('dialog'))
    expect(screen.getByText(/Bike/)).toBeTruthy()
  })

  test('reports showing, and nothing renders with no party', () => {
    const showing = jest.fn()
    setParty([])
    render(<GoalParty onExpired={() => {}} celebrate="full" onShowing={showing} />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(showing).toHaveBeenLastCalledWith(false)
  })
})
