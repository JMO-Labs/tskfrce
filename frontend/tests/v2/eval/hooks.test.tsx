import { ReactNode } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { api, AuthError } from '@/v2/api'
import { track } from '@/v2/eval/track'
import { useWizardTelemetry } from '@/v2/eval/useWizardTelemetry'
import { useFormAbandon } from '@/v2/eval/useFormAbandon'
import { routePattern } from '@/v2/eval/useScreenViews'
import { useEvalStatus } from '@/v2/eval/useEvalStatus'
import * as qc from '@/v2/queryClient'

jest.mock('@/v2/eval/track')
jest.mock('@/v2/api', () => ({ ...jest.requireActual('@/v2/api'), api: jest.fn() }))

const t = track as jest.Mock
beforeEach(() => t.mockClear())

function wizard(steps: number[]) {
  const h = renderHook(({ s }) => useWizardTelemetry(s, 7), { initialProps: { s: steps[0] } })
  steps.slice(1).forEach((s) => h.rerender({ s }))
}

test('wizard steps', () => {
  wizard([1, 2, 3, 2, 3, 4])
  expect(t.mock.calls).toEqual([
    ['wizard_step', { step: 1, state: 'started' }],
    ['wizard_step', { step: 1, state: 'done' }],
    ['wizard_step', { step: 2, state: 'started' }],
    ['wizard_step', { step: 2, state: 'done' }],
    ['wizard_step', { step: 3, state: 'started' }],
    ['wizard_step', { step: 3, state: 'done' }],
    ['wizard_step', { step: 4, state: 'started' }],
  ])
})

test('wizard done', () => {
  wizard([7, 8])
  expect(t.mock.calls).toEqual([
    ['wizard_step', { step: 7, state: 'started' }],
    ['wizard_step', { step: 7, state: 'done' }],
    ['wizard_done', {}],
  ])
})

function abandon(run: (h: ReturnType<typeof renderHook<() => void, { d: boolean }>>) => void, d = false) {
  const h = renderHook(({ d }) => useFormAbandon('kid', d), { initialProps: { d } })
  run(h as never)
}

test('abandon: dirty then unmount', () => {
  abandon((h) => { h.rerender({ d: true }); h.unmount() })
  expect(t.mock.calls).toEqual([['form_abandoned', { form: 'kid' }]])
})
test('abandon: saved then unmount', () => {
  abandon((h) => { h.rerender({ d: true }); h.result.current(); h.unmount() })
  expect(t).not.toHaveBeenCalled()
})
test('abandon: dirty to clean unsaved', () => {
  abandon((h) => { h.rerender({ d: true }); h.rerender({ d: false }) })
  expect(t).toHaveBeenCalledTimes(1)
})
test('abandon: saved then clean', () => {
  abandon((h) => { h.rerender({ d: true }); h.result.current(); h.rerender({ d: false }) })
  expect(t).not.toHaveBeenCalled()
})
test('abandon: never dirty', () => {
  abandon((h) => { h.rerender({ d: false }); h.unmount() })
  expect(t).not.toHaveBeenCalled()
})

test('routePattern', () => {
  expect(routePattern('/[...slug]')).toBe('/404')
  expect(routePattern('/kid')).toBe('/kid')
})

test('status never throws', async () => {
  (api as jest.Mock).mockRejectedValue(new AuthError('no'))
  const client = qc.makeQueryClient()
  const wrap = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const { result } = renderHook(() => useEvalStatus(), { wrapper: wrap })
  await waitFor(() => expect(result.current.data).toEqual({ stats: false, feedback: false, household: null }))
  expect(result.current.isError).toBe(false)
})
