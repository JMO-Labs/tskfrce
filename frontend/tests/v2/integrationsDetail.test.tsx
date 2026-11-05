import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { IntegrationDetail } from '@/v2/integrations/IntegrationDetail'
import type { InstallDetail } from '@/v2/integrations/types'
import { NeedsYouList } from '@/v2/today/NeedsYouList'

jest.mock('@/v2/api', () => ({ api: jest.fn(), errorText: (e: Error) => e.message }))
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }))
const apiMock = api as unknown as Mock<(p: string, i?: unknown) => Promise<unknown>>

const base: InstallDetail = {
  id: 7, source: 'registry', integration_id: 'demo', name: 'Demo', icon: 'extension', status: 'active', paused_reason: null,
  trusted: false, kid_ids: [3], created_at: '2026-11-01T00:00:00Z', developer: 'Acme', domain: 'demo.example.com',
  permissions: [{ id: 'chores.complete', text: 'Check off chores', high_risk: false }],
  kids: [{ id: 3, name: 'Sam', kid_widgets: false }], chores: [{ id: 4, title: 'Dishes' }], settings: {},
}
const wrap = (ui: React.ReactNode) =>
  render(<MantineProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider></MantineProvider>)
const serve = (d: Partial<InstallDetail> = {}) =>
  apiMock.mockReset().mockImplementation(async (p: string) => {
    if (p === '/integrations/7') return { ...base, ...d }
    if (p === '/integrations/7/log') return [{ kind: 'chore.complete', result: 'rejected', reason: 'Not linked', kid_name: 'Sam', chore_title: 'Dishes', created_at: '2026-11-02T10:00:00Z' }]
    return {}
  })

beforeEach(() => serve())

describe('IntegrationDetail', () => {
  test('header, linked kids and log', async () => {
    wrap(<IntegrationDetail id={7} onClose={() => {}} />)
    expect(await screen.findByText('By Acme')).toBeInTheDocument()
    expect(screen.getByText('Data goes to: demo.example.com')).toBeInTheDocument()
    expect(screen.getByText('Sam')).toBeInTheDocument()
    expect(await screen.findByText('Rejected')).toBeInTheDocument()
    expect(screen.getByText(/Not linked/)).toBeInTheDocument()
  })

  test('trust switch shows the consequence line and PATCHes', async () => {
    const user = userEvent.setup()
    wrap(<IntegrationDetail id={7} onClose={() => {}} />)
    expect(await screen.findByText('Its chore check-offs wait in Needs you.')).toBeInTheDocument()
    await user.click(screen.getByRole('switch', { name: 'Trust automatically' }))
    expect(screen.getByText('Its chore check-offs will count right away, without your OK. Finished chores can unlock devices.')).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith('/integrations/7', expect.objectContaining({ method: 'PATCH', body: { trusted: true } }))
  })

  test('paused integration offers Try again', async () => {
    serve({ status: 'paused', paused_reason: 'Too many errors' })
    const user = userEvent.setup()
    wrap(<IntegrationDetail id={7} onClose={() => {}} />)
    expect(await screen.findByText('Paused: Too many errors')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(apiMock).toHaveBeenCalledWith('/integrations/7', expect.objectContaining({ body: { resume: true } }))
  })

  test('revoked shows the banner and no trust switch', async () => {
    serve({ status: 'revoked' })
    wrap(<IntegrationDetail id={7} onClose={() => {}} />)
    expect(await screen.findByText('t@sk4ce turned this one off.')).toBeInTheDocument()
    expect(screen.queryByRole('switch')).toBeNull()
  })

  test('remove asks first, says history stays, then DELETEs', async () => {
    const user = userEvent.setup()
    const onClose = jest.fn()
    wrap(<IntegrationDetail id={7} onClose={onClose} />)
    await user.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(apiMock).not.toHaveBeenCalledWith('/integrations/7', expect.objectContaining({ method: 'DELETE' }))
    expect(await screen.findByText('Remove Demo? It stops right away. Its rewards and cards go away. Its history stays.')).toBeInTheDocument()
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Remove' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/integrations/7', expect.objectContaining({ method: 'DELETE' })))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})

describe('Needs you', () => {
  test('row names the integration and offers chore buttons', () => {
    wrap(
      <NeedsYouList items={[{ type: 'integration', id: 9, kid_id: 3, kid_name: 'Sam', title: 'Dishes', integration: { id: 7, name: 'Demo', icon: 'extension' } }]} />,
    )
    expect(screen.getByText('via Demo')).toBeInTheDocument()
    expect(screen.getByText('From an integration')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Send back/ })).toBeInTheDocument()
  })
})
