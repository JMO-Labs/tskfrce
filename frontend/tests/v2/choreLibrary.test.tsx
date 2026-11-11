import { describe, expect, test } from '@jest/globals'
import type { ReactNode } from 'react'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KidsPage } from '@/v2/manage/KidsPage'
import {
  apiMock,
  calls,
  defs,
  detail,
  kids,
  lib,
  asg,
  list,
  nav,
  serve,
  setupLibrary,
  who,
  wrap,
} from './libraryHelpers'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}))
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@/v2/parent/ParentShell', () => ({
  ParentShell: ({
    list,
    children,
  }: {
    list: ReactNode
    children: ReactNode
  }) => (
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

const { push, replace } = fakeRouter
setupLibrary()

/** Open the Kids & chores page at ?query (one editor row is open at a time: pass open=...). */
const show = async (q: Record<string, string>) => {
  fakeRouter.reset('/kids', q)
  render(wrap(<KidsPage />))
  await within(list()).findByText('Trash')
  await within(list()).findAllByRole('button', { name: /Clean room/ })
}
/** Open an editor row by tapping its head. */
const row = async (id: string) => userEvent.click(document.querySelector<HTMLElement>(`[data-focus-head="${id}"]`)!)

describe('tabs and list', () => {
  test('default is chores with the tab pressed; a tab click replaces ?section', async () => {
    await show({})
    const tabs = within(list()).getByRole('group', { name: 'Section' })
    expect(
      within(tabs).getByRole('button', { name: 'Chores · 3' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await userEvent.click(
      within(tabs).getByRole('button', { name: 'Kids · 2' }),
    )
    expect(replace).toHaveBeenCalledWith({
      pathname: '/kids',
      query: { section: 'kids' },
    })
  })

  test('chore cards show the summary line and letter avatars', async () => {
    await show({})
    const card = within(list()).getByRole('button', { name: /Clean room/ })
    expect(card).toHaveTextContent('15 pts · daily · 2 steps')
    expect(within(list()).getAllByRole('img', { name: 'Leo' })).toHaveLength(1)
    expect(within(card).getByRole('img', { name: 'Maya' })).toHaveTextContent(
      'M',
    )
    expect(apiMock).toHaveBeenCalledWith('/chores/')
  })

  test('clicking a card selects it with ?item; the dashed card starts a new chore', async () => {
    await show({})
    await userEvent.click(
      within(list()).getByRole('button', { name: /Trash/ }),
    )
    expect(push).toHaveBeenLastCalledWith(
      ...nav({ section: 'chores', item: 6 }),
    )
    await userEvent.click(
      within(list()).getByRole('button', { name: 'New chore' }),
    )
    expect(push).toHaveBeenLastCalledWith(
      ...nav({ section: 'chores', item: 'new' }),
    )
  })

  test('desktop opens the first chore when nothing is picked', async () => {
    await show({})
    expect(detail()).toHaveTextContent('Clean room')
  })
})

describe('chore detail', () => {
  test('header shows one summary line (points, schedule, who), no photo chip', async () => {
    await show({ item: '6' })
    expect(
      within(detail()).getByRole('heading', { name: 'Trash' }),
    ).toBeInTheDocument()
    expect(within(detail()).getByText('15 pts · daily · Maya, Leo')).toBeInTheDocument()
    expect(within(detail()).queryByText('Needs photo')).toBeNull()
  })

  test('create POSTs chore fields only, then selects the new chore', async () => {
    apiMock.mockImplementation(async (path, init) => {
      if (init?.method === 'POST' && path === '/chores/')
        return lib({ id: 20, title: 'Laundry', assignments: [], steps: [] })
      if (path === '/kids') return kids
      if (path === '/chores/') return defs
      if (path === '/today') return { kids: [] }
      return []
    })
    await show({ item: 'new' })
    await userEvent.type(
      await within(detail()).findByLabelText('Chore name'), // Basics opens on its own for a new chore
      'Laundry',
    )
    await row('who')
    expect(within(who()).getByText(/Save the chore first/)).toBeInTheDocument()
    await row('steps')
    for (const s of ['Fold clothes', 'Make bed']) {
      await userEvent.type(
        within(detail()).getByLabelText('Add a step'),
        `${s}{Enter}`,
      )
    }
    await row('opts')
    await userEvent.click(
      within(detail()).getByRole('switch', { name: 'Needs a photo' }),
    )
    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Save chore' }),
    )
    await waitFor(() =>
      expect(calls('POST')[0]).toEqual([
        '/chores/',
        {
          method: 'POST',
          body: {
            title: 'Laundry',
            points: 10,
            needs_photo: true,
            always_check: false,
            type_id: undefined,
            steps: [
              { title: 'Fold clothes', due_time: null, after_previous: false },
              { title: 'Make bed', due_time: null, after_previous: false },
            ],
          },
        },
      ]),
    )
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(
        ...nav({ section: 'chores', item: 20 }),
      ),
    )
  })

  test('saving PATCHes only chore fields, with reordered steps', async () => {
    await show({ item: '5', open: 'steps' })
    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Move down Fold clothes' }),
    )
    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Save chore' }),
    )
    await waitFor(() => expect(calls('PATCH')).toHaveLength(1))
    expect(calls('PATCH')[0]).toEqual([
      '/chores/5',
      {
        method: 'PATCH',
        body: {
          title: 'Clean room',
          points: 15,
          needs_photo: false,
          always_check: false,
          type_id: undefined,
          steps: [
            { title: 'Make bed', due_time: null, after_previous: false },
            { title: 'Fold clothes', due_time: null, after_previous: false },
          ],
        },
      },
    ])
  })

  test('saving keeps existing step deadlines and chaining', async () => {
    const steps = [
      { id: 1, title: 'A', due_time: '16:30', after_previous: false },
      { id: 2, title: 'B', after_previous: true },
    ]
    serve({ '/chores/': [{ ...defs[0], steps }, ...defs.slice(1)] })
    await show({ item: String(defs[0].id), open: 'basics' })
    const pts = within(detail()).getByLabelText('Points')
    await userEvent.clear(pts)
    await userEvent.type(pts, '20')
    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Save chore' }),
    )
    await waitFor(() => expect(calls('PATCH')).toHaveLength(1))
    expect(calls('PATCH')[0][1].body.steps).toEqual([
      { title: 'A', due_time: '16:30', after_previous: false },
      { title: 'B', due_time: null, after_previous: true },
    ])
  })

  test.each([
    ['-3', 'Cannot be negative.'],
    ['2.5', 'Use a whole number.'],
    ['abc', 'Numbers only.'],
    ['', 'Enter a number.'],
  ])(
    'points "%s" shows "%s" inline and blocks Save without a request',
    async (value, msg) => {
      await show({ item: '5', open: 'basics' })
      const pts = within(detail()).getByLabelText('Points')
      await userEvent.clear(pts)
      if (value) await userEvent.type(pts, value)
      expect(within(detail()).getByText(msg)).toBeInTheDocument()
      expect(
        within(detail()).getByRole('button', { name: 'Save chore' }),
      ).toBeDisabled()
      expect(calls('PATCH')).toHaveLength(0)
    },
  )

  test('a 21st step is refused (backend allows 20) and the 100-char step limit is set', async () => {
    const steps = Array.from({ length: 20 }, (_, i) => ({
      id: i + 1,
      title: `S${i}`,
      position: i,
    }))
    serve({ '/chores/': [{ ...defs[0], steps }, ...defs.slice(1)] })
    await show({ item: String(defs[0].id), open: 'steps' })
    expect(within(detail()).getByLabelText('Add a step')).toBeDisabled()
    await userEvent.click(within(detail()).getByRole('button', { name: 'How steps work' }))
    expect(await screen.findByText(/20 of 20 steps/)).toBeInTheDocument()
  })

  test('a half-typed new chore survives switching away and back, and is gone after Cancel', async () => {
    await show({ item: 'new' })
    await userEvent.type(
      within(detail()).getByLabelText('Chore name'),
      'Water plants',
    )
    cleanup()
    await show({ item: 'new' })
    expect(within(detail()).getByLabelText('Chore name')).toHaveValue(
      'Water plants',
    )
    expect(
      within(detail()).getByText('Unsaved changes (restored)'),
    ).toBeInTheDocument()
    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Cancel' }),
    )
    cleanup()
    await show({ item: 'new' })
    expect(within(detail()).getByLabelText('Chore name')).toHaveValue('')
  })

  test('Enter in "Add a step" adds it and flags unsaved changes; step buttons have tooltips', async () => {
    await show({ item: '5', open: 'steps' })
    expect(within(detail()).queryByText('Unsaved changes')).toBeNull()
    await userEvent.type(
      within(detail()).getByLabelText('Add a step'),
      'Wipe desk{Enter}',
    )
    expect(within(detail()).getByDisplayValue('Wipe desk')).toBeInTheDocument()
    expect(within(detail()).getByText('Unsaved changes')).toBeInTheDocument()
    expect(
      within(detail()).getByRole('button', { name: 'Remove Wipe desk' }),
    ).toHaveAttribute('title', 'Remove step')
    expect(
      within(detail()).getByRole('button', { name: 'Move up Wipe desk' }),
    ).toHaveAttribute('title', 'Move up')
  })

  test('Assign posts AssignmentIn with exact keys; mode hidden with one kid', async () => {
    await show({ item: '9', open: 'who' })
    expect(
      within(who()).getByText(/Nobody has this chore yet/),
    ).toBeInTheDocument()
    await userEvent.click(within(who()).getByRole('button', { name: 'Maya' }))
    expect(within(who()).queryByRole('group', { name: 'Mode' })).toBeNull()
    expect(within(who()).queryByLabelText('Due by (optional)')).toBeNull()
    expect(within(who()).queryByRole('button', { name: 'Save' })).toBeNull()
    await row('opts') // Who & when keeps its pick while another row is open
    fireEvent.change(within(detail()).getByLabelText('Due by (optional)'), {
      target: { value: '17:00' },
    })
    await userEvent.click(within(detail()).getByRole('button', { name: 'Save chore' }))
    await waitFor(() =>
      expect(calls('POST')[0]).toEqual([
        '/chores/9/assignments',
        {
          method: 'POST',
          body: {
            kid_ids: [7],
            mode: 'each',
            repeat: { type: 'daily', days: [] },
            on_date: null,
            due_time: '17:00',
          },
        },
      ]),
    )
  })

  test('two kids show the mode control; its hints live in one (i)', async () => {
    await show({ item: '9', open: 'who' })
    await userEvent.click(within(who()).getByRole('button', { name: 'Maya' }))
    await userEvent.click(within(who()).getByRole('button', { name: 'Leo' }))
    expect(within(who()).queryByText(/own copy and points/)).toBeNull()
    await userEvent.click(within(who()).getByRole('button', { name: 'About sharing' }))
    expect(await screen.findByText(/every kid gets their own copy and points/)).toBeInTheDocument()
    expect(screen.getByText(/first to finish gets the points/)).toBeInTheDocument()
    expect(screen.getByText(/done together, points shared/)).toBeInTheDocument()
    await userEvent.click(
      within(who()).getByRole('button', { name: 'First one wins' }),
    )
    expect(within(who()).getByRole('button', { name: 'First one wins' })).toHaveAttribute('aria-pressed', 'true')
  })

  test('Some days shows weekday circles; Save sends the chosen days', async () => {
    await show({ item: '9', open: 'who' })
    await userEvent.click(within(who()).getByRole('button', { name: 'Maya' }))
    await userEvent.click(
      within(who()).getByRole('button', { name: 'Some days' }),
    )
    const save = within(detail()).getByRole('button', { name: 'Save chore' })
    expect(save).toBeDisabled()
    const wed = within(who()).getByRole('button', { name: 'Wednesday' })
    await userEvent.click(
      within(who()).getByRole('button', { name: 'Monday' }),
    )
    await userEvent.click(wed)
    expect(wed).toHaveAttribute('aria-pressed', 'true')
    expect(wed).toHaveTextContent('W')
    await userEvent.click(save)
    await waitFor(() =>
      expect(calls('POST')[0][1]?.body).toMatchObject({
        repeat: { type: 'weekly', days: [0, 2] },
      }),
    )
  })

  test('One time needs a date before Save is enabled', async () => {
    await show({ item: '9', open: 'who' })
    await userEvent.click(within(who()).getByRole('button', { name: 'Maya' }))
    await userEvent.click(
      within(who()).getByRole('button', { name: 'One time' }),
    )
    const save = within(detail()).getByRole('button', { name: 'Save chore' })
    expect(save).toBeDisabled()
    fireEvent.change(within(who()).getByLabelText('Date'), {
      target: { value: '2026-11-01' },
    })
    expect(save).toBeEnabled()
    await userEvent.click(save)
    await waitFor(() =>
      expect(calls('POST')[0][1]?.body).toMatchObject({
        repeat: { type: 'once', days: [] },
        on_date: '2026-11-01',
      }),
    )
  })

  test('editing an assignment PATCHes it; removing DELETEs it', async () => {
    await show({ item: '5', open: 'who' })
    expect(within(who()).getByRole('button', { name: 'Maya' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await userEvent.click(within(who()).getByRole('button', { name: 'Leo' }))
    await userEvent.click(within(detail()).getByRole('button', { name: 'Save chore' }))
    await waitFor(() => expect(calls('PATCH').some(([u]) => u === '/assignments/11')).toBe(true))
    await userEvent.click(
      within(who()).getByRole('button', { name: 'Remove' }),
    )
    const confirm = await screen.findByRole('dialog', {
      name: 'Remove this assignment?',
    })
    await userEvent.click(
      within(confirm).getByRole('button', { name: 'Remove' }),
    )
    await waitFor(() =>
      expect(calls('DELETE')[0]).toEqual([
        '/assignments/11',
        { method: 'DELETE' },
      ]),
    )
  })

  test('a step can be renamed in place and the new name is saved', async () => {
    await show({ item: '5', open: 'steps' })
    await userEvent.type(within(detail()).getByLabelText('Add a step'), 'Wipe desk{Enter}')
    const name = within(detail()).getByLabelText('Step 1 name')
    await userEvent.clear(name)
    await userEvent.type(name, 'Dust shelf')
    await userEvent.click(within(detail()).getByRole('button', { name: 'Save chore' }))
    await waitFor(() => expect(calls('PATCH').some(([, i]) => JSON.stringify(i?.body).includes('Dust shelf'))).toBe(true))
  })

  test('Duplicate POSTs /copy', async () => {
    await show({ item: '5' })
    await userEvent.click(within(detail()).getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Duplicate' }))
    await waitFor(() =>
      expect(calls('POST')[0]).toEqual(['/chores/5/copy', { method: 'POST' }]),
    )
  })

  test('Delete asks first, says history stays, then DELETEs and closes the detail', async () => {
    await show({ item: '5' })
    await userEvent.click(within(detail()).getByRole('button', { name: 'More' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete chore' }))
    expect(calls('DELETE')).toHaveLength(0)
    const confirm = await screen.findByRole('dialog', {
      name: 'Delete Clean room?',
    })
    expect(
      within(confirm).getByText('Its history, photos and chat go too. Points already earned stay.'),
    ).toBeInTheDocument()
    await userEvent.click(
      within(confirm).getByRole('button', { name: 'Delete' }),
    )
    await waitFor(() =>
      expect(calls('DELETE')[0]).toEqual(['/chores/5', { method: 'DELETE' }]),
    )
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(...nav({ section: 'chores' })),
    )
  })
})
