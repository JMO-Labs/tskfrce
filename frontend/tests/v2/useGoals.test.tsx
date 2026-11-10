import { beforeEach, describe, expect, test } from '@jest/globals'
import type { ReactNode } from 'react'
import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { useCreateGoal, useGoalAction, useGoalSettings, useGoals, usePatchGoalSettings } from '@/v2/hooks/useGoals'
import { useKidGoalAction, useKidGoals } from '@/v2/hooks/useKidGoals'
import { PreviewProvider } from '@/v2/hooks/usePreview'

jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('@/v2/api', () => {
  class AuthError extends Error {}
  class ApiError extends Error {
    constructor(public status: number, m: string) {
      super(m)
    }
  }
  return { api: jest.fn(), AuthError, ApiError }
})

const mockApi = api as jest.MockedFunction<typeof api>
const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>
const wrapAs = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={qc}>
    <PreviewProvider value={5}>{children}</PreviewProvider>
  </QueryClientProvider>
)

beforeEach(() => {
  mockApi.mockReset()
  mockApi.mockResolvedValue({} as never)
  qc.clear()
})

describe('parent goal hooks', () => {
  test('useGoals and useGoalSettings GET', async () => {
    const r = renderHook(() => useGoals(), { wrapper: wrap })
    await waitFor(() => expect(r.result.current.isSuccess).toBe(true))
    expect(mockApi).toHaveBeenCalledWith('/goals')
    const s = renderHook(() => useGoalSettings(), { wrapper: wrap })
    await waitFor(() => expect(s.result.current.isSuccess).toBe(true))
    expect(mockApi).toHaveBeenCalledWith('/goals/settings')
  })

  test('usePatchGoalSettings PATCHes', async () => {
    const { result } = renderHook(() => usePatchGoalSettings(), { wrapper: wrap })
    await act(() => result.current.mutateAsync({ on: false }))
    expect(mockApi).toHaveBeenCalledWith('/goals/settings', { method: 'PATCH', body: { on: false } })
  })

  test('useCreateGoal POSTs', async () => {
    const { result } = renderHook(() => useCreateGoal(), { wrapper: wrap })
    const body = { name: 'Bike', target: 100, kid_ids: [1], family: false }
    await act(() => result.current.mutateAsync(body))
    expect(mockApi).toHaveBeenCalledWith('/goals', { method: 'POST', body })
  })

  test.each([
    ['price', 'POST', '/goals/3/price', { target: 50 }],
    ['decline', 'POST', '/goals/3/decline', undefined],
    ['fulfill', 'POST', '/goals/3/fulfill', undefined],
    ['chip-in', 'POST', '/goals/3/chip-in', { amount: 5 }],
    ['delete', 'DELETE', '/goals/3', undefined],
    ['patch', 'PATCH', '/goals/3', { name: 'x' }],
  ] as const)('useGoalAction %s', async (action, method, url, body) => {
    const { result } = renderHook(() => useGoalAction(), { wrapper: wrap })
    await act(() => result.current.mutateAsync({ id: 3, action, body }))
    expect(mockApi).toHaveBeenCalledWith(url, body ? { method, body } : { method })
  })

  test('useGoalAction invalidates goals and today', async () => {
    const spy = jest.spyOn(qc, 'invalidateQueries')
    const { result } = renderHook(() => useGoalAction(), { wrapper: wrap })
    await act(() => result.current.mutateAsync({ id: 3, action: 'fulfill' }))
    expect(spy).toHaveBeenCalledWith({ queryKey: ['goals'] })
    expect(spy).toHaveBeenCalledWith({ queryKey: ['today'] })
  })
})

describe('kid goal hooks', () => {
  test('useKidGoals GETs with kid token', async () => {
    const { result } = renderHook(() => useKidGoals(jest.fn()), { wrapper: wrap })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApi).toHaveBeenCalledWith('/kid/goals', { kid: true })
  })

  test('useKidGoals previews with asKid', async () => {
    const { result } = renderHook(() => useKidGoals(jest.fn()), { wrapper: wrapAs })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mockApi).toHaveBeenCalledWith('/kid/goals', { asKid: 5 })
  })

  test.each([
    ['suggest', 'POST', '/kid/goals/suggest', { name: 'Lego' }],
    ['start', 'POST', '/kid/goals/start', { kind: 'screen' }],
    ['add', 'POST', '/kid/goals/4/add', { amount: 5 }],
    ['withdraw', 'POST', '/kid/goals/4/withdraw', { amount: 5 }],
    ['auto', 'POST', '/kid/goals/4/auto', undefined],
    ['delete', 'DELETE', '/kid/goals/4', undefined],
    ['party-seen', 'POST', '/kid/goals/4/party-seen', undefined],
  ] as const)('useKidGoalAction %s', async (action, method, url, body) => {
    const { result } = renderHook(() => useKidGoalAction(jest.fn()), { wrapper: wrap })
    await act(() => result.current.mutateAsync({ id: 4, action, body } as never))
    expect(mockApi).toHaveBeenCalledWith(url, body ? { method, body, kid: true } : { method, kid: true })
  })

  test('useKidGoalAction is blocked in preview', async () => {
    const { result } = renderHook(() => useKidGoalAction(jest.fn()), { wrapper: wrapAs })
    await act(() => result.current.mutateAsync({ id: 4, action: 'add', body: { amount: 1 } }).catch(() => null))
    expect(mockApi).not.toHaveBeenCalled()
  })
})
