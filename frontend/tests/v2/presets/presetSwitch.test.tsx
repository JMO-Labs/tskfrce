import { beforeEach, describe, expect, test } from '@jest/globals'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PresetSwitch } from '@/v2/presets/PresetSwitch'

;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
type Call = (path: string, opts?: { method?: string; body?: unknown }) => Promise<unknown>
const mockApi = jest.fn() as unknown as jest.Mock<ReturnType<Call>, Parameters<Call>>
jest.mock('@/v2/api', () => ({ api: (p: string, o?: { method?: string; body?: unknown }) => mockApi(p, o) }))
const mockToast = jest.fn()
jest.mock('@/v2/notify', () => ({ toastOk: (m: string) => mockToast(m), toastFail: jest.fn() }))

const catalog = { style: 'balanced', kids: [{ id: 3, name: 'Ivy', age_group: 'kid', style: null }], plans: {}, family: {} }
const preview = {
  style: 'strict', kids: [],
  changes: [{ kid_id: 3, who: 'Ivy', key: 'screen', now: 120, next: 60 }, { kid_id: null, who: null, key: 'banked', now: true, next: false }],
  kept: [{ kid_id: 3, who: 'Ivy', key: 'bedtime', now: '21:15', next: '20:00' }, { kid_id: 3, who: 'Ivy', key: 'chores', now: ['a', 'b', 'c', 'd', 'e'], next: ['a', 'b', 'c'] }],
}
const setup = (kidId?: number, prev: unknown = preview) => {
  mockApi.mockImplementation(async (p) => (p === '/presets' ? catalog : p === '/presets/preview' ? prev : { ...preview }))
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(<QueryClientProvider client={qc}><MantineProvider><PresetSwitch kidId={kidId} /></MantineProvider></QueryClientProvider>)
}
const calls = (path: string) => mockApi.mock.calls.filter((c) => c[0] === path)

describe('PresetSwitch', () => {
  beforeEach(() => { mockApi.mockReset(); mockToast.mockReset() })

  test('family: no preview until picked, then summary, table and apply', async () => {
    setup()
    expect(await screen.findByText('Family style')).toBeInTheDocument()
    expect(calls('/presets/preview')).toHaveLength(0)
    await userEvent.click(await screen.findByText('Strict'))
    expect(await screen.findByText(/Changes 2 settings/)).toBeInTheDocument()
    expect(screen.getByText(/Keeps your 2 edits \(Ivy's bedtime, 2 chores you added\)/)).toBeInTheDocument()
    expect(screen.getByText('Screen time (Ivy)')).toBeInTheDocument()
    expect(calls('/presets/preview')[0][1]?.body).toEqual({ style: 'strict' })
    await userEvent.click(screen.getByRole('button', { name: 'Switch to Strict' }))
    await waitFor(() => expect(calls('/presets/apply')[0][1]?.body).toEqual({ style: 'strict' }))
    await waitFor(() => expect(mockToast).toHaveBeenCalledWith('Switched to Strict'))
  })

  test('kid: title Style and apply body is kids map', async () => {
    setup(3)
    expect(await screen.findByText('Style')).toBeInTheDocument()
    await userEvent.click(await screen.findByText('Relaxed'))
    await userEvent.click(await screen.findByRole('button', { name: 'Switch to Relaxed' }))
    await waitFor(() => expect(calls('/presets/apply')[0][1]?.body).toEqual({ kids: { '3': 'relaxed' } }))
  })

  test('zero changes says nothing to change, button still there', async () => {
    setup(undefined, { style: 'strict', kids: [], changes: [], kept: [] })
    await userEvent.click(await screen.findByText('Strict'))
    expect(await screen.findByText('Nothing to change.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to Strict' })).toBeInTheDocument()
  })
})
