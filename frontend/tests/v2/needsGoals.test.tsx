import { beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { NeedsYouList } from '@/v2/today/NeedsYouList'
import type { NeedsItem } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn(), kidToken: () => null }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
const push = jest.fn()
jest.mock('next/router', () => ({ useRouter: () => ({ push }) }))
jest.mock('@/v2/chat/dock', () => ({ openChatAfterNav: jest.fn() }))
const apiMock = api as unknown as Mock<(p: string, init?: object) => Promise<unknown>>

const full: NeedsItem = { type: 'goal_full', id: 5, kid_id: 1, kid_name: 'Mia', title: 'Bike', cost: 300, submitted_at: '2026-11-10T10:00:00Z' }
const idea: NeedsItem = { type: 'goal_suggested', id: 6, kid_id: 1, kid_name: 'Mia', title: 'Lego set', cost: null as unknown as number, submitted_at: '2026-11-10T11:00:00Z' }
const reward: NeedsItem = { type: 'reward', id: 11, kid_id: 1, kid_name: 'Mia', title: 'Ice cream', cost: 40, kid_balance: 60 }

beforeEach(() => {
  push.mockReset()
  apiMock.mockReset().mockResolvedValue({})
})

const show = (items: NeedsItem[]) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>
        <NeedsYouList items={items} />
      </MantineProvider>
    </QueryClientProvider>,
  )
const card = (title: string) => screen.getByText(title).closest('.p-arow') as HTMLElement

test('goal rows show their kind, cost and own main action', () => {
  show([full, idea])
  expect(within(card('Bike')).getByText('300 pts')).toBeInTheDocument()
  expect(within(card('Bike')).getByRole('button', { name: 'Fulfilled' })).toBeInTheDocument()
  expect(within(card('Lego set')).getByRole('button', { name: 'Set price' })).toBeInTheDocument()
})

test('Fulfilled posts the fulfill action', async () => {
  show([full])
  await userEvent.click(within(card('Bike')).getByRole('button', { name: 'Fulfilled' }))
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/goals/5/fulfill', { method: 'POST' }))
})

test('Set price opens the Goals pane', async () => {
  show([idea])
  await userEvent.click(within(card('Lego set')).getByRole('button', { name: 'Set price' }))
  expect(push).toHaveBeenCalledWith('/kids?section=rewards&item=goals')
})

test('Approve all skips goal items', async () => {
  show([full, idea, reward])
  await userEvent.click(screen.getByRole('button', { name: /Approve all/ }))
  await waitFor(() => expect(apiMock.mock.calls.some(([p]) => p.includes('11'))).toBe(true))
  expect(apiMock.mock.calls.some(([p]) => p.startsWith('/goals'))).toBe(false)
})

test('only goal items: no Approve all', () => {
  show([full, idea])
  expect(screen.queryByRole('button', { name: /Approve all/ })).toBeNull()
})

test('a goal idea reads Needs a price, not a points number', () => {
  show([idea])
  expect(screen.getByText('Needs a price')).toBeInTheDocument()
  expect(screen.queryByText(/null pts/)).toBeNull()
})
