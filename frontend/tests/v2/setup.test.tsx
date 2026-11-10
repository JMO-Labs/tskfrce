import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SetupPage from '../../pages/setup'
import { api, ApiError } from '@/v2/api'
import { fridgeTheme } from '@/v2/theme'
import { DEFAULT_DRAFTS } from '@/v2/setup/setupJobs'
import { catalog } from './helpers/presetCatalog'

const replace = jest.fn()
const push = jest.fn()
jest.mock('next/router', () => ({ useRouter: () => ({ push, replace, asPath: '/setup', pathname: '/setup', query: {} }) }))
jest.mock('@/v2/api', () => {
  class ApiError extends Error {
    status: number
    detail: string
    constructor(status: number, detail: string) {
      super(detail)
      this.status = status
      this.detail = detail
    }
  }
  return { api: jest.fn(), ApiError }
})
const loginWithToken = jest.fn()
let authed = false
jest.mock('@/contexts/UnifiedAuthContext', () => ({
  useUnifiedAuth: () => ({ loginWithToken, isInitialized: true, isAuthenticated: authed }),
}))

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>

const wrap = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider theme={fridgeTheme}>
        <SetupPage />
      </MantineProvider>
    </QueryClientProvider>,
  )

beforeAll(() => {
  window.matchMedia =
    window.matchMedia ||
    ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList)
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} }
  Element.prototype.scrollIntoView = Element.prototype.scrollIntoView || (() => {})
})

beforeEach(() => {
  apiMock.mockReset().mockImplementation(async (path, init) => {
    if (path === '/setup' && init?.method === 'POST') return { access_token: 't', refresh_token: 'r', expires_in: 1800 }
    if (path === '/setup') return { needed: true }
    if (path === '/devices') return []
    if (path === '/chores/') return { id: 31 }
    if (path === '/chore-types') return [{ id: 4, name: 'Personal' }, { id: 2, name: 'Kitchen' }]
    if (path === '/kids') return { id: 7, full_name: 'Ava', username: 'kid-ava', avatar: '🦊', has_pin: false, age_group: 'kid' }
    if (path === '/presets') return catalog
    return {}
  })
  authed = false
  replace.mockReset()
  push.mockReset()
  loginWithToken.mockReset()
})

const posts = (path: string) => apiMock.mock.calls.filter(([p, i]) => p === path && i?.method === 'POST')

const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'

async function toParent(user: ReturnType<typeof userEvent.setup>) {
  // Step 1: Parent account (Your name, Username, Password)
  await user.type(screen.getByLabelText('Your name'), 'Sam')
  await user.type(screen.getByLabelText('Username'), 'sam')
  // Password will be typed by caller
}

/** Parent step 1, then the family step; the next Next click creates the account. */
async function toFamily(user: ReturnType<typeof userEvent.setup>) {
  await toParent(user)
  await user.type(screen.getByLabelText(/^Password/), 'longenough1')
  await user.type(screen.getByLabelText('Type it again'), 'longenough1')
  await user.click(screen.getByRole('button', { name: 'Next' }))
  await user.type(await screen.findByLabelText('Family name'), 'The Sams')
}

/** Skip the current step; fails if there is no Skip button. */
const skipStep = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Skip' }))
}
/** Step 4 with no kids has no Skip, only Next. */
/** Tweak Hours → Extras → (apply) Phones → Devices → the finish screen, leaving every extra off. */
const finishWizard = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('button', { name: 'Next' })) // Hours → Extras
  await user.click(await screen.findByRole('button', { name: 'Next' })) // Extras → apply → Phones
  await user.click(await screen.findByRole('button', { name: 'Skip' })) // Phones → Devices
  await user.click(await screen.findByRole('button', { name: 'Finish' }))
}
const nextNoSkip = async (user: ReturnType<typeof userEvent.setup>) => {
  expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
  await user.click(await screen.findByRole('button', { name: 'Next' }))
}

describe('setup wizard', () => {
  test('step 1 renders parent account form', () => {
    wrap()
    expect(screen.getByLabelText('Your name')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
  })

  test('parent form has username and password fields', () => {
    wrap()
    expect(screen.getByLabelText('Your name')).toBeInTheDocument()
    expect(screen.getByLabelText('Username')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toBeInTheDocument()
  })

  test('short password blocks Next', async () => {
    const user = userEvent.setup()
    wrap()
    await toParent(user)
    await user.type(screen.getByLabelText(/^Password/), 'short')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Use at least 8 characters.')).toBeInTheDocument()
    expect(apiMock).not.toHaveBeenCalledWith('/setup', expect.objectContaining({ method: 'POST' }))
  })

  test('409 shows the log in link', async () => {
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/setup' && init?.method === 'POST') throw new ApiError(409, 'Setup is already done. Log in instead.')
      return { needed: true }
    })
    const user = userEvent.setup()
    wrap()
    await toFamily(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    const link = await screen.findByRole('link', { name: 'Log in' })
    expect(link).toHaveAttribute('href', '/login')
  })

  test('Skip is on steps 3 to 7 and off Phones without kids', async () => {
    const user = userEvent.setup()
    wrap()
    await finishAccount(user)
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Skip' })) // 3 → 4 → 5 → 6, no kids yet
    expect(await screen.findByText('Add a kid first, or tap Next to go on.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Skip' })).toBeNull()
    for (let i = 0; i < 3; i++) await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.type(await screen.findByLabelText('Name'), 'Ava')
    await user.click(screen.getByRole('button', { name: 'Add kid' }))
    await screen.findByText(/^Ava$/)
    await user.click(screen.getByRole('button', { name: 'Next' })) // 3 → 4 with a kid
    await screen.findByRole('heading', { name: 'How strict should it be?' })
    await user.click(screen.getByRole('button', { name: 'Skip' })) // 4 → 5
    await screen.findByRole('heading', { name: "Here's your plan" })
    await user.click(screen.getByRole('button', { name: 'Skip' })) // 5 → 6 without applying
    await screen.findByRole('button', { name: 'Show code for Ava' })
    expect(posts('/presets/apply')).toHaveLength(0)
    for (let step = 6; step <= 7; step++) {
      expect(screen.getByRole('button', { name: 'Skip' })).toBeInTheDocument()
      await skipStep(user)
    }
    expect(await screen.findByText("You're all set")).toBeInTheDocument() // step 7 is the last
  })

  test('skipping every step reaches the finish screen', async () => {
    const user = userEvent.setup()
    wrap()
    await toFamily(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await waitFor(() => expect(loginWithToken).toHaveBeenCalledWith('t', 'r', 1800))
    for (let i = 0; i < 3; i++) await skipStep(user) // 3 → 4 → 5 → 6
    await nextNoSkip(user) // 6 → 7, no kids
    await skipStep(user) // 7 → finish
    expect(await screen.findByText('Hours start now.')).toBeInTheDocument() // no kids, no chores
    expect(screen.queryByText(/next daily reset/)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull()
    await user.click(await screen.findByRole('button', { name: 'Go to Today' }))
    expect(push).toHaveBeenCalledWith('/')
    expect(replace).not.toHaveBeenCalled()
  })

  const finishAccount = async (user: ReturnType<typeof userEvent.setup>) => {
    await toFamily(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText('Name')
  }
  test('empty family name blocks Next; the account POST carries the family name and time zone', async () => {
    const user = userEvent.setup()
    wrap()
    await toParent(user)
    await user.type(screen.getByLabelText(/^Password/), 'longenough1')
    await user.type(screen.getByLabelText('Type it again'), 'longenough1')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await user.click(await screen.findByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Enter a family name.')).toBeInTheDocument()
    expect(posts('/setup')).toHaveLength(0)
    await user.type(screen.getByLabelText('Family name'), 'The Sams')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByLabelText('Name')
    expect(posts('/setup')[0][1]).toEqual({
      method: 'POST',
      body: { family_name: 'The Sams', timezone: tz, parent: { username: 'sam', password: 'longenough1', full_name: 'Sam' } },
    })
  })

  test('already set up redirects to /login', async () => {
    apiMock.mockImplementation(async () => ({ needed: false }))
    wrap()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
  })

  test('login failure after setup shows a log in link and never re-posts', async () => {
    loginWithToken.mockImplementation(() => Promise.reject(new Error('nope')))
    const user = userEvent.setup()
    wrap()
    await toFamily(user)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText(/Your account was created/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Log in' })).toHaveAttribute('href', '/login')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(posts('/setup')).toHaveLength(1)
  })

  /** Add Ava, then Next to How strict and Next to Your plan. */
  const toPlan = async (user: ReturnType<typeof userEvent.setup>) => {
    await finishAccount(user)
    await user.type(screen.getByLabelText('Name'), 'Ava')
    await user.click(screen.getByRole('button', { name: 'Add kid' }))
    await screen.findByText(/^Ava$/)
    await user.click(screen.getByRole('button', { name: 'Next' })) // 3 → 4
    await screen.findByRole('heading', { name: 'How strict should it be?' })
    await user.click(screen.getByRole('button', { name: 'Next' })) // 4 → 5
    await screen.findByRole('heading', { name: "Here's your plan" })
  }

  test('style step: three choices, Balanced picked, no per-kid switch with one kid, table collapsed', async () => {
    const user = userEvent.setup()
    wrap()
    await finishAccount(user)
    await user.type(screen.getByLabelText('Name'), 'Ava')
    await user.click(screen.getByRole('button', { name: 'Add kid' }))
    await screen.findByText(/^Ava$/)
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('radio', { name: /Balanced/ })).toBeChecked()
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.queryByRole('switch', { name: 'Different for each kid' })).toBeNull()
    expect(await screen.findByText('See what this sets')).toBeInTheDocument()
    expect(document.querySelector('details')).not.toHaveAttribute('open')
  })

  test('the per-kid switch shows with two kids', async () => {
    const user = userEvent.setup()
    let n = 0
    const base = apiMock.getMockImplementation()!
    apiMock.mockImplementation(async (path, init) =>
      path === '/kids' && init?.method === 'POST' ? { id: 7 + n, full_name: ['Ava', 'Ben'][n++], username: 'k', avatar: '🦊', has_pin: false, age_group: 'kid' } : base(path, init),
    )
    wrap()
    await finishAccount(user)
    for (const name of ['Ava', 'Ben']) {
      await user.type(screen.getByLabelText('Name'), name)
      await user.click(screen.getByRole('button', { name: 'Add kid' }))
      await screen.findByText(new RegExp(`^${name}$`))
    }
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('switch', { name: 'Different for each kid' })).toBeInTheDocument()
  })

  test('Looks good posts /presets/apply once, even after Back and Next, and lands on Phones', async () => {
    const user = userEvent.setup()
    wrap()
    await toPlan(user)
    expect(posts('/kids')[0][1]).toEqual({ method: 'POST', body: { full_name: 'Ava', avatar: '🦊', pin: null } })
    expect(await screen.findByText('Ava · Balanced')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Looks good' }))
    await screen.findByRole('button', { name: 'Show code for Ava' })
    expect(posts('/presets/apply')).toHaveLength(1)
    expect(posts('/presets/apply')[0][1]).toEqual({ method: 'POST', body: { style: 'balanced', kids: { 7: null } } })
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(await screen.findByRole('button', { name: 'Looks good' }))
    await screen.findByRole('button', { name: 'Show code for Ava' })
    expect(posts('/presets/apply')).toHaveLength(1)
    expect(posts('/chores/')).toHaveLength(0) // the server makes the chores
    expect(posts('/hours')).toHaveLength(0)
  })

  test('Tweak: chores, hours and extras are pre-filled; nothing is posted until the end, then the plan applies with those skipped', async () => {
    const user = userEvent.setup()
    wrap()
    await toPlan(user)
    await user.click(await screen.findByRole('button', { name: 'Tweak' }))
    expect(await screen.findByText('2 picked')).toBeInTheDocument() // Make bed, Tidy room from the plan
    await user.click(screen.getByRole('button', { name: /^Tidy room/ }))
    expect(screen.getByText('1 picked')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' })) // → Hours
    await screen.findByText('Allowed hours')
    expect(screen.getByLabelText('Bedtime on school nights')).toHaveValue('20:30')
    await user.click(screen.getByRole('button', { name: 'Back' }))
    await user.click(await screen.findByRole('button', { name: 'Next' }))
    await screen.findByText('Allowed hours')
    await user.click(screen.getByRole('button', { name: 'Next' })) // → Extras
    await screen.findByRole('heading', { name: 'Optional extras' })
    expect(posts('/chores/')).toHaveLength(0)
    await user.click(screen.getByRole('button', { name: 'Next' })) // → apply → Phones
    await screen.findByRole('button', { name: 'Show code for Ava' })
    expect(posts('/chores/')).toHaveLength(1)
    expect(posts('/chores/')[0][1]).toEqual({ method: 'POST', body: { title: 'Make bed', points: 10, needs_photo: false, steps: [], type_id: 4 } })
    expect(posts('/chores/31/assignments')[0][1]).toEqual({
      method: 'POST',
      body: { kid_ids: [7], mode: 'each', repeat: { type: 'daily', days: [] }, on_date: null, due_time: null },
    })
    expect(posts('/hours')).toHaveLength(2)
    expect(apiMock).toHaveBeenCalledWith('/family', { method: 'PATCH', body: { chores_lock: true } })
    expect(posts('/presets/apply')).toHaveLength(1)
    expect(posts('/presets/apply')[0][1]).toEqual({ method: 'POST', body: { style: 'balanced', kids: { 7: null }, skip: ['chores', 'bedtime', 'trust'] } })
  })

  test('Back from Tweak Chores returns to the plan', async () => {
    const user = userEvent.setup()
    wrap()
    await toPlan(user)
    await user.click(await screen.findByRole('button', { name: 'Tweak' }))
    await screen.findByRole('heading', { name: 'Pick some starter chores' })
    await user.click(screen.getByRole('button', { name: 'Back' }))
    expect(await screen.findByRole('heading', { name: "Here's your plan" })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Looks good' })).toBeInTheDocument()
  })

  const toHours = async (user: ReturnType<typeof userEvent.setup>) => {
    await toPlan(user)
    await user.click(await screen.findByRole('button', { name: 'Tweak' }))
    await screen.findByText('2 picked')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByText('Allowed hours')
  }
  const rowText = (name: string) => screen.getByRole('button', { name: `Edit ${name}` }).parentElement!.textContent

  test('Hours starts from the plan and bedtime edits the range', async () => {
    const user = userEvent.setup()
    wrap()
    await toHours(user)
    expect(rowText('School nights')).toContain('7a–8:30p')
    expect(rowText('Weekends')).toContain('8a–10p')
    expect(screen.getByLabelText('Bedtime on school nights')).toHaveValue('20:30')
    fireEvent.change(screen.getByLabelText('Bedtime on weekends'), { target: { value: '23:00' } })
    expect(rowText('Weekends')).toContain('8a–11p')
  })

  test('Next posts both rules for everyone and PATCHes chores_lock', async () => {
    const user = userEvent.setup()
    wrap()
    await toHours(user)
    expect(screen.getByText('Starts at the next daily reset after you finish, so nobody is paused during setup.')).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: "Lock until today's chores are done" })).toHaveAttribute('aria-checked', 'true') // the plan locks
    await user.click(screen.getByRole('switch', { name: "Lock until today's chores are done" }))
    await finishWizard(user)
    await screen.findByText("You're all set")
    const bodies = posts('/hours').map(([, i]) => (i as { body: Record<string, unknown> }).body)
    expect(bodies.map((b) => b.name)).toEqual(['School nights', 'Weekends'])
    expect(bodies[0]).toEqual({
      name: 'School nights', category: 'school_night', kind: 'allowed', days: '01236', everyone: true,
      kid_ids: [], group_ids: [], start_date: null, end_date: null,
      times: [{ start: '07:00', end: '20:30' }],
    })
    expect(bodies[1]).toMatchObject({ category: 'weekend', days: '45', everyone: true, times: [{ start: '08:00', end: '22:00' }] })
    expect(apiMock).toHaveBeenCalledWith('/family', { method: 'PATCH', body: { chores_lock: false } })
  })

  const planRule = { ...DEFAULT_DRAFTS[0], times: [{ start: '07:00', end: '20:30' }] }
  test('a rule already on the server is not posted again', async () => {
    const base = apiMock.getMockImplementation()!
    apiMock.mockImplementation(async (path, init) =>
      path === '/hours' && !init?.method ? { today: null, rules: [{ id: 5, ...planRule }] } : base(path, init),
    )
    const user = userEvent.setup()
    wrap()
    await toHours(user)
    await finishWizard(user)
    await screen.findByText("You're all set")
    expect(posts('/hours').map(([, i]) => (i as { body: { name: string } }).body.name)).toEqual(['Weekends'])
  })

  test('a server rule with the same name but a different body does not suppress the post', async () => {
    const base = apiMock.getMockImplementation()!
    apiMock.mockImplementation(async (path, init) =>
      path === '/hours' && !init?.method ? { today: null, rules: [{ id: 5, ...planRule, days: '0123456' }] } : base(path, init),
    )
    const user = userEvent.setup()
    wrap()
    await toHours(user)
    await finishWizard(user)
    await screen.findByText("You're all set")
    expect(posts('/hours').map(([, i]) => (i as { body: { name: string } }).body.name)).toEqual(['School nights', 'Weekends'])
  })

  test('a typed but unadded kid name blocks Next', async () => {
    const user = userEvent.setup()
    wrap()
    await finishAccount(user)
    await user.type(screen.getByLabelText('Name'), 'Ben')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByText('Add Ben first or clear the field.')).toBeInTheDocument()
  })

  test('a mismatched confirm password shows inline and blocks Next', async () => {
    const user = userEvent.setup()
    wrap()
    await toParent(user)
    await user.type(screen.getByLabelText(/^Password/), 'longenough1')
    await user.type(screen.getByLabelText('Type it again'), 'different')
    expect(screen.queryByText("The two passwords don't match.")).toBeNull() // not while typing
    await user.tab()
    expect(screen.getByText("The two passwords don't match.")).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.queryByLabelText('Family name')).toBeNull()
  })

  test('each step after the account is saved on the server; Finish clears it', async () => {
    const user = userEvent.setup()
    wrap()
    await finishAccount(user)
    const puts = () => apiMock.mock.calls.filter((c) => c[0] === '/setup/step').map((c) => (c[1] as { body: unknown }).body)
    await skipStep(user) // 3 → 4
    await skipStep(user) // 4 → 5
    await waitFor(() => expect(puts()).toEqual([{ step: 4 }, { step: 5 }]))
    await skipStep(user) // 5 → 6
    await nextNoSkip(user) // 6 → 7, no kids
    await skipStep(user) // → finish
    await waitFor(() => expect(puts().at(-1)).toEqual({ step: null }))
  })
})
