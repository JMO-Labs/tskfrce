import { beforeAll, beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { FamilyCard } from '@/v2/manage/FamilyCards'
import type { Family } from '@/v2/types'
import { bedtimeLatest, bedtimePossible } from '@/v2/trustTypes'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>
const fam = (o: Partial<Family> = {}) =>
  ({ name: 'R', timezone: 'UTC', reset_time: '06:00', early_bonus_cap: 5, streak_freeze: true, bedtime_auto: false, bedtime_auto_at: '21:00', recap_weekly: true, ...o }) as Family
const show = (f: Family, open = 'bed') => {
  fakeRouter.reset('/settings', { section: 'family', open })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider env="test">
        <FamilyCard fam={f} />
      </MantineProvider>
    </QueryClientProvider>,
  )
}
const patches = () => apiMock.mock.calls.filter((c) => c[0] === '/family' && c[1]?.method === 'PATCH').map((c) => c[1]?.body)
const bedSwitch = () => screen.getByRole('switch', { name: 'Bedtime auto-approve' })

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})
beforeEach(() => {
  apiMock.mockReset().mockImplementation(async (_p, i) => (i?.method ? i.body : undefined))
})

test('the closed Bedtime row shows its values and no form', () => {
  show(fam({ bedtime_auto: true, bedtime_auto_at: '21:00' }), '')
  expect(screen.getByText('Auto-approve 9:00 PM · Recap on')).toBeInTheDocument()
  expect(screen.queryByRole('switch', { name: 'Weekly recap' })).toBeNull()
})

test('bedtime time is hidden while the switch is off', () => {
  show(fam())
  expect(bedtimeSwitchOff()).toBe(true)
  expect(screen.queryByLabelText('Approve at')).toBeNull()
})
const bedtimeSwitchOff = () => !(bedSwitch() as HTMLInputElement).checked

test('turning bedtime on saves at once when a time is already set', async () => {
  show(fam())
  await userEvent.click(bedSwitch())
  expect(screen.getByLabelText('Approve at')).toHaveValue('21:00')
  await waitFor(() => expect(patches()).toEqual([{ bedtime_auto: true }]))
})

test('bedtime saves only when the time is set', async () => {
  show(fam({ bedtime_auto_at: undefined }))
  await userEvent.click(bedSwitch())
  expect(patches()).toEqual([]) // no time yet: nothing sent
  expect(screen.getByText(/Pick a time from 6:00 PM/)).toBeInTheDocument()
  const t = screen.getByLabelText('Approve at')
  fireEvent.change(t, { target: { value: '22:15' } })
  fireEvent.blur(t)
  await waitFor(() => expect(patches()).toEqual([{ bedtime_auto: true, bedtime_auto_at: '22:15' }]))
})

test('clearing the time of a saved bedtime sends nothing and shows the hint', async () => {
  show(fam({ bedtime_auto: true, bedtime_auto_at: '20:30' }))
  expect(screen.getByLabelText('Approve at')).toHaveValue('20:30')
  const t = screen.getByLabelText('Approve at')
  fireEvent.change(t, { target: { value: '' } })
  fireEvent.blur(t)
  expect(patches()).toEqual([])
  expect(screen.getByText(/Pick a time from 6:00 PM/)).toBeInTheDocument()
})

test('changing the saved time sends only the time', async () => {
  show(fam({ bedtime_auto: true }))
  const t = screen.getByLabelText('Approve at')
  fireEvent.change(t, { target: { value: '22:00' } })
  fireEvent.blur(t)
  await waitFor(() => expect(patches()).toEqual([{ bedtime_auto_at: '22:00' }]))
})

test('turning bedtime off saves at once', async () => {
  show(fam({ bedtime_auto: true }))
  await userEvent.click(bedSwitch())
  await waitFor(() => expect(patches()).toEqual([{ bedtime_auto: false }]))
})

test('weekly recap switch saves at once, no Save button', async () => {
  show(fam())
  await userEvent.click(screen.getByRole('switch', { name: 'Weekly recap' }))
  await waitFor(() => expect(patches()).toEqual([{ recap_weekly: false }]))
  expect(screen.queryByRole('button', { name: 'Save settings' })).toBeNull()
})

test('reset at 8 PM: turning bedtime on sends a valid time and says the latest', async () => {
  show(fam({ reset_time: '20:00' }))
  expect(screen.queryByText(/Latest is/)).toBeNull()
  await userEvent.click(bedSwitch())
  expect(screen.getByLabelText('Approve at')).toHaveValue('19:45')
  expect(screen.getByText('Latest is 7:45 PM, 15 minutes before the day resets.')).toBeInTheDocument()
  await waitFor(() => expect(patches()).toEqual([{ bedtime_auto: true, bedtime_auto_at: '19:45' }]))
})

test('moving the reset past a saved bedtime pulls the bedtime earlier in the same save', async () => {
  show(fam({ bedtime_auto: true, bedtime_auto_at: '21:00' }), 'hh')
  const r = screen.getByLabelText('Day resets at')
  fireEvent.change(r, { target: { value: '20:00' } })
  fireEvent.blur(r)
  await waitFor(() => expect(patches()).toEqual([{ reset_time: '20:00', bedtime_auto_at: '19:45' }]))
})

test('a reset with no room for a bedtime disables the switch and says why', () => {
  show(fam({ reset_time: '18:10' }))
  expect(bedSwitch()).toBeDisabled()
  expect(screen.getByText('Move the day reset later than 6:15 PM to use this.')).toBeInTheDocument()
})

test('bedtime on but reset too early: the hint shows and the time field goes', () => {
  show(fam({ bedtime_auto: true, bedtime_auto_at: '21:00', reset_time: '18:05' }))
  expect(screen.getByText('Move the day reset later than 6:15 PM to use this.')).toBeInTheDocument()
  expect(screen.queryByLabelText('Approve at')).toBeNull()
  expect(bedSwitch()).toBeEnabled()
})

test('bedtimeLatest stays on a 15-minute step', () => {
  expect(bedtimeLatest('20:10')).toBe('19:45')
  expect(bedtimeLatest('06:00')).toBe('23:30')
  expect(bedtimePossible('18:14')).toBe(false)
  expect(bedtimePossible('18:15')).toBe(true)
})
