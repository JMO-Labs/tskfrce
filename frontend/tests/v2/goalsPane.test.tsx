import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { GoalsPane } from '@/v2/manage/GoalsPane'
import type { Goal, GoalSettings, ParentGoals } from '@/v2/goalTypes'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>
const settings: GoalSettings = { on: true, suggest: true, withdraw: true, siblings: false, auto: false, auto_pct: 25, max_little: 1, max_kid: 2, max_teen: 3, screen_on: false, screen_price: 200, screen_minutes: 60, jail_on: false, jail_price: 500, screen_ok: true }
const goal = (o: Partial<Goal>): Goal => ({ id: 1, name: 'G', emoji: null, kind: 'custom', family: false, kid_id: 3, kid_name: 'Ivy', target: 100, saved: 10, minutes: null, status: 'active', waiting_on: null, mine: 0, siblings: null, created_at: '', fulfilled_at: null, ...o })
const empty: ParentGoals = { settings, waiting: [], family: [], kids: [], done: [] }
let data: ParentGoals
const kids = [{ id: 3, full_name: 'Ivy', username: 'ivy', avatar: null, has_pin: false, age_group: 'kid' }]
const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test">{ui}</MantineProvider>
    </QueryClientProvider>,
  )
const sent = (p: string) => apiMock.mock.calls.filter((c) => c[0] === p && c[1]?.method).map((c) => c[1]?.body)

beforeEach(() => {
  data = empty
  apiMock.mockReset()
  apiMock.mockImplementation(async (p, i) => {
    if (i?.method) return {}
    if (p === '/goals') return data
    if (p === '/kids') return kids
    return undefined
  })
})

describe('GoalsPane', () => {
  test('Fulfilled calls fulfill', async () => {
    data = { ...empty, waiting: [goal({ id: 5, name: 'Pizza', status: 'full', target: 300, saved: 300 })] }
    wrap(<GoalsPane onSettings={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Fulfilled' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/goals/5/fulfill', { method: 'POST' }))
  })

  test('Set price opens an input and posts the price', async () => {
    data = { ...empty, waiting: [goal({ id: 6, name: 'Skateboard', status: 'suggested', target: null, saved: 0 })] }
    wrap(<GoalsPane onSettings={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Set price' }))
    await userEvent.type(screen.getByLabelText('Price'), '250')
    await userEvent.click(screen.getByRole('button', { name: 'Save price' }))
    await waitFor(() => expect(sent('/goals/6/price')).toEqual([{ target: 250 }]))
  })

  test('chip in posts the amount', async () => {
    data = { ...empty, family: [goal({ id: 9, name: 'Disney', family: true, kid_id: null, kid_name: null, target: 20000, saved: 6800 })] }
    wrap(<GoalsPane onSettings={() => {}} />)
    await userEvent.click(await screen.findByRole('button', { name: '+ Chip in' }))
    await userEvent.type(screen.getByLabelText('Amount'), '50')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(sent('/goals/9/chip-in')).toEqual([{ amount: 50 }]))
  })

  test('empty state shows only New goal and settings', async () => {
    const onSettings = jest.fn()
    wrap(<GoalsPane onSettings={onSettings} />)
    expect(await screen.findByText('+ New goal')).toBeTruthy()
    expect(screen.queryByText('Waiting on you')).toBeNull()
    expect(screen.queryByText('Family')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'Goal settings' }))
    expect(onSettings).toHaveBeenCalled()
  })

  test('kids card shows name, goal and saved / target', async () => {
    data = { ...empty, kids: [goal({ name: 'New bike', target: 2000, saved: 1240 })] }
    wrap(<GoalsPane onSettings={() => {}} />)
    expect(await screen.findByText('Ivy · New bike')).toBeTruthy()
    expect(screen.getByText('1,240 / 2,000')).toBeTruthy()
  })

  test('form hides built-ins that are off', async () => {
    wrap(<GoalsPane onSettings={() => {}} />)
    await userEvent.click(await screen.findByText('+ New goal'))
    expect(screen.getByLabelText('Name')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Extra screen time' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Get out of jail free' })).toBeNull()
  })

  test('form shows built-ins that are on', async () => {
    data = { ...empty, settings: { ...settings, screen_on: true, jail_on: true } }
    wrap(<GoalsPane onSettings={() => {}} />)
    await userEvent.click(await screen.findByText('+ New goal'))
    expect(screen.getByRole('button', { name: 'Extra screen time' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Get out of jail free' })).toBeTruthy()
  })

  test('creating a custom family goal posts it', async () => {
    wrap(<GoalsPane onSettings={() => {}} />)
    await userEvent.click(await screen.findByText('+ New goal'))
    await userEvent.type(screen.getByLabelText('Name'), 'Trip')
    await userEvent.type(screen.getByLabelText('Price'), '900')
    await userEvent.click(screen.getByRole('button', { name: 'Family' }))
    await userEvent.click(screen.getByRole('button', { name: 'Create goal' }))
    await waitFor(() => expect(sent('/goals')).toEqual([{ name: 'Trip', emoji: null, target: 900, kind: 'custom', kid_ids: [], family: true }]))
  })
})
