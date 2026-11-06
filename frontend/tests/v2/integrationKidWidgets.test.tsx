import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { IntegrationDetail } from '@/v2/integrations/IntegrationDetail'
import type { InstallDetail, WidgetGroup } from '@/v2/integrations/types'
import { MePage } from '@/v2/kid/MePage'

jest.mock('@/v2/api', () => ({ api: jest.fn(), errorText: (e: Error) => e.message }))
jest.mock('@/v2/notify', () => ({ toastOk: jest.fn(), toastFail: jest.fn() }))
jest.mock('@/v2/today/PhotoViewer', () => ({ useAuthImage: (p: string) => (p ? 'blob:x' : null) }))
jest.mock('@/v2/kid/FamilySection', () => ({ FamilySection: () => null }))
const apiMock = api as unknown as Mock<(p: string, i?: unknown) => Promise<unknown>>

const perm = { id: 'widgets.kid', text: 'Show cards to kids', high_risk: false }
const base: InstallDetail = {
  id: 7, source: 'registry', integration_id: 'demo', name: 'Demo', icon: 'extension', status: 'active', paused_reason: null,
  trusted: false, kid_ids: [3, 4], created_at: '2026-11-01T00:00:00Z', developer: 'Acme', domain: 'demo.example.com',
  permissions: [perm], kids: [{ id: 3, name: 'Sam', kid_widgets: true }, { id: 4, name: 'Mia', kid_widgets: false }], chores: [], settings: {},
}
const group: WidgetGroup = {
  install_id: 7, name: 'Demo', icon: 'extension',
  widgets: [{ id: 'k', root: { type: 'card', title: 'Reading', children: [{ type: 'button', id: 'ask', label: 'Tell mom I read', action: 'message.parents' }] } }],
}
const wrap = (ui: React.ReactNode) =>
  render(<MantineProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider></MantineProvider>)
const serve = (d: Partial<InstallDetail> = {}) =>
  apiMock.mockReset().mockImplementation(async (p: string) => {
    if (p === '/integrations/7') return { ...base, ...d }
    if (p === '/integrations/7/log') return []
    if (p === '/integration-widgets/kid') return [group]
    return {}
  })

beforeEach(() => serve())

describe('kid cards opt-in', () => {
  test('detail shows a per-kid card switch only with widgets.kid', async () => {
    wrap(<IntegrationDetail id={7} onClose={() => {}} />)
    expect(await screen.findByRole('switch', { name: "Show cards on Sam's screens" })).toBeChecked()
    expect(screen.getByRole('switch', { name: "Show cards on Mia's screens" })).not.toBeChecked()
    expect(screen.getByText(/only ask you/)).toBeInTheDocument()
  })
  test('no switch without the grant', async () => {
    serve({ permissions: [] })
    wrap(<IntegrationDetail id={7} onClose={() => {}} />)
    await screen.findByText('By Acme')
    expect(screen.queryByRole('switch', { name: /Show cards/ })).toBeNull()
  })
  test('turning one on sends the full kid list', async () => {
    wrap(<IntegrationDetail id={7} onClose={() => {}} />)
    await userEvent.click(await screen.findByRole('switch', { name: "Show cards on Mia's screens" }))
    expect(apiMock).toHaveBeenCalledWith('/integrations/7', expect.objectContaining({ method: 'PATCH', body: { kid_widget_ids: [3, 4] } }))
  })
  test('kid Me page renders framed kid cards that ask', async () => {
    wrap(<MePage name="Sam" avatar={null} preview={false} onLocker={() => {}} canSwitch={false} onExit={() => {}} kidId={3} />)
    const frame = await screen.findByRole('region', { name: 'Demo integration' })
    expect(within(frame).getByText('Demo')).toBeInTheDocument()
    expect(within(frame).getByText('Integration')).toBeInTheDocument()
    expect(within(frame).getByRole('button', { name: /Ask.*Tell mom I read/ })).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledWith('/integration-widgets/kid', { kid: true })
  })
  test('preview does not fetch kid cards', () => {
    wrap(<MePage name="Sam" avatar={null} preview onLocker={() => {}} canSwitch={false} onExit={() => {}} kidId={3} />)
    expect(apiMock).not.toHaveBeenCalled()
  })
})
