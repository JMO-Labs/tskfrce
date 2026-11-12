import { renderHook } from '@testing-library/react'
import { track } from '@/v2/eval/track'
import { useSectionView } from '@/v2/eval/useSectionView'

jest.mock('@/v2/eval/track', () => ({ track: jest.fn() }))

test('emits screen_view with section on mount and on change only', () => {
  const { rerender } = renderHook(({ s }) => useSectionView('/settings', s), { initialProps: { s: 'family' } })
  expect(track).toHaveBeenLastCalledWith('screen_view', { route: '/settings', section: 'family' }, { kid: false })
  rerender({ s: 'family' })
  expect(track).toHaveBeenCalledTimes(1)
  rerender({ s: 'wifi' })
  expect(track).toHaveBeenLastCalledWith('screen_view', { route: '/settings', section: 'wifi' }, { kid: false })
})

test('kid tabs are tracked as kid events', () => {
  renderHook(() => useSectionView('/kid', 'rewards', true))
  expect(track).toHaveBeenLastCalledWith('screen_view', { route: '/kid', section: 'rewards' }, { kid: true })
})
