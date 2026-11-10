import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import type { ReactNode } from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fridgeTheme } from '@/v2/theme'
import { api } from '@/v2/api'
import { ChoreDetail, clearChoreDrafts } from '@/v2/manage/ChoreDetail'
import { ChoresList } from '@/v2/manage/ChoresList'
import type { ChoreType, Kid, LibChore } from '@/v2/types'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))

const apiMock = api as unknown as Mock<(p: string, init?: { method?: string; body?: unknown }) => Promise<unknown>>
const calls = (method: string) => apiMock.mock.calls.filter(([, i]) => i?.method === method)

const kids: Kid[] = [{ id: 7, full_name: 'Maya', username: 'kid-maya', avatar: null, has_pin: false }]
const type = (id: number, name: string, glyph: string, notes: string[] = []): ChoreType => ({
  id,
  name,
  glyph,
  builtin: true,
  notes: notes.map((label, i) => ({ id: id * 10 + i, label, glyph })),
  chore_count: 0,
})
const types = [type(1, 'Schoolwork', 'school', ["Don't understand it"]), type(2, 'Pets', 'pets', ['Out of pet food']), type(3, 'Other', 'task_alt')]
const chore = (over: Partial<LibChore> = {}): LibChore => ({
  id: 5,
  title: 'Homework',
  points: 30,
  needs_photo: false,
  type_id: 1,
  steps: [
    { id: 1, title: 'Math worksheet', due_time: '16:30', after_previous: false },
    { id: 2, title: 'Pack backpack', due_time: null, after_previous: false },
  ],
  assignments: [
    { id: 11, chore_id: 5, kid_ids: [7], mode: 'each', repeat: { type: 'daily', days: [] }, on_date: null, due_time: '18:00', active: true },
  ],
  ...over,
})

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  global.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

beforeEach(() => {
  clearChoreDrafts()
  apiMock.mockReset().mockImplementation(async (path) => (path === '/chore-types' ? types : {}))
})

/** Open the editor with row `open` (one row is open at a time; the others are click targets). */
const show = async (c: LibChore = chore(), open = 'basics') => {
  fakeRouter.reset('/kids', { section: 'chores', item: String(c.id), open })
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider theme={fridgeTheme} env="test">
        <ChoreDetail kids={kids} chore={c} onSelect={jest.fn()} />
      </MantineProvider>
    </QueryClientProvider>,
  )
  await screen.findAllByRole('button', { name: /Schoolwork/ }) // types have landed
}
const row = (id: string) => document.querySelector<HTMLElement>(`[data-focus-head="${id}"]`)!
const saveBody = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Save chore' }))
  await waitFor(() => expect(calls('PATCH')).toHaveLength(1))
  return calls('PATCH')[0][1]!.body as { type_id: number; steps: { after_previous: boolean }[] }
}

describe('chore editor: type, steps, notes', () => {
  test('picking Pets then saving sends type_id', async () => {
    await show()
    expect(screen.getByRole('group', { name: 'Type' }).querySelector('[aria-pressed="true"]')).toHaveTextContent('Schoolwork')
    await userEvent.click(within(screen.getByRole('group', { name: 'Type' })).getByRole('button', { name: 'Pets' }))
    await userEvent.click(screen.getByRole('button', { name: /type, notes kids can send/ }))
    expect(await screen.findByText("From the Pets type. Kids pick one when they're stuck.")).toBeInTheDocument()
    expect(screen.getByText('Out of pet food')).toBeInTheDocument()
    expect((await saveBody()).type_id).toBe(2)
  })

  test('toggling the link between step 1 and 2 sends after_previous: true for step 2', async () => {
    await show(chore(), 'steps')
    const link = screen.getByRole('button', { name: 'Any order' })
    expect(link).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(link)
    expect(screen.getByRole('button', { name: 'Must be done after the step above' })).toHaveAttribute('aria-pressed', 'true')
    expect((await saveBody()).steps.map((s) => s.after_previous)).toEqual([false, true])
  })

  test('two assignments with different due times: opening is clean and saving keeps both', async () => {
    const two = chore({
      assignments: [
        { id: 11, chore_id: 5, kid_ids: [7], mode: 'each', repeat: { type: 'daily', days: [] }, on_date: null, due_time: '20:00', active: true },
        { id: 12, chore_id: 5, kid_ids: [7], mode: 'each', repeat: { type: 'weekly', days: [5, 6] }, on_date: null, due_time: '07:30', active: true },
      ],
    })
    await show(two, 'opts')
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull()
    expect(screen.getByText(/Kids have different times/)).toBeInTheDocument()
    expect(screen.getByText('Schoolwork · 30 pts · daily + weekends · Maya')).toBeInTheDocument()
    await userEvent.click(row('basics'))
    await userEvent.clear(screen.getByLabelText('Points'))
    await userEvent.type(screen.getByLabelText('Points'), '40')
    await userEvent.click(screen.getByRole('button', { name: 'Save chore' }))
    await waitFor(() => expect(calls('PATCH')).toHaveLength(1))
    expect(calls('PATCH')[0][0]).toBe('/chores/5')
  })

  test('editing Due by applies it to every assignment', async () => {
    const two = chore({
      assignments: [
        { id: 11, chore_id: 5, kid_ids: [7], mode: 'each', repeat: { type: 'daily', days: [] }, on_date: null, due_time: '20:00', active: true },
        { id: 12, chore_id: 5, kid_ids: [7], mode: 'each', repeat: { type: 'weekly', days: [5, 6] }, on_date: null, due_time: '07:30', active: true },
      ],
    })
    await show(two, 'opts')
    fireEvent.change(screen.getByLabelText('Due by (optional)'), { target: { value: '19:00' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save chore' }))
    await waitFor(() => expect(calls('PATCH')).toHaveLength(3))
    const bodies = calls('PATCH').slice(1).map(([, i]) => (i!.body as { due_time: string }).due_time)
    expect(bodies).toEqual(['19:00', '19:00'])
  })

  test('a step due after the chore shows the warning', async () => {
    await show(chore(), 'steps')
    await userEvent.click(screen.getByRole('button', { name: 'Due time, due time for Pack backpack' }))
    fireEvent.change(screen.getByLabelText('Due time for Pack backpack'), { target: { value: '20:30' } })
    expect(
      screen.getByText('“Pack backpack” is due after the chore (6:00 PM). The chore will stay open until 8:30 PM.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'by 4:30 PM, due time for Math worksheet' })).toHaveTextContent('by 4:30 PM')
  })

  test('the type tile pop-over lists the type notes and the universal notes', async () => {
    await show()
    await userEvent.click(screen.getByRole('button', { name: /type, notes kids can send/ }))
    expect(await screen.findByText('Notes kids can send')).toBeInTheDocument()
    for (const n of ["Don't understand it", 'Need help', 'Ran out of time', "Can't do it today"]) {
      expect(screen.getByText(n)).toBeInTheDocument()
    }
  })

  test('list groups by type, Other last, and a chore of an unknown type joins Other', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider theme={fridgeTheme}>
          <ChoresList kids={kids} onSelect={jest.fn()} chores={[chore({ id: 1, type_id: 3, title: 'A' }), chore({ id: 2, type_id: 99, title: 'B' }), chore({ id: 3, type_id: 2, title: 'C' })]} />
        </MantineProvider>
      </QueryClientProvider>,
    )
    await screen.findByText('Pets')
    expect(screen.getAllByText('Other')).toHaveLength(1)
    const text = document.body.textContent!
    expect(text.indexOf('Pets')).toBeLessThan(text.indexOf('Other'))
  })

  test('Other is found by rule (last builtin), so a renamed Other still sorts last and takes unknown types', async () => {
    const renamed = [type(3, 'Misc', 'task_alt'), type(1, 'Schoolwork', 'school'), type(2, 'Pets', 'pets'), { ...type(9, 'Laundry', 'local_laundry_service'), builtin: false }]
    apiMock.mockImplementation(async (path) => (path === '/chore-types' ? renamed : {}))
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider theme={fridgeTheme}>
          <ChoresList kids={kids} onSelect={jest.fn()} chores={[chore({ id: 1, type_id: 3, title: 'A' }), chore({ id: 2, type_id: 99, title: 'B' }), chore({ id: 3, type_id: 9, title: 'C' })]} />
        </MantineProvider>
      </QueryClientProvider>,
    )
    await screen.findByText('Misc')
    expect(screen.queryByText('Other')).toBeNull()
    const text = document.body.textContent!
    expect(text.indexOf('Laundry')).toBeLessThan(text.indexOf('Misc'))
    expect(text.slice(text.indexOf('Misc'))).toMatch(/Misc.*2/)
  })
})

describe('chore editor: Always check', () => {
  test('the switch sends always_check on save', async () => {
    await show(chore(), 'opts')
    const sw = screen.getByRole('switch', { name: 'Always check' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(sw)
    expect(((await saveBody()) as unknown as { always_check: boolean }).always_check).toBe(true)
  })

  test('a chore already set shows it on', async () => {
    await show(chore({ always_check: true }), 'opts')
    expect(screen.getByRole('switch', { name: 'Always check' })).toHaveAttribute('aria-checked', 'true')
  })
})
