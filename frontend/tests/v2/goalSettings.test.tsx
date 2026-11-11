import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { GoalSettingsPane } from '@/v2/manage/GoalSettingsPane'
import type { GoalSettings } from '@/v2/goalTypes'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>
const base: GoalSettings = { on: true, suggest: true, withdraw: true, siblings: false, auto: false, auto_pct: 25, max_little: 1, max_kid: 2, max_teen: 3, screen_on: false, screen_price: 200, screen_minutes: 60, jail_on: false, jail_price: 500, screen_ok: true }
let cur: GoalSettings
const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test">{ui}</MantineProvider>
    </QueryClientProvider>,
  )

beforeEach(() => {
  cur = base
  apiMock.mockReset()
  apiMock.mockImplementation(async (p, i) => {
    if (i?.method === 'PATCH') return { ...cur, ...(i.body as object) }
    if (p === '/goals/settings') return cur
    return undefined
  })
})

describe('GoalSettingsPane', () => {
  test('a toggle sends a PATCH with just that field', async () => {
    wrap(<GoalSettingsPane onBack={() => {}} />)
    await userEvent.click(await screen.findByRole('switch', { name: 'Kids can suggest goals' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/goals/settings', { method: 'PATCH', body: { suggest: false } }))
  })

  test('a number field patches on blur', async () => {
    wrap(<GoalSettingsPane onBack={() => {}} />)
    const f = await screen.findByLabelText('Little kids')
    await userEvent.clear(f)
    await userEvent.type(f, '4')
    await userEvent.tab()
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/goals/settings', { method: 'PATCH', body: { max_little: 4 } }))
  })

  test('extra screen time is disabled without screen time', async () => {
    cur = { ...base, screen_ok: false }
    wrap(<GoalSettingsPane onBack={() => {}} />)
    expect(await screen.findByText('Turn on screen time first')).toBeTruthy()
    expect((screen.getByRole('switch', { name: 'Extra screen time' }) as HTMLButtonElement).disabled).toBe(true)
  })

  test('back link calls onBack', async () => {
    const onBack = jest.fn()
    wrap(<GoalSettingsPane onBack={onBack} />)
    await userEvent.click(await screen.findByRole('button', { name: '‹ Goals' }))
    expect(onBack).toHaveBeenCalled()
  })
})
