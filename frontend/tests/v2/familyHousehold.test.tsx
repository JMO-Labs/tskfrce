import { beforeAll, beforeEach, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { FamilyCard } from '@/v2/manage/FamilyCards'
import type { Family } from '@/v2/types'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))

const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>
const fam = { name: 'R', timezone: 'UTC', reset_time: '06:00', early_bonus_cap: 5, streak_freeze: true, bedtime_auto: false, bedtime_auto_at: '21:00' } as Family
const show = () => {
  fakeRouter.reset('/settings', { section: 'family', open: 'hh' })
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider env="test">
        <FamilyCard fam={fam} />
      </MantineProvider>
    </QueryClientProvider>,
  )
}

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as never
})
beforeEach(() => {
  apiMock.mockReset().mockImplementation(async (_p, i) => (i?.method ? i.body : undefined))
})

test('day resets at label sits above field like Family name and Time zone (audit 22)', () => {
  show()
  const input = screen.getByLabelText('Day resets at')
  const field = input.closest('label')!
  expect(field).toHaveClass('pk-field')
  const head = field.firstElementChild!
  expect(head).toHaveClass('pk-label')
  expect(head.textContent).toMatch(/^Day resets at/)
  expect(input).not.toHaveClass('ch-w')
  expect(input.closest('.ch-setr')).toBeNull()
  // the (i) sits on the label line, right after the field (not inside the label, which must hold one control)
  expect(field.nextElementSibling).toHaveAttribute('aria-label', 'About the day reset')
  expect(field.querySelector('button')).toBeNull()
})

test('day reset still saves on blur', async () => {
  show()
  const r = screen.getByLabelText('Day resets at')
  fireEvent.change(r, { target: { value: '05:30' } })
  fireEvent.blur(r)
  await waitFor(() =>
    expect(apiMock.mock.calls.filter((c) => c[0] === '/family' && c[1]?.method === 'PATCH').map((c) => c[1]?.body)).toEqual([{ reset_time: '05:30' }]),
  )
})
