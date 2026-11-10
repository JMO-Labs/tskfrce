import { expect, test } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KidStrip } from '@/v2/today/KidStrip'
import type { TodayKid } from '@/v2/types'

const k = (id: number, name: string, extra: Partial<TodayKid>): TodayKid =>
  ({ id, name, avatar: null, online_all: false, chores: [], devices: [], ...extra }) as TodayKid

test('waiting count, all-done tick and selection', async () => {
  const pick = jest.fn()
  const all = jest.fn()
  const needs = jest.fn()
  render(
    <KidStrip
      kids={[k(1, 'Mia', { needs_you_count: 2, done: 3, total: 5 }), k(2, 'Ava', { done: 5, total: 5 }), k(3, 'Zed', { needs_you_count: 1 })]}
      selected={1}
      onSelect={pick}
      onAll={all}
      waiting={3}
      onNeeds={needs}
    />,
  )
  const mia = screen.getByRole('button', { name: /mia/i })
  expect(mia).toHaveAttribute('aria-pressed', 'true')
  expect(mia).not.toHaveTextContent('2') // the selected kid's count is on its card
  expect(screen.getByRole('button', { name: /zed/i })).toHaveTextContent('1')
  expect(screen.getByRole('button', { name: /ava/i })).toHaveTextContent('check')
  await userEvent.click(screen.getByRole('button', { name: /ava/i }))
  expect(pick).toHaveBeenCalledWith(2)
  await userEvent.click(screen.getByRole('button', { name: /All/ }))
  expect(all).toHaveBeenCalled()
  await userEvent.click(screen.getByRole('button', { name: /Needs/ }))
  expect(needs).toHaveBeenCalled()
  expect(screen.getByRole('button', { name: /Needs/ })).toHaveTextContent('3')
  expect(screen.queryByRole('link', { name: /add/i })).toBeNull()
})
