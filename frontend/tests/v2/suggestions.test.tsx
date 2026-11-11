import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { SuggestionsCard } from '@/v2/today/SuggestionsCard'
import { AppearancePane } from '@/v2/manage/AppearancePane'
import type { Family } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications')

type Init = { method?: string; body?: unknown }
const apiMock = api as unknown as Mock<(p: string, o?: Init) => Promise<unknown>>
const item = (rule: string, o: Record<string, unknown> = {}) => ({
  key: `${rule}:1`,
  rule,
  tier: 2,
  fingerprint: 'fp1',
  at: '2026-11-11T10:00:00Z',
  title: 'Invite another parent',
  body: 'Only one parent can approve chores right now.',
  action: { kind: 'link', label: 'Invite parent', to: '/settings' },
  ...o,
})
let s: { hidden: boolean; items: unknown[] }

beforeEach(() => {
  s = { hidden: false, items: [item('family.parent')] }
  apiMock.mockReset()
  apiMock.mockImplementation(async (p) => (p === '/suggestions' ? s : {}))
})

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test">{ui}</MantineProvider>
    </QueryClientProvider>,
  )
const sent = (p: string, method: string, body?: unknown) =>
  apiMock.mock.calls.some(([path, o]) => path === p && o?.method === method && (body === undefined || JSON.stringify(o.body) === JSON.stringify(body)))

describe('SuggestionsCard', () => {
  test('shows title, real-subject body and the action', async () => {
    wrap(<SuggestionsCard />)
    expect(await screen.findByText('Invite another parent')).toBeInTheDocument()
    expect(screen.getByText(/approve chores/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Invite parent' })).toHaveAttribute('href', '/settings')
  })

  test('Dismiss posts key and fingerprint', async () => {
    wrap(<SuggestionsCard />)
    await userEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(sent('/suggestions/dismiss', 'POST', { key: 'family.parent:1', fingerprint: 'fp1' })).toBe(true))
  })

  test('Not for us mutes the rule', async () => {
    wrap(<SuggestionsCard />)
    await userEvent.click(await screen.findByRole('button', { name: 'Not for us' }))
    await waitFor(() => expect(sent('/suggestions/mute', 'POST', { rule: 'family.parent' })).toBe(true))
  })

  test('system suggestions cannot be muted', async () => {
    s.items = [item('devices.unknown', { tier: 0, title: 'New devices' })]
    wrap(<SuggestionsCard />)
    expect(await screen.findByText('New devices')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Not for us' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })

  test('section menu Hide posts hide', async () => {
    wrap(<SuggestionsCard />)
    await userEvent.click(await screen.findByRole('button', { name: 'More for Suggestions' }))
    await userEvent.click(await screen.findByText('Hide suggestions'))
    await waitFor(() => expect(sent('/suggestions/hide', 'POST')).toBe(true))
  })

  test('renders nothing when hidden or empty', async () => {
    s = { hidden: true, items: [] }
    const { container } = wrap(<SuggestionsCard />)
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p === '/suggestions')).toBe(true))
    expect(container.querySelector('.pt-sugg')).toBeNull()
  })
})

describe('Settings suggestions', () => {
  const fam = { accent: 'neon' } as Family

  test('toggle shows suggestions again when hidden', async () => {
    s = { hidden: true, items: [] }
    wrap(<AppearancePane current={fam} onChange={jest.fn()} />)
    const sw = await screen.findByRole('switch', { name: 'Show suggestions on Today' })
    await waitFor(() => expect(sw).not.toBeChecked())
    await userEvent.click(sw)
    await waitFor(() => expect(sent('/suggestions/hide', 'DELETE')).toBe(true))
  })

  test('toggle off hides', async () => {
    wrap(<AppearancePane current={fam} onChange={jest.fn()} />)
    const sw = await screen.findByRole('switch', { name: 'Show suggestions on Today' })
    await waitFor(() => expect(sw).toBeChecked())
    await userEvent.click(sw)
    await waitFor(() => expect(sent('/suggestions/hide', 'POST')).toBe(true))
  })

  test('Reset muted suggestions', async () => {
    wrap(<AppearancePane current={fam} onChange={jest.fn()} />)
    await userEvent.click(screen.getByRole('button', { name: 'Reset muted suggestions' }))
    await waitFor(() => expect(sent('/suggestions/muted', 'DELETE')).toBe(true))
  })
})
