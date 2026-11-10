import { beforeEach, describe, expect, test } from '@jest/globals'
import { renderHook } from '@testing-library/react'
import { notifications } from '@mantine/notifications'
import { FREEZE_MSG, useFreezeNotice } from '@/v2/kid/freezeNotice'

jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
const show = notifications.show as jest.Mock

beforeEach(() => {
  show.mockClear()
  localStorage.clear()
})
const msgs = () => show.mock.calls.map(([o]) => (o as { message: string }).message)

describe('useFreezeNotice', () => {
  test('a new frozen date shows the kind notice once per device', () => {
    const { rerender, unmount } = renderHook(({ f }) => useFreezeNotice(f, 3, true), { initialProps: { f: [] as string[] } })
    expect(show).not.toHaveBeenCalled()
    rerender({ f: ['2026-11-05'] })
    expect(msgs()).toEqual([FREEZE_MSG])
    expect(FREEZE_MSG).toBe('Freeze used: your streak is safe 🧊')
    rerender({ f: ['2026-11-05'] })
    unmount()
    renderHook(() => useFreezeNotice(['2026-11-05'], 3, true))
    expect(show).toHaveBeenCalledTimes(1)
  })
  test('a later freeze shows again; the stored value stays one date per kid', () => {
    renderHook(() => useFreezeNotice(['2026-11-01'], 3, true))
    renderHook(() => useFreezeNotice(['2026-11-01', '2026-11-05'], 3, true))
    expect(show).toHaveBeenCalledTimes(2)
    expect(localStorage.getItem('t4c-freeze-seen-3')).toBe('2026-11-05')
    expect(localStorage.length).toBe(1)
  })
  test('each kid on a shared device gets their own notice', () => {
    renderHook(() => useFreezeNotice(['2026-11-05'], 3, true))
    renderHook(() => useFreezeNotice(['2026-11-05'], 4, true))
    expect(show).toHaveBeenCalledTimes(2)
  })
  test('off (parent preview) or no freezes: nothing shown, nothing stored', () => {
    renderHook(() => useFreezeNotice(['2026-11-05'], 3, false))
    renderHook(() => useFreezeNotice(undefined, 3, true))
    expect(show).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
  })
})
