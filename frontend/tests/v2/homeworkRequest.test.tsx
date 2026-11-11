import { beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { NeedsYouList } from '@/v2/today/NeedsYouList'
import { StatusBanner } from '@/v2/kid/modes/StatusBanner'
import type { KidToday, NeedsItem } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn(), kidToken: () => null }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('next/router', () => ({ useRouter: () => ({ push: jest.fn() }) }))
jest.mock('@/v2/chat/dock', () => ({ openChat: jest.fn() }))
const apiMock = api as unknown as Mock<(p: string, init?: object) => Promise<unknown>>

const hw: NeedsItem = { type: 'homework', id: 7, kid_id: 1, kid_name: 'Mia', title: 'Homework time', submitted_at: '2026-11-04T20:00:00Z' }
const reward: NeedsItem = { type: 'reward', id: 7, kid_id: 1, kid_name: 'Mia', title: 'Ice cream', cost: 40, kid_balance: 60 }
const kid = (o: Partial<KidToday>) => ({ locked: true, chores: [], points_balance: 0, age_group: 'kid', locks_at: null, ...o }) as KidToday

beforeEach(() => {
  apiMock.mockReset().mockResolvedValue({})
  global.fetch = jest.fn(() => Promise.resolve({ ok: false })) as unknown as typeof fetch
})
const wrap = (ui: React.ReactElement) => (
  <QueryClientProvider client={new QueryClient()}>
    <MantineProvider>{ui}</MantineProvider>
  </QueryClientProvider>
)

test('paused kid sees the button and it posts', async () => {
  render(wrap(<StatusBanner d={kid({})} size="big" />))
  await userEvent.click(screen.getByRole('button', { name: /Ask for homework time/ }))
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/kid/homework', { method: 'POST', kid: true }))
})

test('pending shows the waiting chip, no button', () => {
  render(wrap(<StatusBanner d={kid({ homework_pending: true })} size="big" />))
  expect(screen.getByText('Waiting for a parent')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Ask for homework/ })).toBeNull()
})

test('homework banner text', () => {
  render(wrap(<StatusBanner d={kid({ locked: false, homework: { until: '2026-11-04T21:30:00Z' } })} size="big" />))
  expect(screen.getByText(/Homework mode is on until/)).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Ask for homework/ })).toBeNull()
})

test('unlocked kid has no button', () => {
  render(wrap(<StatusBanner d={kid({ locked: false })} size="big" />))
  expect(screen.queryByRole('button', { name: /Ask for homework/ })).toBeNull()
})

test('Approve gives the default hour via the homework route', async () => {
  render(wrap(<NeedsYouList items={[hw]} />))
  await userEvent.click(screen.getByRole('button', { name: 'Approve' }))
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/homework/requests/7/approve', { method: 'POST', body: { minutes: 60 } }))
  expect(apiMock).not.toHaveBeenCalledWith('/redemptions/7/approve', expect.anything())
})

test('parent picks other minutes from the More menu', async () => {
  render(wrap(<NeedsYouList items={[hw]} />))
  await userEvent.click(screen.getByRole('button', { name: 'More for Homework time' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Approve 90 min' }))
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/homework/requests/7/approve', { method: 'POST', body: { minutes: 90 } }))
})

test('decline posts deny', async () => {
  render(wrap(<NeedsYouList items={[hw]} />))
  await userEvent.click(screen.getByRole('button', { name: 'More for Homework time' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Decline' }))
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/homework/requests/7/deny', { method: 'POST' }))
}, 15000) // menu open + two userEvent clicks run ~5s on CI runners

test('approve all includes homework at 60 min', async () => {
  render(wrap(<NeedsYouList items={[hw, reward]} />))
  await userEvent.click(screen.getByRole('button', { name: 'Approve all' }))
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/homework/requests/7/approve', { method: 'POST', body: { minutes: 60 } }))
  expect(apiMock).toHaveBeenCalledWith('/redemptions/7/approve', { method: 'POST' })
})
