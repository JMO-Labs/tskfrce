import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { UpdatesPane } from '@/v2/manage/UpdatesPane'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const apiMock = api as unknown as Mock

const show = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  )

const mockUpdates = {
  version: '2.13.0',
  channel: 'stable',
  last_result: 'success',
  last_version: '2.13.0',
  major_available: '3',
}

const mockUpdatesBeta = {
  version: '2.14.0-beta',
  channel: 'eval',
  last_result: 'success',
  last_version: '2.14.0-beta',
  major_available: null,
}

beforeEach(() => {
  apiMock.mockReset().mockImplementation((path, init) =>
    path === '/updates' && !init?.method
      ? Promise.resolve(mockUpdates)
      : path === '/updates' && init?.method === 'PATCH'
        ? Promise.resolve({ ...mockUpdates, ...init.body })
        : Promise.reject(new Error('Not found')),
  )
})

describe('UpdatesPane', () => {
  test('renders version, auto-update, last result, and major available', async () => {
    show(<UpdatesPane />)
    expect(await screen.findByText('2.13.0')).toBeInTheDocument()
    expect(screen.getByText('Nightly checks')).toBeInTheDocument()
    expect(screen.getByText('Updated to 2.13.0')).toBeInTheDocument()
    expect(screen.getByText('Success')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Version 3 available/ })).toBeInTheDocument()
  })

  test('beta box hides major version card and shows beta text', async () => {
    apiMock.mockImplementation(() => Promise.resolve(mockUpdatesBeta))
    show(<UpdatesPane />)
    expect(await screen.findByText('2.14.0-beta')).toBeInTheDocument()
    expect(screen.getByText('Beta releases')).toBeInTheDocument()
    expect(screen.queryByText(/Version.*available/)).not.toBeInTheDocument()
  })

  test('clicking auto-update sends PATCH', async () => {
    show(<UpdatesPane />)
    const toggle = await screen.findByRole('switch', { name: 'Toggle auto-update' })
    await userEvent.click(toggle)
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/updates', { method: 'PATCH', body: { channel: 'stable' } }),
    )
  })

  test('clicking major update button sends pull_major', async () => {
    show(<UpdatesPane />)
    const btn = await screen.findByRole('button', { name: /Version 3 available/ })
    await userEvent.click(btn)
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/updates', { method: 'PATCH', body: { pull_major: '3' } }),
    )
  })

  test('shows failed state with error color', async () => {
    apiMock.mockImplementation(() =>
      Promise.resolve({
        version: '2.12.0',
        channel: 'stable',
        last_result: 'failed',
        last_version: '2.13.0',
        major_available: null,
      }),
    )
    show(<UpdatesPane />)
    expect(await screen.findByText('Update to 2.13.0 failed, still on 2.12.0')).toBeInTheDocument()
    expect(screen.getByText('Failed')).toBeInTheDocument()
  })

  test('renders no emoji characters', async () => {
    show(<UpdatesPane />)
    await screen.findByText('2.13.0') // wait for render
    const paneElement = screen.getByText(/Nightly checks/).closest('.pn')
    const text = paneElement?.textContent || ''
    // Check for emoji using Unicode Extended Pictographic property
    const emojiRegex = /\p{Extended_Pictographic}/gu
    expect(text).not.toMatch(emojiRegex)
  })
})
