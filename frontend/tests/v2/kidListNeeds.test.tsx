import { expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { KidList } from '@/v2/today/KidList'

jest.mock('@/v2/api', () => ({ api: jest.fn(), kidToken: () => null }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('next/router', () => ({ useRouter: () => ({ query: {}, push: jest.fn() }) }))
const apiMock = api as unknown as Mock<(p: string) => Promise<unknown>>

test('Needs tab labels a waiting chore from an older day', async () => {
  apiMock.mockResolvedValue({
    day: '2026-11-06',
    kids: [],
    needs_you: [{ type: 'chore', id: 1, kid_id: 1, kid_name: 'Leo', title: 'Take out bins', attempt: 1, day: '2026-11-04', submitted_at: '2026-11-04T20:00:00Z' }],
  })
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>
        <KidList onSelectKid={() => {}} />
      </MantineProvider>
    </QueryClientProvider>,
  )
  await userEvent.click(await screen.findByRole('tab', { name: /Needs you · 1/ }))
  expect(await screen.findByText(/wednesday/i)).toBeInTheDocument()
})
