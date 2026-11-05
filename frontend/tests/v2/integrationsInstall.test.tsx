import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { InstallFlow } from '@/v2/integrations/InstallFlow'
import { PermissionList } from '@/v2/integrations/PermissionList'
import type { CatalogItem } from '@/v2/integrations/types'
import { SETTINGS_SECTIONS } from '@/v2/manage/settingsSections'

jest.mock('@/v2/api', () => ({ api: jest.fn(), errorText: (e: Error) => e.message }))
const apiMock = api as unknown as Mock<(p: string, i?: unknown) => Promise<unknown>>

const item: CatalogItem = {
  id: 'svc', name: 'Svc', developer: 'Acme', description: 'd', icon: 'extension', version: '1', domain: 'svc.example.com',
  settings: [{ key: 'key', label: 'API key', type: 'text', options: [], secret: true, required: true }],
  permissions: [
    { id: 'chores.complete', text: 'Check off chores', high_risk: false },
    { id: 'requests.decide', text: 'Approve or deny reward requests and chore check-offs', high_risk: true },
  ],
  widgets: [], installed: false,
}

const wrap = (ui: React.ReactNode) =>
  render(<MantineProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider></MantineProvider>)

beforeEach(() => {
  apiMock.mockReset().mockImplementation(async (p: string) => {
    if (p === '/kids') return [{ id: 3, full_name: 'Sam', username: 'sam', avatar: null, has_pin: false, age_group: 'kid' }]
    if (p === '/chores/') return [{ id: 7, title: 'Dishes' }]
    return {}
  })
})

describe('integrations install', () => {
  test('marks high-risk permissions in red with a label', () => {
    wrap(<PermissionList perms={item.permissions} />)
    const row = screen.getByText(/Approve or deny/).closest('[data-risk]')
    expect(row).toHaveAttribute('data-risk', 'high')
    expect(within(row as HTMLElement).getByText('High risk')).toBeInTheDocument()
  })

  test('secret settings are password inputs', () => {
    wrap(<InstallFlow item={item} onDone={() => {}} />)
    expect(screen.getByLabelText(/API key/)).toHaveAttribute('type', 'password')
  })

  test('Connect needs a kid and sends the exact permissions', async () => {
    const u = userEvent.setup()
    wrap(<InstallFlow item={item} onDone={() => {}} />)
    await u.type(screen.getByLabelText(/API key/), 'abc')
    await u.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    await u.click(await screen.findByLabelText('Sam'))
    await u.click(await screen.findByLabelText('Dishes'))
    await u.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByText('Talks to svc.example.com')).toBeInTheDocument()
    await u.click(screen.getByRole('button', { name: /connect/i }))
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/integrations', expect.objectContaining({
        method: 'POST',
        body: expect.objectContaining({ kid_ids: [3], chore_ids: [7], accepted_permissions: ['chores.complete', 'requests.decide'] }),
      })),
    )
  })

  test('settings list has an Integrations section', () => {
    expect(SETTINGS_SECTIONS.map((s) => s.id)).toContain('integrations')
  })
})
