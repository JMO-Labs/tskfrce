import { beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { TodayPage } from '@/v2/today/TodayPage'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('@mantine/hooks', () => ({ ...jest.requireActual('@mantine/hooks'), useMediaQuery: () => true }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/contexts/UnifiedAuthContext', () => ({ useUnifiedAuth: () => ({ logout: jest.fn(), user: { id: 1 } }) }))
jest.mock('@/v2/chat/ChatDock', () => ({ ChatDock: () => null }))
jest.mock('@/v2/components/BlockerBanner', () => ({ BlockerBanner: () => null }))
jest.mock('@/v2/components/Bell', () => ({ Bell: () => null }))
jest.mock('@mantine/notifications')

const apiMock = api as unknown as Mock<(p: string) => Promise<unknown>>
const kid = { id: 1, name: 'Mia', avatar: null, online_all: true, done: 0, total: 1, needs_you_count: 1, chores: [], devices: [] }
const item = { type: 'chore', id: 5, kid_id: 1, kid_name: 'Mia', title: 'Homework', mode: 'each' }

beforeEach(() => {
  fakeRouter.reset('/')
  localStorage.setItem('task4ce-tip:onboard.parent', '1')
  apiMock.mockReset()
  apiMock.mockImplementation(async (p) =>
    p === '/kids' ? [] : p === '/happy-hour' ? { active: [], recent: [] } : p === '/me/tips' ? { dismissed: [] } : p === '/family' ? { hh_auto_boost: true, streak_freeze: true } : p === '/today' ? { day: '2026-10-24', pending_approvals: 1, new_devices: [], kids: [kid], needs_you: [item] } : { total: 0, threads: [], rules: [] },
  )
})

test('phone Today: the Needs you strip opens the combined list, with no tabs or kid strip', async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>
        <TodayPage />
      </MantineProvider>
    </QueryClientProvider>,
  )
  await userEvent.click(await screen.findByRole('button', { name: /^Needs you · 1/ }))
  expect(await screen.findByText('Homework')).toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: 'Kids' })).toBeNull()
  expect(screen.queryByRole('tab')).toBeNull()
})
