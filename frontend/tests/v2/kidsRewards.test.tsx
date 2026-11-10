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
  mockRoute,
  nav,
  serve,
  setupLibrary,
  show,
  who,
  wrap,
} from './libraryHelpers'

jest.mock('@mantine/notifications', () => ({
  notifications: { show: jest.fn() },
}))
jest.mock('next/router', () => ({
  useRouter: () => ({
    query: mockRoute.query,
    push: mockRoute.push,
    replace: mockRoute.replace,
    beforePopState: jest.fn(),
    events: { on: jest.fn(), off: jest.fn(), emit: jest.fn() },
    pathname: '/kids',
  }),
}))
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

const { push, replace } = mockRoute
/** Bonus and Deduct live in the kid header's More menu. */
const pick = async (name: string) => {
  const more = await within(detail()).findByRole('button', { name: 'More' })
  await userEvent.click(more)
  const items = await screen.findAllByRole('menuitem')
  await userEvent.click(items.find((e) => e.textContent?.endsWith(name))!)
}
setupLibrary()

describe('kids', () => {
  test('list shows letter avatars, balance and status chips, never the emoji', async () => {
    mockRoute.query = { section: 'kids' }
    render(wrap(<KidsPage />))
    const leo = await within(list()).findByRole('button', { name: /Leo/ })
    await waitFor(() => expect(leo).toHaveTextContent('Level 3 · 42 pts'))
    expect(
      within(list()).getByRole('button', { name: /Maya/ }),
    ).toHaveTextContent('No PIN')
    expect(
      within(list()).getByRole('button', { name: 'Add a kid' }),
    ).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('🦊')
  })

  test('detail has Edit and a More menu with Bonus, Deduct, View as kid and Remove; devices and chores sit in rows', async () => {
    mockRoute.query = { section: 'kids', item: '8', open: 'devices' }
    render(wrap(<KidsPage />))
    expect(
      await within(detail()).findByRole('button', { name: 'Edit' }),
    ).toBeInTheDocument()
    await userEvent.click(within(detail()).getByRole('button', { name: 'More' }))
    const items = await screen.findAllByRole('menuitem')
    expect(items.map((e) => e.textContent)).toEqual(['add_circleBonus', 'remove_circleDeduct', 'visibilityView as kid', 'closeRemove Leo'])
    expect(items[2]).toHaveAttribute('href', '/kid?as=8')
    expect(await within(detail()).findByText('Leo iPad')).toBeInTheDocument()
    expect(within(detail()).getByText('1 device · all open')).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('🦊')
  })

  test('Edit profile: Remove PIN PATCHes', async () => {
    mockRoute.query = { section: 'kids', item: '8', open: 'settings', edit: '1' }
    render(wrap(<KidsPage />))
    await userEvent.click(
      await within(detail()).findByRole('button', { name: 'Remove PIN' }),
    )
    await waitFor(() =>
      expect(calls('PATCH')[0]).toEqual([
        '/kids/8',
        { method: 'PATCH', body: { clear_pin: true } },
      ]),
    )
  })

  test('PIN: letters are refused with a message, 3 digits are refused, nothing is sent', async () => {
    mockRoute.query = { section: 'kids', item: '8', open: 'settings', edit: '1' }
    render(wrap(<KidsPage />))
    const pin = await within(detail()).findByLabelText(/PIN \(4 digits\)/)
    await userEvent.type(pin, 'ab')
    expect(
      within(detail()).getByText('A PIN is digits only, exactly 4.'),
    ).toBeInTheDocument()
    await userEvent.type(pin, '1234')
    expect(
      within(detail()).queryByText('A PIN is digits only, exactly 4.'),
    ).toBeNull()
    await userEvent.clear(pin)
    await userEvent.type(pin, '123')
    expect(
      within(detail()).getByText('Use exactly 4 digits.'),
    ).toBeInTheDocument()
    expect(
      within(detail()).getByRole('button', { name: 'Save' }),
    ).toBeDisabled()
    expect(calls('PATCH')).toHaveLength(0)
  })

  test('a double-click on Send points posts once', async () => {
    serve({ '/kids/8/points': { balance: 50 } })
    mockRoute.query = { section: 'kids', item: '8' }
    render(wrap(<KidsPage />))
    await pick('Bonus')
    await userEvent.type(within(detail()).getByLabelText(/^Points \(/), '8')
    await userEvent.type(within(detail()).getByLabelText('Why?'), 'Helped out')
    const send = within(detail()).getByRole('button', { name: 'Send points' })
    fireEvent.click(send)
    fireEvent.click(send)
    await waitFor(() => expect(calls('POST')).toHaveLength(1))
  })

  test('Bonus POSTs /points with amount and note', async () => {
    serve({ '/kids/8/points': { balance: 50 } })
    mockRoute.query = { section: 'kids', item: '8' }
    render(wrap(<KidsPage />))
    await pick('Bonus')
    await waitFor(() => expect(within(detail()).getByLabelText(/^Points \(/)).toHaveFocus())
    expect(
      within(detail()).getByRole('button', { name: 'Send points' }),
    ).toBeDisabled()
    await userEvent.type(within(detail()).getByLabelText(/^Points \(/), '8')
    await userEvent.type(within(detail()).getByLabelText('Why?'), 'Helped out')
    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Send points' }),
    )
    await waitFor(() =>
      expect(calls('POST')[0]).toEqual([
        '/kids/8/points',
        { method: 'POST', body: { amount: 8, note: 'Helped out' } },
      ]),
    )

  })

  test('Deduct POSTs /deduct with amount and note', async () => {
    serve({ '/kids/8/deduct': { balance: 10, deducted: 5 } })
    mockRoute.query = { section: 'kids', item: '8' }
    render(wrap(<KidsPage />))
    await pick('Deduct')
    await waitFor(() => expect(within(detail()).getByRole('button', { name: '−5' })).toHaveFocus())
    await userEvent.type(within(detail()).getByLabelText(/^Points \(/), '5')
    await userEvent.type(
      within(detail()).getByLabelText('Why?'),
      'Broke a rule',
    )
    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Take points' }),
    )
    await waitFor(() =>
      expect(calls('POST')[0]).toEqual([
        '/kids/8/deduct',
        { method: 'POST', body: { amount: 5, note: 'Broke a rule' } },
      ]),
    )
  })
})

describe('kids: create, delete, points', () => {
  test('adding a kid POSTs /kids and selects the new kid', async () => {
    const base = apiMock.getMockImplementation()!
    apiMock.mockImplementation(async (path, init) =>
      path === '/kids' && init?.method === 'POST'
        ? { id: 9 }
        : base(path, init),
    )
    mockRoute.query = { section: 'kids', item: 'new' }
    render(wrap(<KidsPage />))
    await userEvent.type(await screen.findByLabelText('Name'), 'Zed')
    await userEvent.click(screen.getByRole('button', { name: 'Add kid' }))
    await waitFor(() =>
      expect(calls('POST')[0]).toEqual([
        '/kids',
        { method: 'POST', body: { full_name: 'Zed' } },
      ]),
    )
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(...nav({ section: 'kids', item: 9 })),
    )
  })

  test('a kid deleted from the list sends the page back to the section list', async () => {
    mockRoute.query = { section: 'kids', item: '99' }
    render(wrap(<KidsPage />))
    await within(list()).findByRole('button', { name: /Leo/ })
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith(...nav({ section: 'kids' })),
    )
  })

  test("Chores assigned lists only that kid's schedule", async () => {
    serve({
      '/chores/': [
        lib({
          id: 6,
          title: 'Trash',
          steps: [],
          assignments: [
            asg({ id: 1, kid_ids: [7] }),
            asg({ id: 2, kid_ids: [8], repeat: { type: 'once', days: [] } }),
          ],
        }),
      ],
    })
    mockRoute.query = { section: 'kids', item: '7', open: 'chores' }
    render(wrap(<KidsPage />))
    const link = await within(detail()).findByRole('link', { name: /Trash/ })
    await waitFor(() => expect(link).toHaveTextContent('Daily'))
    expect(link).not.toHaveTextContent(/once/i)
  })

  test('Bonus refreshes the balance by refetching /today', async () => {
    serve({ '/kids/8/points': { balance: 50 } })
    mockRoute.query = { section: 'kids', item: '8' }
    render(wrap(<KidsPage />))
    await pick('Bonus')
    await userEvent.type(within(detail()).getByLabelText(/^Points \(/), '8')
    await userEvent.type(within(detail()).getByLabelText('Why?'), 'Nice')
    const todayCalls = () =>
      apiMock.mock.calls.filter(([p]) => p === '/today').length
    await waitFor(() => expect(todayCalls()).toBeGreaterThan(0))
    const before = todayCalls()
    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Send points' }),
    )
    await waitFor(() => expect(todayCalls()).toBeGreaterThan(before))
  })
})

describe('rewards and badges', () => {
  test('rewards catalogue lists cards with price and a New reward button; pick edits the price', async () => {
    serve({
      '/rewards': [{ id: 3, name: 'Movie night', price: 150, icon: null, visible: true, needs_approval: true }],
    })
    mockRoute.query = { section: 'rewards', item: 'catalogue', pick: '3' }
    render(wrap(<KidsPage />))
    expect(
      await within(detail()).findByRole('button', { name: /^Movie night/ }),
    ).toHaveTextContent('150 pts')
    expect(
      within(detail()).getAllByRole('button', { name: 'New reward' }).length,
    ).toBeGreaterThan(0)
    expect(within(list()).getByRole('button', { name: /Catalogue/ })).toHaveTextContent('1 reward · 0 hidden')
    expect(within(detail()).getByLabelText('Price (points)')).toHaveValue(
      '150',
    )
  })

  test('rewards with no item opens Requests on desktop', async () => {
    mockRoute.query = { section: 'rewards' }
    render(wrap(<KidsPage />))
    expect(
      await within(detail()).findByRole('heading', { name: 'Requests' }),
    ).toBeInTheDocument()
  })

  test('new reward posts name and price', async () => {
    mockRoute.query = { section: 'rewards', item: 'catalogue', pick: 'new' }
    render(wrap(<KidsPage />))
    await userEvent.type(await screen.findByLabelText('Reward'), 'Pizza')
    await userEvent.clear(screen.getByLabelText('Price (points)'))
    await userEvent.type(screen.getByLabelText('Price (points)'), '80')
    await userEvent.click(screen.getByRole('button', { name: 'Add reward' }))
    await waitFor(() =>
      expect(calls('POST')[0]).toEqual([
        '/rewards',
        { method: 'POST', body: { name: 'Pizza', price: 80 } },
      ]),
    )
  })

  test('custom badges pane lists cards; Award it awards the picked kid', async () => {
    serve({
      '/custom-badges': [
        { id: 3, name: 'Helper', icon: 'star', description: 'Helped out' },
      ],
      '/badges/overview': [],
      '/badges/recent': [],
      '/custom-badges/3/award': { tier: 2 },
    })
    mockRoute.query = { section: 'badges', item: 'custom', pick: '3' }
    render(wrap(<KidsPage />))
    expect(
      await within(detail()).findByRole('button', { name: /^Helper/ }),
    ).toHaveTextContent('Not awarded yet')
    expect(
      within(list()).getByRole('button', { name: /Custom badges/ }),
    ).toHaveTextContent('1 made by you')
    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Award' }),
    )
    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Leo' }),
    )
    await userEvent.click(
      within(detail()).getByRole('button', { name: 'Award Helper' }),
    )
    await waitFor(() =>
      expect(calls('POST')[0]).toEqual([
        '/custom-badges/3/award',
        { method: 'POST', body: { kid_id: 8 } },
      ]),
    )
  })

  test('new badge posts name, icon and description', async () => {
    serve({ '/badges/overview': [], '/badges/recent': [] })
    mockRoute.query = { section: 'badges', item: 'custom', pick: 'new' }
    render(wrap(<KidsPage />))
    await userEvent.type(await screen.findByLabelText('Badge name'), 'Kind')
    await userEvent.click(screen.getByRole('button', { name: 'Change icon' }))
    await userEvent.click(await screen.findByTitle('star'))
    await userEvent.type(screen.getByLabelText('Description'), 'Was kind')
    await userEvent.click(screen.getByRole('button', { name: 'Add badge' }))
    await waitFor(() =>
      expect(calls('POST')[0]).toEqual([
        '/custom-badges',
        {
          method: 'POST',
          body: { name: 'Kind', icon: 'star', description: 'Was kind' },
        },
      ]),
    )
  })
})

describe('rewards and badges: icon and delete confirmation', () => {
  test('reward glyph icon is sent with the price and name', async () => {
    mockRoute.query = { section: 'rewards', item: 'catalogue', pick: 'new' }
    render(wrap(<KidsPage />))
    await userEvent.type(await screen.findByLabelText('Reward'), 'Pizza')
    await userEvent.click(screen.getByTitle('local_pizza'))
    await userEvent.click(screen.getByRole('button', { name: 'Add reward' }))
    await waitFor(() =>
      expect(calls('POST')[0]).toEqual([
        '/rewards',
        { method: 'POST', body: { name: 'Pizza', price: 50, icon: 'local_pizza' } },
      ]),
    )
  })

  test('deleting a reward asks first, then DELETEs', async () => {
    serve({
      '/rewards': [{ id: 3, name: 'Movie night', price: 150, icon: null, visible: true, needs_approval: true }],
    })
    mockRoute.query = { section: 'rewards', item: 'catalogue', pick: '3' }
    render(wrap(<KidsPage />))
    await userEvent.click(
      await within(detail()).findByRole('button', { name: 'Delete reward' }),
    )
    expect(calls('DELETE')).toHaveLength(0)
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    )
    await waitFor(() =>
      expect(calls('DELETE')[0]).toEqual(['/rewards/3', { method: 'DELETE' }]),
    )
  })

  test('deleting a badge asks first, then DELETEs', async () => {
    serve({
      '/custom-badges': [
        { id: 3, name: 'Helper', icon: 'star', description: '' },
      ],
      '/badges/overview': [],
      '/badges/recent': [],
    })
    mockRoute.query = { section: 'badges', item: 'custom', pick: '3' }
    render(wrap(<KidsPage />))
    await userEvent.click(
      await within(detail()).findByRole('button', { name: 'More for Helper' }),
    )
    await userEvent.click(
      await screen.findByRole('menuitem', { name: 'Delete badge' }),
    )
    expect(calls('DELETE')).toHaveLength(0)
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', {
        name: 'Delete',
      }),
    )
    await waitFor(() =>
      expect(calls('DELETE')[0]).toEqual([
        '/custom-badges/3',
        { method: 'DELETE' },
      ]),
    )
  })
})
