import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import SetupPage from '../../pages/setup'
import { api } from '@/v2/api'
import { fridgeTheme } from '@/v2/theme'

const replace = jest.fn()
const push = jest.fn()
jest.mock('next/router', () => ({ useRouter: () => ({ push, replace, asPath: '/setup' }) }))
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

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string }) => Promise<unknown>>

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
    if (path === '/kids') return { id: 7, full_name: 'Ava', username: 'kid-ava', avatar: '🦊', has_pin: false }
    return {}
  })
  authed = false
  replace.mockReset()
  push.mockReset()
  loginWithToken.mockReset()
})

describe('optional extras step', () => {
  const kid = { id: 7, full_name: 'Ava', username: 'kid-ava', avatar: '🦊', has_pin: false, age_group: 'kid' }
  const resume = (step: number) => {
    authed = true
    apiMock.mockImplementation(async (path, init) => {
      if (path === '/setup') return { needed: false }
      if (path === '/setup/step') return init?.method === 'PUT' ? {} : { step }
      if (path === '/kids') return [kid]
      return []
    })
  }
  const puts = () => apiMock.mock.calls.filter((c) => c[0] === '/setup/step' && c[1]?.method === 'PUT').map((c) => (c[1] as { body: unknown }).body)
  const patches = () => apiMock.mock.calls.filter(([p, i]) => p !== '/setup/step' && i?.method === 'PATCH' && !JSON.stringify(i).includes('chores_lock'))

  test('a family stored at step 8 lands on the extras step, everything off', async () => {
    resume(8)
    wrap()
    expect(await screen.findByRole('heading', { name: 'Optional extras' })).toBeInTheDocument()
    expect(screen.getByText('Step 8 of 8 · optional')).toBeInTheDocument()
    for (const n of ['Trust mode for Ava', 'Bedtime auto-approve']) expect(screen.getByRole('switch', { name: n })).toHaveAttribute('aria-checked', 'false')
  })

  test('Next from Hours saves step 8, Skip finishes and saves null, nothing is patched', async () => {
    const user = userEvent.setup()
    resume(7)
    wrap()
    await screen.findByText('Allowed hours')
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await screen.findByRole('heading', { name: 'Optional extras' })
    await waitFor(() => expect(puts()).toContainEqual({ step: 8 }))
    await user.click(screen.getByRole('button', { name: 'Skip' }))
    await screen.findByText("You're all set")
    await waitFor(() => expect(puts().at(-1)).toEqual({ step: null }))
    expect(patches()).toHaveLength(0)
  })

  test('Finish applies the switches that are on', async () => {
    const user = userEvent.setup()
    resume(8)
    wrap()
    await user.click(await screen.findByRole('switch', { name: 'Trust mode for Ava' }))
    await user.click(screen.getByRole('switch', { name: 'Bedtime auto-approve' }))
    await user.click(screen.getByRole('button', { name: 'Finish' }))
    await screen.findByText("You're all set")
    expect(apiMock).toHaveBeenCalledWith('/kids/7', { method: 'PATCH', body: { trust_mode: true } })
    expect(apiMock).toHaveBeenCalledWith('/family', { method: 'PATCH', body: { bedtime_auto: true } })
  })

  test('Finish with all off patches nothing', async () => {
    const user = userEvent.setup()
    resume(8)
    wrap()
    await user.click(await screen.findByRole('button', { name: 'Finish' }))
    await screen.findByText("You're all set")
    expect(patches()).toHaveLength(0)
  })
})
