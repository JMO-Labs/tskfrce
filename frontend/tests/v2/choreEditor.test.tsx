import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fridgeTheme } from '@/v2/theme'
import { api } from '@/v2/api'
import { ChoreDetail, clearChoreDrafts } from '@/v2/manage/ChoreDetail'
import { KidsPage } from '@/v2/manage/KidsPage'
import { choreHeadLine, optionsOn, stepsSummary } from '@/v2/manage/choreMeta'
import type { ChoreType, Kid, LibChore } from '@/v2/types'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
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

const apiMock = api as unknown as Mock<(p: string, init?: { method?: string; body?: unknown }) => Promise<unknown>>
const calls = (method: string) => apiMock.mock.calls.filter(([, i]) => i?.method === method)

const kids: Kid[] = [
  { id: 7, full_name: 'Maya', username: 'kid-maya', avatar: null, has_pin: false },
  { id: 8, full_name: 'Leo', username: 'kid-leo', avatar: null, has_pin: false },
]
const types: ChoreType[] = [
  { id: 1, name: 'School', glyph: 'school', builtin: true, notes: [{ id: 10, label: "Don't understand it", glyph: 'help' }], chore_count: 2 },
  { id: 3, name: 'Other', glyph: 'task_alt', builtin: true, notes: [], chore_count: 0 },
]
const asg = (id: number, choreId: number) => ({ id, chore_id: choreId, kid_ids: [7, 8], mode: 'each' as const, repeat: { type: 'daily' as const, days: [] }, on_date: null, due_time: '18:00', active: true })
const chore = (id: number, title: string): LibChore => ({
  id,
  title,
  points: 30,
  needs_photo: false,
  type_id: 1,
  steps: [
    { id: 1, title: 'Math sheet', due_time: null, after_previous: false },
    { id: 2, title: 'Reading', due_time: null, after_previous: true },
    { id: 3, title: 'Pack bag', due_time: null, after_previous: true },
  ],
  assignments: [asg(id + 100, id)],
})
const library = [chore(404, 'Homework'), chore(405, 'Dishes')]

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
  global.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
  Element.prototype.scrollIntoView = jest.fn()
})
beforeEach(() => {
  clearChoreDrafts()
  apiMock.mockReset().mockImplementation(async (path) => {
    if (path === '/chore-types') return types
    if (path === '/kids') return kids
    if (path === '/chores/') return library
    if (path === '/today') return { kids: [] }
    return {}
  })
})

const wrapUi = (ui: ReactNode) => (
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <MantineProvider theme={fridgeTheme} env="test">{ui}</MantineProvider>
  </QueryClientProvider>
)
const editor = async (query: Record<string, string> = {}, c: LibChore | null = library[0]) => {
  fakeRouter.reset('/kids', { section: 'chores', item: String(c?.id ?? 'new'), ...query })
  const view = render(wrapUi(<ChoreDetail kids={kids} chore={c ?? undefined} onSelect={jest.fn()} />))
  await screen.findAllByText(/pts/)
  if (c) await screen.findAllByRole('button', { name: /School type, notes kids can send/ }) // the type chip: types have landed
  return view
}
const head = (id: string) => document.querySelector<HTMLElement>(`[data-focus-head="${id}"]`)!
const page = async (query: Record<string, string>) => {
  fakeRouter.reset('/kids', { section: 'chores', ...query })
  render(wrapUi(<KidsPage />))
  await within(screen.getByTestId('detail')).findByRole('heading', { name: /Homework|New chore/ })
  await within(screen.getByTestId('list')).findByText('School') // the list regroups when types land; clicks before that are lost
}

describe('helpers', () => {
  test('stepsSummary', () => {
    const s = (...after: boolean[]) => after.map((a, i) => ({ title: `s${i}`, due_time: null, after_previous: a }))
    expect(stepsSummary([])).toBe('No steps')
    expect(stepsSummary(s(false))).toBe('1 step')
    expect(stepsSummary(s(false, true, true))).toBe('3 steps, in order')
    expect(stepsSummary(s(false, false, false))).toBe('3 steps, any order')
    expect(stepsSummary(s(false, true, false))).toBe('3 steps, some in order')
  })
  test('optionsOn and choreHeadLine', () => {
    expect(optionsOn({ due: '', photo: false, check: false })).toBe(0)
    expect(optionsOn({ due: '18:00', photo: true, check: true })).toBe(3)
    expect(choreHeadLine('School', 30, 'daily', 'Maya, Leo')).toBe('School · 30 pts · daily · Maya, Leo')
    expect(choreHeadLine(undefined, 10, '', '')).toBe('10 pts')
  })
})

describe('calm, then focus', () => {
  test('calm: header line, four rows with summaries, no Save until a change', async () => {
    await editor()
    expect(screen.getByRole('heading', { name: 'Homework', level: 2 })).toBeInTheDocument()
    expect(await screen.findByText('School · 30 pts · daily · Maya, Leo')).toBeInTheDocument()
    for (const id of ['basics', 'steps', 'who', 'opts']) expect(head(id)).toBeInTheDocument()
    expect(head('basics')).toHaveTextContent('School · 30 pts')
    expect(head('steps')).toHaveTextContent('3 steps, in order')
    expect(head('who')).toHaveTextContent('Maya, Leo · daily')
    expect(head('opts')).toHaveTextContent('1 on')
    expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull()
  })

  test('Steps opens as the form; legend lives in one (i)', async () => {
    await editor({ open: 'steps' })
    expect(screen.getByLabelText('Step 1 name')).toHaveValue('Math sheet')
    expect(screen.queryByText(/tap between steps/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'How steps work' }))
    expect(await screen.findByText(/3 of 20 steps used\./)).toBeInTheDocument()
    expect(screen.getByText('must go in order')).toBeInTheDocument()
  })

  test('type chip pop-over holds the notes kids can send', async () => {
    await editor()
    await userEvent.click(await screen.findByRole('button', { name: /School type, notes kids can send/ }))
    expect(await screen.findByText('Notes kids can send')).toBeInTheDocument()
    expect(screen.getByText("From the School type. Kids pick one when they're stuck.")).toBeInTheDocument()
    for (const n of ["Don't understand it", 'Need help', 'Ran out of time']) expect(screen.getByText(n)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Edit School type' })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Notes' })).toBeNull()
  })

  test('Duplicate and Delete are only in the … menu', async () => {
    await editor()
    expect(screen.queryByRole('button', { name: 'Duplicate' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: 'More' }))
    expect((await screen.findAllByRole('menuitem')).map((e) => e.textContent)).toEqual(['content_copyDuplicate', 'deleteDelete chore'])
    await userEvent.click(await screen.findByRole('menuitem', { name: /Delete chore/ }))
    expect(await screen.findByRole('dialog', { name: 'Delete Homework?' })).toBeInTheDocument()
  })

  test('editing shows the Save bar; Save chore sends chore and assignments once', async () => {
    await editor({ open: 'basics' })
    await userEvent.clear(screen.getByLabelText('Points'))
    await userEvent.type(screen.getByLabelText('Points'), '40')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeInTheDocument()
    await userEvent.click(head('who'))
    await userEvent.click(await screen.findByRole('button', { name: 'Leo' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save chore' }))
    await waitFor(() => expect(calls('PATCH')).toHaveLength(2))
    expect(calls('PATCH').map(([p]) => p)).toEqual(['/chores/404', '/assignments/504'])
  })

  test('the type chip announces a pop-over', async () => {
    await editor()
    const chip = await screen.findByRole('button', { name: 'School type, notes kids can send' })
    expect(chip).toHaveAttribute('aria-haspopup', 'dialog')
    expect(chip).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(chip)
    expect(chip).toHaveAttribute('aria-expanded', 'true')
  })

  test('an unfinished Who & when form in a closed row says why Save is off', async () => {
    await editor({ open: 'who' })
    await userEvent.click(await screen.findByRole('button', { name: 'Some days' }))
    await userEvent.click(head('opts'))
    expect(screen.getByText('Finish Who & when to save')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save chore' })).toBeDisabled()
  })

  test('Edit type in the chip pop-over opens the type panel', async () => {
    await editor()
    await userEvent.click(await screen.findByRole('button', { name: /School type, notes kids can send/ }))
    await userEvent.click(await screen.findByRole('button', { name: 'Edit School type' }))
    expect(await screen.findByDisplayValue('School')).toBeInTheDocument()
  })

  test('Who & when uses KidPicker', async () => {
    await editor({ open: 'who' })
    const group = await screen.findByRole('group', { name: 'Assign to' })
    expect(within(group).getByRole('button', { name: 'Maya' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(group).getByRole('button', { name: 'Leo' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'About sharing' })).toBeInTheDocument()
  })

  test('Who & when edits survive switching rows, with no prompt', async () => {
    await editor({ open: 'who' })
    await userEvent.click(await screen.findByRole('button', { name: 'Leo' }))
    await userEvent.click(head('opts'))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeInTheDocument()
    await userEvent.click(head('who'))
    expect(await screen.findByRole('button', { name: 'Leo' })).toHaveAttribute('aria-pressed', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'Save chore' }))
    await waitFor(() => expect(calls('PATCH').map(([p]) => p)).toContain('/assignments/504'))
    expect((calls('PATCH').find(([p]) => p === '/assignments/504')![1]!.body as { kid_ids: number[] }).kid_ids).toEqual([7])
  })

  test('closing a pushed row in a dirty chore needs no prompt and keeps the edits', async () => {
    await editor()
    await userEvent.click(head('basics'))
    await waitFor(() => expect(fakeRouter.query.open).toBe('basics'))
    await userEvent.type(screen.getByLabelText('Chore name'), ' x')
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeInTheDocument()
    await userEvent.click(head('basics'))
    await waitFor(() => expect(fakeRouter.query.open).toBeUndefined())
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeInTheDocument()
  })

  test('Options holds Due by and two switches with (i) help', async () => {
    await editor({ open: 'opts' })
    expect(screen.getByLabelText(/Due by/)).toHaveValue('18:00')
    expect(screen.getByRole('switch', { name: 'Needs a photo' })).toHaveAttribute('aria-checked', 'false')
    await userEvent.click(screen.getByRole('button', { name: 'About photos' }))
    expect(await screen.findByText(/You see it with the Approve button/)).toBeInTheDocument()
  })

  test('new chore opens Basics with replace, no history entry', async () => {
    await editor({}, null)
    await waitFor(() => expect(fakeRouter.replace).toHaveBeenCalled())
    expect(fakeRouter.query.open).toBe('basics')
    expect(fakeRouter.push).not.toHaveBeenCalled()
    expect(fakeRouter.stack).toHaveLength(1)
  })
})

describe('Due by only touches assignments whose time changes', () => {
  test('the assignment already at the new time is not PATCHed', async () => {
    const two = { ...library[0], assignments: [{ ...asg(504, 404), due_time: '18:00' }, { ...asg(505, 404), due_time: '07:30' }] }
    await editor({ open: 'opts' }, two)
    fireEvent.change(screen.getByLabelText(/Due by/), { target: { value: '07:30' } })
    await userEvent.click(screen.getByRole('button', { name: 'Save chore' }))
    await waitFor(() => expect(calls('PATCH').map(([p]) => p)).toEqual(['/chores/404', '/assignments/504']))
  })
})

describe('leaving with unsaved edits', () => {
  const dirty = async (query = { item: '404', open: 'basics' }) => {
    await page(query)
    await userEvent.type(screen.getByLabelText('Chore name'), 'x')
  }

  test('picking another chore while dirty asks Discard changes? once', async () => {
    await dirty()
    fakeRouter.push.mockClear()
    await userEvent.click(within(screen.getByTestId('list')).getByRole('button', { name: /Dishes/ }))
    const d = await screen.findByRole('dialog', { name: 'Discard changes?' })
    expect(fakeRouter.push).not.toHaveBeenCalled()
    await userEvent.click(within(d).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(fakeRouter.query.item).toBe('405'))
    await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0))
  })

  test('Discard drops the draft', async () => {
    await dirty()
    await userEvent.click(within(screen.getByTestId('list')).getByRole('button', { name: /Dishes/ }))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(fakeRouter.query.item).toBe('405'))
    await userEvent.click(within(screen.getByTestId('list')).getByRole('button', { name: /Homework/ }))
    await waitFor(() => expect(fakeRouter.query.item).toBe('404'))
    await userEvent.click(head('basics'))
    expect(await screen.findByLabelText('Chore name')).toHaveValue('Homework')
    expect(screen.queryByText('Unsaved changes (restored)')).toBeNull()
  })

  test('an in-app link asks once and Discard also drops the draft', async () => {
    await dirty()
    expect(() => fakeRouter.events.emit('routeChangeStart', '/devices')).toThrow(/cancelled/)
    const d = await screen.findByRole('dialog', { name: 'Discard changes?' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    await userEvent.click(within(d).getByRole('button', { name: 'Discard' }))
    expect(fakeRouter.push).toHaveBeenCalledWith('/devices')
    cleanup() // the draft is gone: coming back shows the saved name, not a restored one
    await page({ item: '404', open: 'basics' })
    expect(screen.getByLabelText('Chore name')).toHaveValue('Homework')
    expect(screen.queryByText('Unsaved changes (restored)')).toBeNull()
  })

  test('a failed Duplicate after Discard leaves no skip-the-prompt flag behind', async () => {
    apiMock.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') throw new Error('copy failed')
      if (path === '/chore-types') return types
      return path === '/kids' ? kids : path === '/chores/' ? library : { kids: [] }
    })
    await dirty()
    await userEvent.click(within(screen.getByTestId('detail')).getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(calls('POST')).toHaveLength(1))
    await userEvent.type(screen.getByLabelText('Chore name'), 'y')
    await userEvent.click(within(screen.getByTestId('list')).getByRole('button', { name: /Dishes/ }))
    expect(await screen.findByRole('dialog', { name: 'Discard changes?' })).toBeInTheDocument()
  })

  test('Duplicate while dirty asks once, then opens the copy', async () => {
    const copy = chore(406, 'Homework (copy)')
    apiMock.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') return copy
      if (path === '/chore-types') return types
      return path === '/kids' ? kids : path === '/chores/' ? [...library, copy] : { kids: [] }
    })
    await dirty()
    await userEvent.click(within(screen.getByTestId('detail')).getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))
    await userEvent.click(within(await screen.findByRole('dialog', { name: 'Discard changes?' })).getByRole('button', { name: 'Discard' }))
    await waitFor(() => expect(fakeRouter.query.item).toBe('406'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('a clean editor switches straight away', async () => {
    await page({ item: '404', open: 'basics' })
    fakeRouter.push.mockClear()
    await userEvent.click(within(screen.getByTestId('list')).getByRole('button', { name: /Dishes/ }))
    expect(fakeRouter.push).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  test('saving a new chore selects it without asking', async () => {
    const made = chore(406, 'Laundry')
    apiMock.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') return made
      if (path === '/chore-types') return types
      return path === '/kids' ? kids : path === '/chores/' ? [...library, made] : { kids: [] }
    })
    await page({ item: 'new' })
    await userEvent.type(await screen.findByLabelText('Chore name'), 'Laundry')
    await userEvent.click(screen.getByRole('button', { name: 'Save chore' }))
    await waitFor(() => expect(fakeRouter.query.item).toBe('406'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
