import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { KidGoals } from '@/v2/kid/KidGoals'
import { api } from '@/v2/api'
import { fridgeTheme } from '@/v2/theme'

jest.mock('@/v2/api', () => ({ ...(jest.requireActual('@/v2/api') as object), api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>

const goal = (over: object = {}) => ({
  id: 1, name: 'New bike', emoji: null, kind: 'custom', family: false, kid_id: 5, kid_name: 'Ivy', target: 2000, saved: 1240,
  minutes: null, status: 'active', waiting_on: null, mine: 1240, siblings: null, created_at: '', fulfilled_at: null, ...over,
})
const data = (over: object = {}) => ({
  on: true, suggest: true, withdraw: true, auto: false, auto_pct: 25, auto_goal_id: null, can_add: true, free: 100,
  builtins: [], goals: [goal()], done: [], party: [], ...over,
})
const serve = (d: object) =>
  apiMock.mockImplementation(async (p, i) => {
    if ((i?.method ?? 'GET') === 'GET' && p === '/kid/goals') return d
    return undefined
  })
const wrap = (ui: React.ReactNode) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider theme={fridgeTheme}>{ui}</MantineProvider>
    </QueryClientProvider>,
  )

beforeEach(() => apiMock.mockReset())

describe('KidGoals', () => {
  test('full goal shows who it waits on', async () => {
    serve(data({ goals: [goal({ status: 'full', saved: 2000, waiting_on: 'Mom' })] }))
    wrap(<KidGoals onExpired={() => {}} />)
    expect(await screen.findByText('Goal reached! Waiting on Mom')).toBeInTheDocument()
  })

  test('family goal shows what you gave', async () => {
    serve(data({ goals: [goal({ family: true, kid_id: null, mine: 1900 })] }))
    wrap(<KidGoals onExpired={() => {}} />)
    expect(await screen.findByText('You gave 1,900')).toBeInTheDocument()
    expect(screen.getByText('Family')).toBeInTheDocument()
  })

  test('suggest button hidden when suggest is off', async () => {
    serve(data({ suggest: false }))
    wrap(<KidGoals onExpired={() => {}} />)
    await screen.findByText('New bike')
    expect(screen.queryByText('+ Suggest a goal')).toBeNull()
  })

  test('built-ins stay pickable with suggestions off', async () => {
    serve(data({ suggest: false, builtins: [{ kind: 'screen', name: '60 min extra screen time', target: 200, minutes: 60 }] }))
    wrap(<KidGoals onExpired={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: '+ Pick a goal' }))
    expect(screen.queryByLabelText('What do you want to save for?')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '60 min extra screen time · 200 points' }))
    expect(apiMock.mock.calls.some((x) => x[0] === '/kid/goals/start')).toBe(true)
  })

  test('auto-save can pick a family goal and the emoji shows', async () => {
    serve(data({ auto: true, goals: [goal({ id: 9, family: true, kid_id: null, emoji: '🏰', name: 'Disney trip' })] }))
    wrap(<KidGoals onExpired={() => {}} />)
    expect(await screen.findByText('🏰', { exact: false })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Auto-save here' }))
    expect(apiMock.mock.calls.some((x) => x[0] === '/kid/goals/9/auto')).toBe(true)
  })

  test('suggest button shown when on', async () => {
    serve(data())
    wrap(<KidGoals onExpired={() => {}} />)
    expect(await screen.findByText('+ Suggest a goal')).toBeInTheDocument()
  })

  test('Add posts the amount', async () => {
    serve(data())
    wrap(<KidGoals onExpired={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: '+ Add' }))
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    const c = apiMock.mock.calls.find((x) => x[0] === '/kid/goals/1/add')
    expect(c?.[1]).toMatchObject({ method: 'POST', body: { amount: 10 } })
  })

  test('Take back hidden for family, full goals and when withdraw is off', async () => {
    serve(data({ goals: [goal({ id: 2, family: true, kid_id: null }), goal({ id: 3, name: 'Pizza', status: 'full', waiting_on: 'Mom' })] }))
    const { unmount } = wrap(<KidGoals onExpired={() => {}} />)
    await userEvent.click((await screen.findAllByRole('button', { name: '+ Add' }))[0])
    expect(screen.queryByRole('button', { name: 'Take back' })).toBeNull()
    unmount()
    serve(data({ withdraw: false }))
    wrap(<KidGoals onExpired={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: '+ Add' }))
    expect(screen.queryByRole('button', { name: 'Take back' })).toBeNull()
  })

  test('Take back shown for own active goal', async () => {
    serve(data())
    wrap(<KidGoals onExpired={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: '+ Add' }))
    expect(screen.getByRole('button', { name: 'Take back' })).toBeInTheDocument()
  })

  test('Little mode sets data-mode', async () => {
    serve(data())
    wrap(<KidGoals onExpired={() => {}} mode="little" />)
    await screen.findByText('New bike')
    expect(document.querySelector('.kg-view')).toHaveAttribute('data-mode', 'little')
  })

  test('hidden when off', async () => {
    serve(data({ on: false, goals: [] }))
    const { container } = wrap(<KidGoals onExpired={() => {}} />)
    await new Promise((r) => setTimeout(r, 20))
    expect(container.querySelector('.kg-view')).toBeNull()
  })
})
