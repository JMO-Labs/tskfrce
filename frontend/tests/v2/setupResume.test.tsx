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
import { track } from '@/v2/eval/track'

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
jest.mock('@/v2/eval/track', () => ({ track: jest.fn() }))
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

describe('turnkey defaults', () => {
  test('default hours are one window per day type', () => {
    expect(DEFAULT_DRAFTS.map((d) => [d.days, d.times])).toEqual([
      ['01236', [{ start: '07:00', end: '20:00' }]],
      ['45', [{ start: '08:00', end: '22:00' }]],
    ])
  })

  test('Homework repeats on school days only; a chore you add goes to every kid', async () => {
    const user = userEvent.setup()
    authed = true
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/setup') return { needed: false }
      if (path === '/setup/step') return init?.method === 'PUT' ? {} : { step: 5 }
      if (path === '/kids') return [{ id: 7, full_name: 'Ava', username: 'kid-ava', avatar: '🦊', has_pin: false, age_group: 'kid' }]
      if (path === '/presets') return catalog
      if (path === '/chores/' && init?.method === 'POST') return { id: (init.body as { title: string }).title === 'Homework' ? 31 : 32 }
      if (path === '/chore-types') return [{ id: 5, name: 'Schoolwork' }]
      return []
    })
    wrap()
    await user.click(await screen.findByRole('button', { name: 'Tweak' }))
    expect(await screen.findByText(/30 pts · school days/)).toBeInTheDocument()
    await user.click(await screen.findByRole('button', { name: /^Homework/ }))
    for (let i = 0; i < 3; i++) await user.click(await screen.findByRole('button', { name: 'Next' })) // Hours, Extras, apply
    await waitFor(() => expect(posts('/chores/31/assignments')).toHaveLength(1))
    expect((posts('/chores/31/assignments')[0][1] as { body: { repeat: unknown } }).body.repeat).toEqual({ type: 'weekly', days: [0, 1, 2, 3, 4] })
    expect((posts('/chores/31/assignments')[0][1] as { body: { kid_ids: number[] } }).body.kid_ids).toEqual([7])
  })
})

describe('resuming an unfinished setup', () => {
  test('a signed-in parent lands on the saved step with their kids loaded', async () => {
    authed = true
    apiMock.mockImplementation(async (path) => {
      if (path === '/setup') return { needed: false }
      if (path === '/setup/step') return { step: 7 }
      if (path === '/kids') return [{ id: 7, full_name: 'Ava', username: 'kid-ava', avatar: '🦊', has_pin: false, age_group: 'kid' }]
      return []
    })
    wrap()
    expect(await screen.findByText('Whose devices are these?')).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
    expect(apiMock).toHaveBeenCalledWith('/kids')
  })

  const kid = { id: 7, full_name: 'Ava', username: 'kid-ava', avatar: '🦊', has_pin: false, age_group: 'kid' }
  const resumeAt = (step: number, extra: Record<string, unknown> = {}) => {
    authed = true
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/setup') return { needed: false }
      if (path === '/setup/step') return init?.method === 'PUT' ? {} : { step }
      if (path === '/kids') return [kid]
      if (path === '/presets') return catalog
      return path in extra ? extra[path] : []
    })
  }

  test('Finish on a resumed wizard shows "You\'re all set" with the real counts', async () => {
    const user = userEvent.setup()
    resumeAt(7, { '/chores/': [{ id: 1 }, { id: 2 }, { id: 3 }], '/hours': { rules: [{}, {}] } })
    wrap()
    await screen.findByText('Whose devices are these?')
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    expect(await screen.findByText("You're all set")).toBeInTheDocument()
    expect(replace).not.toHaveBeenCalled()
    expect(await screen.findByText(/1 kid, 3 chores, 0 devices, 2 schedules/)).toBeInTheDocument()
  })

  test('a family stored past the last step resumes on the finish screen', async () => {
    resumeAt(9, { '/family': { reset_time: '06:00:00', chores_lock: true }, '/chores/': [{ id: 1 }], '/hours': { rules: [] } })
    wrap()
    expect(await screen.findByText("You're all set")).toBeInTheDocument()
    expect(await screen.findByText('Hours start now. Chores, and the chore lock, start at the next daily reset (6:00 AM).')).toBeInTheDocument()
    expect(screen.getByText(/Want to approve chores away from home\? Set up Tailscale\. Takes 5 minutes\./)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'How to set it up' })).toBeInTheDocument()
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/setup/step', { method: 'PUT', body: { step: null } })) // self-heal
    await userEvent.setup().click(screen.getByRole('button', { name: 'Go to Today' }))
    expect(push).toHaveBeenCalledWith('/')
    expect(replace).not.toHaveBeenCalledWith('/setup')
  })

  test('a starter that already exists is locked as Added and not created again', async () => {
    const user = userEvent.setup()
    resumeAt(5, { '/chores/': [{ id: 9, title: 'Make bed' }] })
    wrap()
    await user.click(await screen.findByRole('button', { name: 'Tweak' }))
    const bed = await screen.findByRole('button', { name: /^Make bed/ })
    await waitFor(() => expect(bed).toBeDisabled())
    expect(bed).toHaveAttribute('aria-pressed', 'true')
    expect(bed).toHaveTextContent('Added')
    for (let i = 0; i < 3; i++) await user.click(await screen.findByRole('button', { name: 'Next' })) // Hours, Extras, apply
    await screen.findByRole('button', { name: 'Show code for Ava' })
    expect(posts('/chores/').map(([, i]) => (i as { body: { title: string } }).body.title)).toEqual(['Tidy room']) // only the plan's other chore
    expect(posts('/chores/9/assignments')).toHaveLength(0)
  })

  test('resuming step 5: made starters are Added and do not count as picked', async () => {
    resumeAt(5, { '/chores/': [{ id: 9, title: 'Make bed' }, { id: 10, title: 'Custom thing' }] })
    wrap()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Tweak' }))
    expect(await screen.findByText('Added')).toBeInTheDocument()
    expect(screen.getByText('1 picked')).toBeInTheDocument() // Tidy room; Make bed is already made
  })

  test('nothing to resume goes to log in', async () => {
    authed = true
    apiMock.mockImplementation(async (path) => (path === '/setup' ? { needed: false } : { step: null }))
    wrap()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'))
  })
})

describe('setup_detail telemetry', () => {
  const kid = { id: 7, full_name: 'Ava', username: 'kid-ava', avatar: '🦊', has_pin: false, age_group: 'kid' }
  const at = (step: number) => {
    authed = true
    ;(track as jest.Mock).mockClear()
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/setup') return { needed: false }
      if (path === '/setup/step') return init?.method === 'PUT' ? {} : { step }
      if (path === '/kids') return init?.method === 'POST' ? { ...kid, id: 8, full_name: 'Leo' } : [kid]
      if (path === '/presets') return catalog
      return []
    })
  }
  const detail = () => (track as jest.Mock).mock.calls.filter((c) => c[0] === 'setup_detail').map((c) => c[1])

  test('How strict Next reports the preset', async () => {
    at(4)
    wrap()
    await userEvent.setup().click(await screen.findByRole('button', { name: 'Next' }))
    expect(detail()).toContainEqual({ step: 4, what: 'preset_balanced' })
  })

  test('adding a kid reports name_edited, never the name', async () => {
    const user = userEvent.setup()
    at(3)
    wrap()
    await user.type(await screen.findByLabelText('Name'), 'Leo')
    await user.click(screen.getByRole('button', { name: 'Add kid' }))
    await waitFor(() => expect(detail()).toContainEqual({ step: 3, what: 'name_edited' }))
    expect(JSON.stringify((track as jest.Mock).mock.calls)).not.toContain('Leo')
  })

  test('leaving Tweak chores reports the kept bucket', async () => {
    const user = userEvent.setup()
    at(5)
    wrap()
    await user.click(await screen.findByRole('button', { name: 'Tweak' }))
    await user.click(await screen.findByRole('button', { name: /^Homework/ }))
    await user.click(await screen.findByRole('button', { name: 'Next' }))
    expect(detail()).toContainEqual({ step: 5, what: expect.stringMatching(/^chores_kept_(0|lt50|50_99)$/) })
  })
})
