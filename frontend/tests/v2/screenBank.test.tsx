import { describe, expect, test } from '@jest/globals'
import type { ReactNode } from 'react'
import { render, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KidsPage } from '@/v2/manage/KidsPage'
import { calls, detail, mockRoute, serve, setupLibrary, wrap } from './libraryHelpers'

jest.mock('next/router', () => ({
  useRouter: () => ({ query: mockRoute.query, push: mockRoute.push, replace: mockRoute.replace, pathname: '/kids' }),
}))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
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
const open = async (over: Record<string, unknown> = {}, row = 'save') => {
  serve({ '/redemptions': [], '/rewards': [], '/screen-time': { ...st, ...over } })
  mockRoute.query = { section: 'rewards', item: 'screen', open: row }
  render(wrap(<KidsPage />))
  await within(detail()).findByText('Screen time')
}
const sw = () => within(detail()).queryByRole('switch', { name: 'Carry unused minutes over' })
const cap = () => within(detail()).queryByRole('textbox', { name: 'Save up to' })

describe('time banking: parent settings', () => {
  test('switch, hint and field show with a daily max', async () => {
    await open()
    await within(detail()).findByRole('switch', { name: 'Carry unused minutes over' })
    expect(sw()).toBeChecked()
    expect(within(detail()).getByText("Minutes a kid doesn't buy today carry over, so they can save up for a bigger day.")).toBeInTheDocument()
    expect(cap()).toHaveAttribute('placeholder', 'Same as the daily max (60)')
  })
  test('with no max anywhere the row asks for one', async () => {
    await open({ max_minutes_per_day: null, kids: [{ ...kid, max_minutes: null }, { ...kid, kid_id: 8, name: 'Leo', max_minutes: null, limit: { max_minutes: null, min_points: 100 } }] })
    expect(await within(detail()).findByText(/Pick a max per day first/)).toBeInTheDocument()
    expect(sw()).toBeChecked() // can still be turned off
    expect(cap()).toBeNull()
  })
  test('hidden when screen time is off', async () => {
    await open({ enabled: false })
    expect(sw()).toBeNull()
    expect(within(detail()).queryByText('Save unused time')).toBeNull()
  })
  test('field hidden when rollover is off', async () => {
    await open({ rollover: false })
    await within(detail()).findByRole('switch', { name: 'Carry unused minutes over' })
    expect(sw()).not.toBeChecked()
    expect(cap()).toBeNull()
  })
  test('clearing the field sends bank_cap: null on blur', async () => {
    await open({ bank_cap: 120 })
    const f = await within(detail()).findByRole('textbox', { name: 'Save up to' })
    expect(f).toHaveValue('120')
    await userEvent.clear(f)
    await userEvent.tab()
    await waitFor(() => expect(calls('PATCH')[0]).toEqual(['/screen-time', { method: 'PATCH', body: { bank_cap: null } }]))
  })
  test('an invalid cap shows its error and sends nothing', async () => {
    await open()
    await userEvent.type(await within(detail()).findByRole('textbox', { name: 'Save up to' }), '20')
    await userEvent.tab()
    expect(within(detail()).getByText('Use steps of 15.')).toBeInTheDocument()
    expect(calls('PATCH')).toHaveLength(0)
  })
  test('the saved minutes and the bar are measured against max + saved', async () => {
    await open({}, 'kid-8')
    expect(await within(detail()).findByText('300 pts · up to 3h 45m · saved 40 min')).toBeInTheDocument()
    expect(within(detail()).getByText('30/100 min today').closest('.p-srow-l2')?.querySelector('.pt-bar i')).toHaveStyle({ width: '30%' })
  })
  test('a valid cap is sent as a number', async () => {
    await open()
    await userEvent.type(await within(detail()).findByRole('textbox', { name: 'Save up to' }), '120')
    await userEvent.tab()
    await waitFor(() => expect(calls('PATCH')[0]).toEqual(['/screen-time', { method: 'PATCH', body: { bank_cap: 120 } }]))
  })
  test('turning saving off sends rollover: false', async () => {
    await open()
    await userEvent.click(await within(detail()).findByRole('switch', { name: 'Carry unused minutes over' }))
    await waitFor(() => expect(calls('PATCH')[0]).toEqual(['/screen-time', { method: 'PATCH', body: { rollover: false } }]))
  })
  test('family max empty + a per-kid max: switch shows, placeholder per kid', async () => {
    const limited = { ...kid, limit: { max_minutes: 45, min_points: null }, max_minutes: 45 }
    await open({ max_minutes_per_day: null, kids: [limited, { ...kid, kid_id: 8, name: 'Leo', max_minutes: null }] })
    await within(detail()).findByRole('switch', { name: 'Carry unused minutes over' })
    expect(sw()).toBeChecked()
    expect(cap()).toHaveAttribute('placeholder', "Same as each kid's daily max")
  })
})
