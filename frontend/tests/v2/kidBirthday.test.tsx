import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StepKids } from '@/v2/setup/StepKids'
import { KidProfileForm } from '@/v2/manage/KidEditor'
import { SuggestionsCard } from '@/v2/today/SuggestionsCard'
import { api } from '@/v2/api'
import { fridgeTheme } from '@/v2/theme'
import type { Kid } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
type Init = { method?: string; body?: unknown }
const apiMock = api as unknown as Mock<(p: string, i?: Init) => Promise<unknown>>

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider theme={fridgeTheme}>{ui}</MantineProvider>
    </QueryClientProvider>,
  )
const bodyOf = (method: string) => apiMock.mock.calls.find(([, o]) => o?.method === method)?.[1]?.body
const kid = { id: 5, full_name: 'Ava', username: 'a', avatar: null, has_pin: false, age_group: 'kid' } as Kid

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList)
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} }
})
beforeEach(() => { apiMock.mockReset().mockResolvedValue({ id: 9, full_name: 'Ava', username: 'a', avatar: null, has_pin: false }) })

describe('Birthday (month/year)', () => {
  test('StepKids sends birth month/year when filled', async () => {
    const user = userEvent.setup()
    wrap(<StepKids kids={[]} name="Ava" onName={() => {}} onAdd={() => {}} />)
    await user.type(screen.getByLabelText(/Birthday/), '2016-04')
    await user.click(screen.getByRole('button', { name: 'Add kid' }))
    await waitFor(() => expect(bodyOf('POST')).toMatchObject({ full_name: 'Ava', birth_month: 4, birth_year: 2016 }))
  })

  test('StepKids omits birth fields when left empty', async () => {
    const user = userEvent.setup()
    wrap(<StepKids kids={[]} name="Ava" onName={() => {}} onAdd={() => {}} />)
    await user.click(screen.getByRole('button', { name: 'Add kid' }))
    await waitFor(() => expect(bodyOf('POST')).toBeDefined())
    expect(bodyOf('POST')).not.toHaveProperty('birth_month')
  })

  test('KidProfileForm saves a birthday and can clear it', async () => {
    const user = userEvent.setup()
    const { unmount } = render(<QueryClientProvider client={new QueryClient()}><MantineProvider theme={fridgeTheme}><KidProfileForm kid={kid} onSaved={() => {}} /></MantineProvider></QueryClientProvider>)
    await user.type(screen.getByLabelText(/Birthday/), '2015-11')
    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(bodyOf('PATCH')).toEqual({ birth_month: 11, birth_year: 2015 }))
    unmount()
    apiMock.mockClear()
    wrap(<KidProfileForm kid={{ ...kid, birth_month: 11, birth_year: 2015 }} onSaved={() => {}} />)
    await user.clear(screen.getByLabelText(/Birthday/))
    await user.click(screen.getByRole('button', { name: /save/i }))
    await waitFor(() => expect(bodyOf('PATCH')).toEqual({ birth_month: null, birth_year: null }))
  })
})

describe('kid.age_up suggestion', () => {
  test('the action posts to the kid age-up endpoint', async () => {
    const user = userEvent.setup()
    const it = { key: 'kid.age_up:5', rule: 'kid.age_up', tier: 2, fingerprint: 'teen', at: '2026-11-11T10:00:00Z', title: 'Ava may be ready for Teen', body: 'b', action: { kind: 'post', label: 'Move to Teen', to: '/kids/5/age-up' } }
    apiMock.mockImplementation(async (p) => (p === '/suggestions' ? { hidden: false, items: [it] } : {}))
    wrap(<SuggestionsCard />)
    await user.click(await screen.findByRole('button', { name: 'Move to Teen' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/kids/5/age-up', { method: 'POST' }))
  })
})
