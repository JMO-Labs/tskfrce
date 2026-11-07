import { beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { FamilyCard } from '@/v2/manage/FamilyCards'
import type { Family } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>
const fam = (o: Partial<Family> = {}) =>
  ({ name: 'R', timezone: 'UTC', reset_time: '06:00', early_bonus_cap: 5, streak_freeze: true, bedtime_auto: false, bedtime_auto_at: '21:00', recap_weekly: true, ...o }) as Family
const show = (f: Family) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider env="test">
        <FamilyCard fam={f} />
      </MantineProvider>
    </QueryClientProvider>,
  )
const patches = () => apiMock.mock.calls.filter((c) => c[0] === '/family' && c[1]?.method === 'PATCH').map((c) => c[1]?.body)

beforeEach(() => {
  apiMock.mockReset().mockImplementation(async (_p, i) => (i?.method ? i.body : undefined))
})

test('one Less tapping card holds both rows, each with a muted line', () => {
  show(fam())
  const card = screen.getByRole('region', { name: 'Less tapping' })
  expect(card).toHaveTextContent('Chores still waiting approve themselves each night.')
  expect(card).toHaveTextContent("A short summary of each kid's week, Sundays at 7:30 PM.")
  expect(screen.queryByRole('region', { name: /^Bedtime auto-approve/ })).toBeNull()
  expect(screen.queryByRole('region', { name: /^Weekly recap/ })).toBeNull()
})

test('bedtime time is hidden while the switch is off', () => {
  show(fam())
  expect(screen.getByRole('switch', { name: /^Bedtime auto-approve/ })).not.toBeChecked()
  expect(screen.queryByLabelText('Approve at')).toBeNull()
})

test('turning bedtime on shows the time, and both save together', async () => {
  show(fam())
  await userEvent.click(screen.getByRole('switch', { name: /^Bedtime auto-approve/ }))
  const t = screen.getByLabelText('Approve at')
  expect(t).toHaveValue('21:00')
  await userEvent.clear(t)
  await userEvent.type(t, '22:15')
  await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  await waitFor(() => expect(patches()).toEqual([{ bedtime_auto: true, bedtime_auto_at: '22:15' }]))
})

test('the time shows when bedtime is already on', () => {
  show(fam({ bedtime_auto: true, bedtime_auto_at: '20:30' }))
  expect(screen.getByLabelText('Approve at')).toHaveValue('20:30')
})

test('weekly recap switch saves', async () => {
  show(fam())
  await userEvent.click(screen.getByRole('switch', { name: /^Weekly recap/ }))
  await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  await waitFor(() => expect(patches()).toEqual([{ recap_weekly: false }]))
})

test('reset at 8 PM: turning bedtime on sends a valid time and says the latest', async () => {
  show(fam({ reset_time: '20:00' }))
  expect(screen.getByRole('region', { name: 'Less tapping' })).not.toHaveTextContent('Latest is')
  await userEvent.click(screen.getByRole('switch', { name: /^Bedtime auto-approve/ }))
  expect(screen.getByLabelText('Approve at')).toHaveValue('19:45')
  expect(screen.getByText('Latest is 7:45 PM, 15 minutes before the day resets.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Save settings' }))
  await waitFor(() => expect(patches()).toEqual([{ bedtime_auto: true, bedtime_auto_at: '19:45' }]))
})
