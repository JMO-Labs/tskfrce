import { describe, expect, test } from '@jest/globals'
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { notifications } from '@mantine/notifications'
import { KidsPage } from '@/v2/manage/KidsPage'
import { apiMock, calls, detail, list, mockRoute, serve, setupLibrary, wrap } from './libraryHelpers'

jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn(), hide: jest.fn() } }))
jest.mock('next/router', () => ({
  useRouter: () => ({ query: mockRoute.query, push: mockRoute.push, replace: mockRoute.replace, pathname: '/kids' }),
}))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
const mockDownload = jest.fn()
jest.mock('@/v2/manage/historyCsv', () => ({
  ...jest.requireActual<object>('@/v2/manage/historyCsv'),
  downloadCsv: (...a: unknown[]) => mockDownload(...a),
}))
jest.mock('@/v2/parent/ParentShell', () => ({
  ParentShell: ({ list, children }: { list: ReactNode; children: ReactNode }) => (
    <>
      <div data-testid="list">{list}</div>
      <div data-testid="detail">{children}</div>
    </>
  ),
}))
jest.mock('@/v2/components/RequireParent', () => ({
  RequireParent: ({ children }: { children: ReactNode }) => <>{children}</>,
  startSignOut: jest.fn(),
  cancelSignOut: jest.fn(),
}))

setupLibrary()


const kid = { kid_id: 7, name: 'Maya', balance: 300, bought_today: 30, max_minutes: 60, limit: null, saved: 0 }
const st = {
  enabled: true, price: 20, max_minutes_per_day: 60, auto_approve: false, only_in_allowed_hours: true,
  group_pricing: false, rollover: true, bank_cap: null, reset_time: '04:00', avg_chore_points: 20,
  kids: [kid, { ...kid, kid_id: 8, name: 'Leo', saved: 40 }],
}
const open = async (over: Record<string, unknown> = {}) => {
  serve({ '/redemptions': [], '/rewards': [], '/screen-time': { ...st, ...over } })
  mockRoute.query = { section: 'rewards', item: 'screen' }
  render(wrap(<KidsPage />))
  await within(detail()).findByText('Screen time')
}
const sw = () => within(detail()).queryByRole('switch', { name: 'Save unused time' })

describe('time banking: parent settings', () => {
  test('switch and hint show with a daily max; field shows when on', async () => {
    await open()
    expect(sw()).toHaveAttribute('aria-checked', 'true')
    expect(within(detail()).getByText("Minutes a kid doesn't buy today carry over, so they can save up for a bigger day.")).toBeInTheDocument()
    expect(within(detail()).getByLabelText('Save up to')).toHaveAttribute('placeholder', 'Same as the daily max (60)')
  })
  test('hidden with no daily max', async () => {
    await open({ max_minutes_per_day: null })
    expect(sw()).toBeNull()
    expect(within(detail()).queryByLabelText('Save up to')).toBeNull()
  })
  test('hidden when screen time is off', async () => {
    await open({ enabled: false })
    expect(sw()).toBeNull()
  })
  test('field hidden when rollover is off', async () => {
    await open({ rollover: false })
    expect(sw()).toHaveAttribute('aria-checked', 'false')
    expect(within(detail()).queryByLabelText('Save up to')).toBeNull()
  })
  test('clearing the field sends bank_cap: null', async () => {
    await open({ bank_cap: 120 })
    const f = within(detail()).getByLabelText('Save up to')
    expect(f).toHaveValue('120')
    await userEvent.clear(f)
    await userEvent.click(within(detail()).getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(calls('PATCH')[0]).toEqual(['/screen-time', { method: 'PATCH', body: { bank_cap: null } }]))
  })
  test('invalid cap blocks Save', async () => {
    await open()
    await userEvent.type(within(detail()).getByLabelText('Save up to'), '20')
    expect(within(detail()).getByText('Use steps of 15.')).toBeInTheDocument()
    expect(within(detail()).getByRole('button', { name: 'Save' })).toBeDisabled()
  })
  test('Saved label and bar measured against max + saved', async () => {
    await open()
    const bought = within(detail()).getByRole('region', { name: 'Bought today' })
    expect(within(bought).getByText('Saved: 40 min')).toBeInTheDocument()
    expect(within(bought).getAllByText('Saved: 40 min')).toHaveLength(1)
    expect(bought.querySelectorAll('.pt-bar i')[1]).toHaveStyle({ width: '30%' })
  })
})
