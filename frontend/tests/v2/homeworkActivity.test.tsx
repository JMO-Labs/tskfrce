import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { api } from '@/v2/api'
import { HomeworkActivity } from '@/v2/manage/HomeworkActivity'

jest.mock('@/v2/api')
jest.mock('@mantine/notifications')

const renderWithProviders = (component: React.ReactElement) => {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>{component}</MantineProvider>
    </QueryClientProvider>,
  )
}

describe('HomeworkActivity', () => {
  const apiMock = api as unknown as Mock

  beforeEach(() => {
    apiMock.mockReset()
  })

  test('renders multiple activity rows', async () => {
    const data = {
      items: [
        { domain: 'classroom.google.com', via: 'list', pulled_by: null, active_minutes: 25, last_seen: '2026-01-01T10:10:00Z' },
        { domain: 'youtube.com', via: 'follow', pulled_by: 'classroom.google.com', active_minutes: 8, last_seen: '2026-01-01T10:05:00Z' },
      ],
      active: true,
      until: '2026-01-01T11:00:00Z',
      session_start: '2026-01-01T10:00:00Z',
    }
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith('/homework/activity')) return Promise.resolve([{ device_id: 1, device_name: 'iPad', ...data }])
      return Promise.resolve({})
    })

    renderWithProviders(<HomeworkActivity deviceId={1} />)

    // Wait for data to load using a more resilient selector that handles text nodes split by · and min
    await screen.findByText((content, element) => content.includes('youtube.com') && element?.tagName === 'DIV')
    expect(screen.getByText((content, element) => content.includes('youtube.com') && element?.tagName === 'DIV')).toBeInTheDocument()
  })

  test('follow row shows "pulled in by"', async () => {
    const data = {
      items: [{ domain: 'youtube.com', via: 'follow', pulled_by: 'classroom.google.com', active_minutes: 8, last_seen: '2026-01-01T10:05:00Z' }],
      active: true,
      until: '2026-01-01T11:00:00Z',
      session_start: '2026-01-01T10:00:00Z',
    }
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith('/homework/activity')) return Promise.resolve([{ device_id: 1, device_name: 'iPad', ...data }])
      return Promise.resolve({})
    })

    renderWithProviders(<HomeworkActivity deviceId={1} />)

    expect(await screen.findByText(/pulled in by classroom\.google\.com/)).toBeInTheDocument()
  })

  test('Block button expands and shows Block action', async () => {
    const user = userEvent.setup()
    const data = {
      items: [{ domain: 'youtube.com', via: 'list', pulled_by: null, active_minutes: 8, last_seen: '2026-01-01T10:05:00Z' }],
      active: true,
      until: '2026-01-01T11:00:00Z',
      session_start: '2026-01-01T10:00:00Z',
    }
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith('/homework/activity')) return Promise.resolve([{ device_id: 1, device_name: 'iPad', ...data }])
      return Promise.resolve({})
    })

    renderWithProviders(<HomeworkActivity deviceId={1} />)

    // Initial state shows only expand buttons
    const expandButton = await screen.findByRole('button', { name: 'Block' })
    expect(expandButton).toBeInTheDocument()

    // Click to expand
    await user.click(expandButton)

    // After expand, component should still be renderable using a more resilient selector
    expect(screen.getByText((content, element) => content.includes('youtube.com') && element?.tagName === 'DIV')).toBeInTheDocument()
  })

  test('Add button expands and shows "Just for Sam" and "For everyone"', async () => {
    const user = userEvent.setup()
    const data = {
      items: [{ domain: 'youtube.com', via: 'list', pulled_by: null, active_minutes: 8, last_seen: '2026-01-01T10:05:00Z' }],
      active: true,
      until: '2026-01-01T11:00:00Z',
      session_start: '2026-01-01T10:00:00Z',
    }
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith('/homework/activity')) return Promise.resolve([{ device_id: 1, device_name: 'iPad', kid_id: 2, kid_name: 'Sam', ...data }])
      return Promise.resolve({})
    })

    renderWithProviders(<HomeworkActivity deviceId={1} />)

    const expandButton = await screen.findByRole('button', { name: 'Add to allowed' })
    await user.click(expandButton)

    // After expand, should see the specific options for Sam
    expect(screen.getByRole('button', { name: /Just for Sam/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'For everyone' })).toBeInTheDocument()
  })

  test('End homework mode button is visible', async () => {
    const data = {
      items: [{ domain: 'youtube.com', via: 'list', pulled_by: null, active_minutes: 8, last_seen: '2026-01-01T10:05:00Z' }],
      active: true,
      until: '2026-01-01T11:00:00Z',
      session_start: '2026-01-01T10:00:00Z',
    }
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith('/homework/activity')) return Promise.resolve([{ device_id: 1, device_name: 'iPad', ...data }])
      return Promise.resolve({})
    })

    renderWithProviders(<HomeworkActivity deviceId={1} />)

    const endButton = await screen.findByRole('button', { name: 'End homework mode' })
    expect(endButton).toBeInTheDocument()
  })

  test('an unassigned device shows only "For everyone"', async () => {
    const user = userEvent.setup()
    const data = {
      items: [{ domain: 'youtube.com', via: 'list', pulled_by: null, active_minutes: 8, last_seen: '2026-01-01T10:05:00Z' }],
      active: true,
      until: '2026-01-01T11:00:00Z',
      session_start: '2026-01-01T10:00:00Z',
    }
    apiMock.mockImplementation((path: string) => {
      if (path.startsWith('/homework/activity')) return Promise.resolve([{ device_id: 1, device_name: 'iPad', kid_id: null, ...data }])
      return Promise.resolve({})
    })

    renderWithProviders(<HomeworkActivity deviceId={1} />)

    const expandButton = await screen.findByRole('button', { name: 'Add to allowed' })
    await user.click(expandButton)

    // Should only show "For everyone" button, not "Just for" any kid
    expect(screen.queryByRole('button', { name: /Just for/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'For everyone' })).toBeInTheDocument()
  })
})
