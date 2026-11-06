import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { LocalKeyForm } from '@/v2/integrations/LocalKeyForm'

jest.mock('@/v2/api', () => ({ api: jest.fn(), errorText: (e: Error) => e.message }))
const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>

const CHORES = 'Mark linked chores done (it sees their names)'
const DECIDE = 'Approve or deny reward requests and chore check-offs'
const perms = [
  { id: 'chores.complete', text: CHORES, high_risk: false },
  { id: 'rewards.manage', text: 'Manage rewards', high_risk: false },
  { id: 'messages.parents', text: 'Message you', high_risk: false },
  { id: 'requests.decide', text: DECIDE, high_risk: true },
]
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
const wrap = (ui: React.ReactNode) => render(<MantineProvider><QueryClientProvider client={qc}>{ui}</QueryClientProvider></MantineProvider>)

beforeEach(() => {
  qc.clear()
  apiMock.mockReset().mockImplementation(async (p) => {
    if (p === '/integration-local/permissions') return perms
    if (p === '/kids') return [{ id: 3, full_name: 'Sam', username: 'sam', avatar: null, has_pin: false, age_group: 'kid' }]
    if (p === '/chores/') return [{ id: 7, title: 'Dishes' }]
    if (p === '/integration-local/keys') return { id: 9, token: 'tsk_local_abc' }
    return {}
  })
})

describe('local keys', () => {
  test('shows the token once after create, never caches it', async () => {
    const u = userEvent.setup()
    wrap(<LocalKeyForm onDone={() => {}} />)
    await u.type(screen.getByLabelText(/Name/), 'Home Assistant')
    await u.click(await screen.findByLabelText(CHORES))
    await u.click(await screen.findByLabelText('Sam'))
    await u.click(screen.getByLabelText('Dishes'))
    await u.click(screen.getByRole('button', { name: 'Create key' }))
    expect(await screen.findByDisplayValue('tsk_local_abc')).toBeInTheDocument()
    expect(screen.getByText("Copy this now. You won't see it again.")).toBeInTheDocument()
    expect(screen.getAllByText(/Bearer tsk_local_abc/, { selector: 'pre' })).toHaveLength(2)
    expect(screen.getAllByText(/"kid_id":3,"chore_id":7,"idempotency_key"/, { selector: 'pre' })).toHaveLength(2)
    expect(apiMock).toHaveBeenCalledWith('/integration-local/keys', expect.objectContaining({
      method: 'POST',
      body: { name: 'Home Assistant', permissions: ['chores.complete'], kid_ids: [3], chore_ids: [7], trusted: false },
    }))
    expect(JSON.stringify(qc.getQueryCache().getAll().map((q) => q.state.data))).not.toContain('tsk_local_abc')
    expect(JSON.stringify(qc.getMutationCache().getAll().map((m) => m.state.data))).not.toContain('tsk_local_abc')
  })

  test('offers only the four local permissions, as served by the box', async () => {
    wrap(<LocalKeyForm onDone={() => {}} />)
    expect(await screen.findByLabelText(DECIDE)).toBeInTheDocument()
    expect(screen.queryByLabelText("Show cards on your kids' screens")).toBeNull()
    expect(screen.getAllByRole('checkbox', { name: /./ }).filter((c) => c.closest('.ig-perm'))).toHaveLength(4)
    expect(screen.getByLabelText(DECIDE).closest('[data-risk]')).toHaveAttribute('data-risk', 'high')
  })

  test('Create stays off until name, a permission and a kid are set', async () => {
    const u = userEvent.setup()
    wrap(<LocalKeyForm onDone={() => {}} />)
    const btn = screen.getByRole('button', { name: 'Create key' })
    expect(btn).toBeDisabled()
    await u.type(screen.getByLabelText(/Name/), 'HA')
    await u.click(await screen.findByLabelText('Manage rewards'))
    expect(btn).toBeDisabled()
    await u.click(await screen.findByLabelText('Sam'))
    expect(btn).toBeEnabled()
  })
})
