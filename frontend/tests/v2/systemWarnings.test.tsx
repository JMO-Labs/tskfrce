import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { SystemWarnings } from '@/v2/today/SystemWarnings'
import { SuggestionsCard } from '@/v2/today/SuggestionsCard'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications')

const apiMock = api as unknown as Mock<(p: string, o?: unknown) => Promise<unknown>>
const warn = (key: string, title: string) => ({ key, title, body: `${title} body`, action: { label: 'Fix it', to: '/devices' } })
let warnings: unknown[]
let sugg: { hidden: boolean; items: unknown[] }

beforeEach(() => {
  warnings = []
  sugg = { hidden: false, items: [] }
  apiMock.mockReset()
  apiMock.mockImplementation(async (p) => (p === '/system/warnings' ? { items: warnings } : p === '/suggestions' ? sugg : {}))
})

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider env="test">{ui}</MantineProvider>
    </QueryClientProvider>,
  )

describe('SystemWarnings', () => {
  test('renders nothing when the box is fine', async () => {
    wrap(<SystemWarnings />)
    await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p === '/system/warnings')).toBe(true))
    await act(async () => {})
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('shows each warning with a plain explanation and a fix action', async () => {
    warnings = [warn('blocker.down', 'Kid limits are off'), warn('storage.full', 'Almost out of space')]
    wrap(<SystemWarnings />)
    expect(await screen.findByText('Kid limits are off')).toBeInTheDocument()
    expect(screen.getByText('Almost out of space body')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Fix it' })[0]).toHaveAttribute('href', '/devices')
  })

  test('cannot be dismissed or hidden', async () => {
    warnings = [warn('blocker.down', 'Kid limits are off')]
    wrap(<SystemWarnings />)
    await screen.findByText('Kid limits are off')
    expect(screen.queryByRole('button')).toBeNull()
  })

  test('is unaffected by hiding suggestions', async () => {
    warnings = [warn('wifi.down', 'The box is offline')]
    sugg = { hidden: true, items: [] }
    wrap(
      <>
        <SystemWarnings />
        <SuggestionsCard />
      </>,
    )
    expect(await screen.findByText('The box is offline')).toBeInTheDocument()
    expect(screen.queryByLabelText('Suggestions')).toBeNull()
    expect(apiMock.mock.calls.some(([p]) => p === '/system/warnings')).toBe(true)
  })
})
