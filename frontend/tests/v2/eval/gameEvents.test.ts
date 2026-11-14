import { renderHook, act } from '@testing-library/react'
import { track } from '@/v2/eval/track'
import { durationBucket, scoreBucket, useGameTelemetry } from '@/v2/eval/gameEvents'

jest.mock('@/v2/eval/track', () => ({ track: jest.fn() }))
const trackMock = track as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  jest.useFakeTimers().setSystemTime(0)
})
afterEach(() => jest.useRealTimers())

test('buckets match the backend allow-list', () => {
  expect([10_000, 45_000, 90_000, 200_000, 400_000].map(durationBucket)).toEqual(['<30s', '30-60s', '1-2m', '2-5m', '5m+'])
  expect([0, 5, 30, 150, 600, 4000].map(scoreBucket)).toEqual(['0', '1-9', '10-49', '50-199', '200-999', '1000+'])
})

test('start then finish emits game events with buckets, as a kid event', () => {
  const { result } = renderHook(() => useGameTelemetry())
  act(() => result.current.started('math-dash'))
  jest.setSystemTime(75_000)
  act(() => result.current.finished(37))
  expect(trackMock.mock.calls).toEqual([
    ['game', { id: 'math-dash', result: 'start' }, { kid: true }],
    ['game', { id: 'math-dash', result: 'finish', duration_bucket: '1-2m', score_bucket: '10-49' }, { kid: true }],
  ])
})

test('leaving mid-game emits quit; leaving after finish does not', () => {
  const a = renderHook(() => useGameTelemetry())
  act(() => a.result.current.started('quickfire'))
  jest.setSystemTime(20_000)
  a.unmount()
  expect(trackMock).toHaveBeenLastCalledWith('game', { id: 'quickfire', result: 'quit', duration_bucket: '<30s' }, { kid: true })
  trackMock.mockClear()
  const b = renderHook(() => useGameTelemetry())
  act(() => b.result.current.started('quickfire'))
  act(() => b.result.current.finished(5))
  b.unmount()
  expect(trackMock).toHaveBeenCalledTimes(2)
})

test('unknown game ids never leave the device', () => {
  const { result } = renderHook(() => useGameTelemetry())
  act(() => result.current.started("Mia's game"))
  act(() => result.current.finished(3))
  expect(trackMock).not.toHaveBeenCalled()
})
