import { beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/v2/api'
import { fridgeTheme } from '@/v2/theme'
import { PenaltiesBody } from '@/v2/manage/PenaltiesBody'
import { TryCards } from '@/v2/today/TryCards'
import { TRY_ORDER } from '@/v2/today/tryCards'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications')

const apiMock = api as unknown as Mock<(p: string, o?: { method?: string; body?: unknown }) => Promise<unknown>>
const sizes = {
  small: { kind: 'points', amount: 10, earn_back: 'half' },
  medium: { kind: 'screen', amount: 30, earn_back: 'none' },
  big: { kind: 'block', amount: 1440, earn_back: 'all' },
}
let fam: Record<string, unknown>
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } })
const patches = () => apiMock.mock.calls.filter(([p, o]) => p === '/family' && o?.method === 'PATCH').map(([, o]) => o!.body)

beforeEach(() => {
  localStorage.clear()
  fam = { penalties_enabled: false, penalty_sizes: sizes, makeup_chores: ['Dishes'], hh_auto_boost: false, streak_freeze: false, hh_default_mult_x10: 20, hh_default_minutes: 60 }
  apiMock.mockReset().mockImplementation(async (p, o) => {
    if (p === '/me/tips') return { dismissed: ['try.celebrate', 'try.happyhour'] }
    if (p === '/family') return o?.method === 'PATCH' ? { ...fam, ...(o.body as object) } : fam
    if (p === '/kids') return []
    if (p === '/happy-hour') return { active: [{}], recent: [] }
    if (p === '/today') return { kids: [], try_trust_kid: null, waiting_at_reset_days: 0 }
    return {}
  })
})

const body = (save = jest.fn(async () => true)) => {
  const ui = (f: Record<string, unknown>) => (
    <MantineProvider theme={fridgeTheme}>
      <PenaltiesBody fam={f as never} save={save as never} />
    </MantineProvider>
  )
  const r = render(ui(fam))
  return { save, again: (f: Record<string, unknown>) => r.rerender(ui(f)) }
}

test('off: only the switch shows', async () => {
  body()
  expect(screen.getByLabelText('Penalties')).not.toBeChecked()
  expect(screen.queryByText('Small')).toBeNull()
  expect(screen.queryByLabelText('New make-up chore')).toBeNull()
})

test('switch saves penalties_enabled', async () => {
  const { save } = body()
  await userEvent.click(screen.getByLabelText('Penalties'))
  expect(save).toHaveBeenCalledWith({ penalties_enabled: true })
})

test('on: three sizes editable, saved as a function of latest family', async () => {
  fam.penalties_enabled = true
  const { save } = body()
  for (const n of ['Small', 'Medium', 'Big']) expect(screen.getByRole('group', { name: `${n} penalty` })).toBeInTheDocument()
  expect(screen.getByText('−10 points')).toBeInTheDocument()
  await userEvent.click(screen.getAllByRole('button', { name: 'change' })[0])
  await userEvent.click(screen.getByRole('button', { name: 'More' }))
  const fn = (save.mock.calls[0] as unknown[])[0] as (f: unknown) => { penalty_sizes: typeof sizes }
  expect(fn(fam).penalty_sizes.small).toEqual({ kind: 'points', amount: 15, earn_back: 'half' })
  expect(fn(fam).penalty_sizes.big).toEqual(sizes.big)
})

test('make-up list adds and removes, and stops at 12', async () => {
  fam.penalties_enabled = true
  const { save, again } = body()
  await userEvent.type(screen.getByLabelText('New make-up chore'), 'Vacuum')
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  const add = (save.mock.calls[0] as unknown[])[0] as (f: unknown) => { makeup_chores: string[] }
  expect(add(fam).makeup_chores).toEqual(['Dishes', 'Vacuum'])
  await userEvent.click(screen.getByRole('button', { name: 'Remove Dishes' }))
  const rm = (save.mock.calls[1] as unknown[])[0] as (f: unknown) => { makeup_chores: string[] }
  expect(rm(fam).makeup_chores).toEqual([])
  again({ ...fam, makeup_chores: Array.from({ length: 12 }, (_, i) => `c${i}`) })
  expect(screen.queryByLabelText('New make-up chore')).toBeNull()
})

test('block size shows a duration, not raw minutes', async () => {
  fam.penalties_enabled = true
  fam.penalty_sizes = { ...sizes, medium: { kind: 'block', amount: 1440, earn_back: 'none' } }
  body()
  expect(screen.getAllByText('No devices, 1 day').length).toBeGreaterThan(1)
  await userEvent.click(screen.getAllByRole('button', { name: 'change' })[2])
  expect(screen.getByText('1 day')).toBeInTheDocument()
})

test('add re-checks duplicates and the cap against the latest list; text kept on failure', async () => {
  fam.penalties_enabled = true
  const save = jest.fn(async () => false)
  body(save)
  await userEvent.type(screen.getByLabelText('New make-up chore'), ' dishes ')
  await userEvent.click(screen.getByRole('button', { name: 'Add' }))
  const fn = (save.mock.calls[0] as unknown[])[0] as (f: unknown) => { makeup_chores: string[] }
  expect(fn({ makeup_chores: ['Dishes'] }).makeup_chores).toEqual(['Dishes'])
  const full = Array.from({ length: 12 }, (_, i) => `c${i}`)
  expect(fn({ makeup_chores: full }).makeup_chores).toEqual(full)
  expect(screen.getByLabelText('New make-up chore')).toHaveValue(' dishes ')
})

test('Try card is last, and Turn on enables penalties', async () => {
  expect(TRY_ORDER.at(-1)).toBe('try.penalties')
  render(
    <QueryClientProvider client={client()}>
      <TryCards />
    </QueryClientProvider>,
  )
  expect(await screen.findByText('Penalties: take something away, say why, and let them earn part back.')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
  await waitFor(() => expect(patches()).toContainEqual({ penalties_enabled: true }))
})

test('no Try card once penalties are on', async () => {
  fam.penalties_enabled = true
  render(
    <QueryClientProvider client={client()}>
      <TryCards />
    </QueryClientProvider>,
  )
  await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/today'))
  expect(screen.queryByText(/Penalties: take/)).toBeNull()
})
