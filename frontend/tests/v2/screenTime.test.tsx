import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { notifications } from '@mantine/notifications'
import { api } from '@/v2/api'
import { ScreenTimePane } from '@/v2/manage/ScreenTimePane'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))

type Init = { method?: string; body?: unknown }
const apiMock = api as unknown as Mock<(p: string, i?: Init) => Promise<unknown>>
const showMock = notifications.show as unknown as Mock<(o: { message: unknown }) => void>

const kid = (o: object = {}) => ({ kid_id: 3, name: 'Maya', balance: 240, bought_today: 30, max_minutes: 120, limit: null, saved: 45, ...o })
const base = {
  enabled: true, price: 20, max_minutes_per_day: 120, auto_approve: false, only_in_allowed_hours: true, group_pricing: true,
  rollover: true, bank_cap: 240, reset_time: '06:00', avg_chore_points: 20,
  kids: [kid(), kid({ kid_id: 4, name: 'Leo', balance: 190, bought_today: 0, saved: 0 }), kid({ kid_id: 5, name: 'Ava', balance: 60, bought_today: 15, saved: 10, limit: { max_minutes: 60, min_points: 20 } })],
}
const serve = (over: object = {}, fail?: (p: string, i?: Init) => boolean) => {
  let cur: object = { ...base, ...over }
  apiMock.mockReset().mockImplementation(async (p, i) => {
    if (fail?.(p, i)) throw new Error('boom')
    if (i?.method === 'PATCH') cur = { ...cur, ...(i.body as object) }
    const put = /limits\/(\d+)$/.exec(p)
    if (put && i?.method === 'PUT') cur = { ...cur, kids: (cur as typeof base).kids.map((k) => (k.kid_id === Number(put[1]) ? { ...k, limit: i.body } : k)) }
    return cur
  })
}
const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider><ScreenTimePane /></MantineProvider>
    </QueryClientProvider>,
  )
const sent = (method: string) => apiMock.mock.calls.filter((c) => c[1]?.method === method)
const saved = () => showMock.mock.calls.filter((c) => c[0].message === 'Saved')

beforeEach(() => {
  showMock.mockReset()
  fakeRouter.reset('/kids', { section: 'rewards', item: 'screen' })
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  global.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
})
const open = (id: string) => act(() => void fakeRouter.replace({ query: { section: 'rewards', item: 'screen', open: id } }))

describe('Screen time pane', () => {
  test('one line per rule with its summary', async () => {
    serve()
    wrap()
    const row = async (name: RegExp) => within(await screen.findByRole('button', { name })).getByText(/./, { selector: '.p-srow-val' })
    expect((await row(/^Price(?!s)/)).textContent).toBe('20 pts = 15 min')
    expect((await row(/^Max per day/)).textContent).toBe('120 min')
    expect((await row(/^Save unused time/)).textContent).toBe('On · up to 240 min')
    expect((await row(/^Prices per device group/)).textContent).toBe('On')
    expect((await row(/^Approve automatically/)).textContent).toBe('Off')
    expect((await row(/^Only during allowed hours/)).textContent).toBe('On')
    expect(screen.getByText('Rules')).toBeInTheDocument()
    expect(screen.getByText('bought today · resets 6:00 AM')).toBeInTheDocument()
  })

  test('summaries with no max and saving off', async () => {
    serve({ max_minutes_per_day: null, rollover: false })
    wrap()
    expect(await screen.findByRole('button', { name: /^Max per day.*No max/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save unused time.*Off/ })).toBeInTheDocument()
  })

  test('header: sub text and the on switch', async () => {
    serve()
    wrap()
    expect(await screen.findByText('Kids spend points on extra minutes. Changes save as you go.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: /kids can buy extra minutes/i })).toBeChecked()
  })

  test('off: only the header switch and a hint', async () => {
    serve({ enabled: false })
    wrap()
    const sw = await screen.findByRole('switch', { name: /kids can buy extra minutes/i })
    expect(sw).not.toBeChecked()
    expect(screen.getByText('Turn this on to let kids spend points on extra internet time.')).toBeInTheDocument()
    expect(screen.queryByText('Rules')).toBeNull()
    expect(screen.queryByText('Maya')).toBeNull()
    await userEvent.click(sw)
    await waitFor(() => expect(sent('PATCH')[0]).toEqual(['/screen-time', { method: 'PATCH', body: { enabled: true } }]))
    expect(await screen.findByText('Rules')).toBeInTheDocument()
  })

  test('a switch saves on change with Saved, and does not open its row', async () => {
    serve()
    wrap()
    await screen.findByText('Rules')
    open('auto')
    await userEvent.click(await screen.findByRole('switch', { name: 'Approve buys without asking' }))
    await waitFor(() => expect(sent('PATCH')[0]).toEqual(['/screen-time', { method: 'PATCH', body: { auto_approve: true } }]))
    await waitFor(() => expect(saved()).toHaveLength(1))
    expect(fakeRouter.query.open).toBe('auto')
  })

  test('the max select saves on change', async () => {
    serve()
    wrap()
    await screen.findByText('Rules')
    open('max')
    await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Max per day' }), '60')
    await waitFor(() => expect(sent('PATCH')[0][1]).toEqual({ method: 'PATCH', body: { max_minutes_per_day: 60 } }))
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Max per day' }), '')
    await waitFor(() => expect(sent('PATCH')[1][1]).toEqual({ method: 'PATCH', body: { max_minutes_per_day: null } }))
  })

  test('price autosaves on blur when valid, hint when not', async () => {
    serve()
    wrap()
    await screen.findByText('Rules')
    open('price')
    const f = await screen.findByRole('textbox', { name: 'Points per 15 min' })
    await userEvent.clear(f)
    await userEvent.type(f, '0')
    await userEvent.tab()
    expect(sent('PATCH')).toHaveLength(0)
    expect(f).toHaveAttribute('aria-invalid', 'true')
    const err = screen.getByText('Must be at least 1.')
    expect(f.getAttribute('aria-describedby')).toContain(err.id)
    await userEvent.clear(f)
    await userEvent.type(f, '25')
    await userEvent.tab()
    await waitFor(() => expect(sent('PATCH')[0]).toEqual(['/screen-time', { method: 'PATCH', body: { price: 25 } }]))
    expect(saved()).toHaveLength(1)
  })

  test('a failed price save puts the server value back', async () => {
    serve({}, (_p, i) => i?.method === 'PATCH')
    wrap()
    await screen.findByText('Rules')
    open('price')
    const f = await screen.findByRole('textbox', { name: 'Points per 15 min' })
    await userEvent.clear(f)
    await userEvent.type(f, '25')
    await userEvent.tab()
    await waitFor(() => expect(f).toHaveValue('20'))
  })

  test('no What points buy card; its content is in Price', async () => {
    serve()
    wrap()
    await screen.findByText('Rules')
    expect(screen.queryByRole('region', { name: 'What points buy' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Bought today' })).toBeNull()
    open('price')
    expect(await screen.findByText(/An average chore \(20 pts\) buys 15 min\./)).toHaveTextContent('Today Maya can buy up to 3h, Leo 2h 15m, Ava 45 min.')
  })

  test('save-up-to cap below the daily max shows a hint and sends nothing', async () => {
    serve()
    wrap()
    await screen.findByText('Rules')
    open('save')
    const f = await screen.findByRole('textbox', { name: /Save up to/ })
    await userEvent.clear(f)
    await userEvent.type(f, '60')
    await userEvent.tab()
    expect(sent('PATCH')).toHaveLength(0)
    const hint = screen.getByText(/at least the largest daily max/i)
    expect(f.getAttribute('aria-describedby')).toContain(hint.id)
    await userEvent.clear(f)
    await userEvent.type(f, '180')
    await userEvent.tab()
    await waitFor(() => expect(sent('PATCH')[0][1]).toEqual({ method: 'PATCH', body: { bank_cap: 180 } }))
  })

  test('an empty cap sends bank_cap null; steps of 15 are enforced', async () => {
    serve()
    wrap()
    await screen.findByText('Rules')
    open('save')
    const f = await screen.findByRole('textbox', { name: /Save up to/ })
    await userEvent.clear(f)
    await userEvent.type(f, '130')
    await userEvent.tab()
    expect(screen.getByText('Use steps of 15.')).toBeInTheDocument()
    expect(sent('PATCH')).toHaveLength(0)
    await userEvent.clear(f)
    await userEvent.tab()
    await waitFor(() => expect(sent('PATCH')[0][1]).toEqual({ method: 'PATCH', body: { bank_cap: null } }))
  })

  test('saving switch turns rollover off; the cap field goes away', async () => {
    serve()
    wrap()
    await screen.findByText('Rules')
    open('save')
    await userEvent.click(await screen.findByRole('switch', { name: 'Carry unused minutes over' }))
    await waitFor(() => expect(sent('PATCH')[0][1]).toEqual({ method: 'PATCH', body: { rollover: false } }))
    await waitFor(() => expect(screen.queryByRole('textbox', { name: /Save up to/ })).toBeNull())
  })

  test('save row without any max says it needs one', async () => {
    serve({ max_minutes_per_day: null, kids: [kid({ max_minutes: null })] })
    wrap()
    await screen.findByText('Rules')
    open('save')
    expect(await screen.findByText(/Pick a max per day first/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^Save unused time.*Needs a max/ })).toBeInTheDocument()
    // saving can still be turned off from here
    await userEvent.click(screen.getByRole('switch', { name: 'Carry unused minutes over' }))
    await waitFor(() => expect(sent('PATCH')[0][1]).toEqual({ method: 'PATCH', body: { rollover: false } }))
    await waitFor(() => expect(screen.queryByRole('switch', { name: 'Carry unused minutes over' })).toBeNull())
  })

  test('a saved cap below a kid max is flagged on open', async () => {
    serve({ max_minutes_per_day: null, bank_cap: 60, kids: [kid({ limit: { max_minutes: 180, min_points: null }, max_minutes: 180 })] })
    wrap()
    await screen.findByText('Rules')
    open('save')
    expect(await screen.findByText(/at least the largest daily max \(180 min\)/i)).toBeInTheDocument()
  })

  test('cap check uses the largest kid max when there is no family max', async () => {
    serve({ max_minutes_per_day: null, bank_cap: null, kids: [kid({ max_minutes: 180, limit: { max_minutes: 180, min_points: null } })] })
    wrap()
    await screen.findByText('Rules')
    open('save')
    const f = await screen.findByRole('textbox', { name: /Save up to/ })
    await userEvent.type(f, '120')
    await userEvent.tab()
    expect(screen.getByText(/at least the largest daily max \(180 min\)/i)).toBeInTheDocument()
    expect(sent('PATCH')).toHaveLength(0)
  })

  test('group prices: link to the groups tab only when saved on', async () => {
    serve()
    wrap()
    await screen.findByText('Rules')
    open('gprice')
    expect(await screen.findByRole('link', { name: 'Set group prices' })).toHaveAttribute('href', '/devices?tab=groups')
    expect(screen.getByText('Charge more for some devices, like game consoles.')).toBeInTheDocument()
  })

  test('group prices off: no link', async () => {
    serve({ group_pricing: false })
    wrap()
    await screen.findByText('Rules')
    open('gprice')
    await screen.findByRole('switch', { name: 'Different prices for device groups' })
    expect(screen.queryByRole('link', { name: 'Set group prices' })).toBeNull()
  })

  test('two quick changes are both sent, in order', async () => {
    serve()
    wrap()
    await screen.findByText('Rules')
    open('hrs')
    await userEvent.click(await screen.findByRole('switch', { name: 'Only during allowed hours' }))
    open('auto')
    await userEvent.click(await screen.findByRole('switch', { name: 'Approve buys without asking' }))
    await waitFor(() => expect(sent('PATCH')).toHaveLength(2))
    expect(sent('PATCH').map((c) => c[1]?.body)).toEqual([{ only_in_allowed_hours: false }, { auto_approve: true }])
  })

  test('screen time kid names use p-kn', async () => {
    serve()
    wrap()
    expect(await screen.findByText('Ava')).toHaveClass('p-kn')
    expect(screen.getByText('Maya')).toHaveClass('p-kn')
  })

  test('kid rows: summary and bought-today line', async () => {
    serve()
    wrap()
    const ava = await screen.findByRole('button', { name: /^Ava/ })
    expect(ava).toHaveTextContent('60 min/day')
    expect(screen.getByRole('button', { name: /^Maya/ })).toHaveTextContent('Family max')
    expect(screen.getByText('30/165 min today')).toBeInTheDocument()
    expect(screen.getByText('0/120 min today').closest('.p-srow-l2')?.querySelector('.pt-bar i')).toHaveStyle({ width: '0%' })
    expect(screen.getByText('15/130 min today').closest('.p-srow-l2')?.querySelector('.pt-bar i')).toBeInTheDocument()
  })

  test('kid row opens its limit in place and autosaves the pair', async () => {
    serve()
    wrap()
    await userEvent.click(await screen.findByRole('button', { name: /^Leo/ }))
    expect(fakeRouter.query.open).toBe('kid-4')
    expect(await screen.findByText('190 pts · up to 2h 15m')).toBeInTheDocument()
    const max = screen.getByRole('textbox', { name: 'Leo daily limit (min)' })
    const min = screen.getByRole('textbox', { name: 'Leo not allowed until (pts)' })
    expect(screen.queryByRole('button', { name: /Remove limit/ })).toBeNull()
    await userEvent.type(max, '45')
    await userEvent.type(min, '100')
    await userEvent.tab()
    await waitFor(() => expect(sent('PUT')).toHaveLength(1))
    expect(sent('PUT')[0]).toEqual(['/screen-time/limits/4', { method: 'PUT', body: { max_minutes: 45, min_points: 100 } }])
    expect(saved()).toHaveLength(1)
  })

  test('kid limit: an invalid value shows a linked hint and sends nothing', async () => {
    serve()
    wrap()
    open('kid-4')
    const max = await screen.findByRole('textbox', { name: 'Leo daily limit (min)' })
    await userEvent.type(max, '50')
    await userEvent.tab()
    const err = screen.getByText('Use steps of 15.')
    expect(max.getAttribute('aria-describedby')).toContain(err.id)
    expect(sent('PUT')).toHaveLength(0)
  })

  test('kid with a limit: values shown, Remove limit deletes', async () => {
    serve()
    wrap()
    open('kid-5')
    expect(await screen.findByRole('textbox', { name: 'Ava daily limit (min)' })).toHaveValue('60')
    expect(screen.getByRole('textbox', { name: 'Ava not allowed until (pts)' })).toHaveValue('20')
    expect(screen.getByText('60 pts · up to 45 min · saved 10 min')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove limit for Ava' }))
    await waitFor(() => expect(sent('DELETE')[0][0]).toBe('/screen-time/limits/5'))
  })

  test('clearing both fields of a limit asks to use Remove limit', async () => {
    serve()
    wrap()
    open('kid-5')
    const max = await screen.findByRole('textbox', { name: 'Ava daily limit (min)' })
    await userEvent.clear(max)
    await userEvent.clear(screen.getByRole('textbox', { name: 'Ava not allowed until (pts)' }))
    await userEvent.tab()
    expect(screen.getByText(/Remove limit/, { selector: 'p' })).toBeInTheDocument()
    expect(sent('PUT')).toHaveLength(0)
  })

  test('Esc with a typed price saves it first', async () => {
    serve()
    wrap()
    await screen.findByText('Rules')
    open('price')
    const f = await screen.findByRole('textbox', { name: 'Points per 15 min' })
    await userEvent.clear(f)
    await userEvent.type(f, '25')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(sent('PATCH')[0]).toEqual(['/screen-time', { method: 'PATCH', body: { price: 25 } }]))
  })

  test('Esc after typing in the kid pair saves it', async () => {
    serve()
    wrap()
    open('kid-4')
    await userEvent.type(await screen.findByRole('textbox', { name: 'Leo daily limit (min)' }), '45')
    await userEvent.tab()
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(sent('PUT')[0]).toEqual(['/screen-time/limits/4', { method: 'PUT', body: { max_minutes: 45, min_points: null } }]))
  })

  test('the kid row summary updates after a limit save', async () => {
    serve()
    wrap()
    open('kid-4')
    await userEvent.type(await screen.findByRole('textbox', { name: 'Leo daily limit (min)' }), '45')
    await userEvent.tab()
    await userEvent.tab()
    await waitFor(() => expect(screen.getByRole('button', { name: /^Leo.*45 min\/day/ })).toBeInTheDocument())
  })

  test('placeholders show the family max and any time', async () => {
    serve()
    wrap()
    open('kid-4')
    expect(await screen.findByRole('textbox', { name: 'Leo daily limit (min)' })).toHaveAttribute('placeholder', '120 (family)')
    expect(screen.getByRole('textbox', { name: 'Leo not allowed until (pts)' })).toHaveAttribute('placeholder', 'any time')
  })

  test('the header switch name carries its visible state', async () => {
    serve()
    wrap()
    const sw = await screen.findByRole('switch', { name: /^On, kids can buy extra minutes$/i })
    expect(sw).toBeChecked()
    expect(sw.closest('.mantine-Switch-root')).toHaveTextContent('On') // the visible label is inside the name
  })

  test('a stale open kid is closed', async () => {
    serve()
    wrap()
    await screen.findByText('Rules')
    open('kid-99')
    await waitFor(() => expect(fakeRouter.query.open).toBeUndefined())
  })
})
