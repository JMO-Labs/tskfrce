import { readFileSync } from 'fs'
import { join } from 'path'
import { renderHook } from '@testing-library/react'
import { api } from '@/v2/api'
import { track } from '@/v2/eval/track'
import { AREAS, featureFor, OPEN_SITES, useFeatureOpen } from '@/v2/eval/featureMap'

jest.mock('@/v2/eval/track', () => ({ track: jest.fn() }))
const trackMock = track as jest.Mock

const reply = (status: number) =>
  (global.fetch as jest.Mock).mockResolvedValue({ status, ok: status < 400, text: () => Promise.resolve('') })

beforeEach(() => {
  jest.clearAllMocks()
  global.fetch = jest.fn()
  reply(200)
})

// one real mutation per area: [area, method, path, body?, action]
const CASES: [string, string, string, unknown, string][] = [
  ['goals', 'POST', '/goals', undefined, 'create'],
  ['penalties', 'POST', '/penalties', undefined, 'create'],
  ['rewards', 'DELETE', '/rewards/4', undefined, 'delete'],
  ['badges', 'POST', '/custom-badges', undefined, 'create'],
  ['minigames', 'POST', '/kid/games/start', {}, 'start'],
  ['homework', 'POST', '/homework/requests/3/approve', undefined, 'done'],
  ['happy_hour', 'POST', '/happy-hour', {}, 'start'],
  ['time_bank', 'PATCH', '/screen-time', { enabled: false }, 'toggle_off'],
  ['integrations', 'PATCH', '/integrations/2', { trusted: true }, 'toggle_on'],
  ['notifications', 'DELETE', '/notify/places/5', undefined, 'delete'],
  ['devices', 'DELETE', '/devices/9', undefined, 'delete'],
  ['wifi', 'POST', '/network/wifi/forget', {}, 'delete'],
  ['updates', 'PATCH', '/updates', { channel: 'beta' }, 'done'],
  ['parents', 'POST', '/users/invite', {}, 'create'],
  ['reset', 'POST', '/auth/reset', {}, 'done'],
]

test('every T1 area has a mutation case and an open site', () => {
  expect(CASES.map((c) => c[0]).sort()).toEqual([...AREAS].sort())
  expect(Object.keys(OPEN_SITES).sort()).toEqual([...AREAS].sort())
})

test.each(CASES)('%s: %s %s emits its action through api()', async (area, method, path, body, action) => {
  await api(path, { method, body })
  expect(trackMock).toHaveBeenCalledWith('feature', { area, action }, { kid: false })
})

test.each(Object.entries(OPEN_SITES))('%s: emits open from %s', (area, file) => {
  const src = readFileSync(join(__dirname, '../../../src/v2', file), 'utf8')
  expect(src).toMatch(new RegExp(`useFeatureOpen\\('${area}'(, true)?\\)`))
})

test('useFeatureOpen emits open once', () => {
  const { rerender } = renderHook(() => useFeatureOpen('goals'))
  rerender()
  expect(trackMock).toHaveBeenCalledTimes(1)
  expect(trackMock).toHaveBeenCalledWith('feature', { area: 'goals', action: 'open' }, { kid: false })
})

test('failed mutation emits fail; GETs and unmapped paths emit nothing', async () => {
  reply(422)
  await expect(api('/rewards', { method: 'POST', body: {} })).rejects.toThrow()
  expect(trackMock).toHaveBeenCalledWith('feature', { area: 'rewards', action: 'fail' }, { kid: false })
  trackMock.mockClear()
  reply(200)
  await api('/rewards')
  await api('/chores/1/done', { method: 'POST' })
  await api('/eval/event', { method: 'POST', body: {} })
  expect(trackMock).not.toHaveBeenCalled()
})

test('kid mutations are sent as kid events (age_group only, no ids in props)', async () => {
  await api('/kid/games/finish', { method: 'POST', kid: true, body: { kid_id: 3 } })
  expect(trackMock).toHaveBeenCalledWith('feature', { area: 'minigames', action: 'done' }, { kid: true })
})

test('featureFor ignores ids in paths and maps toggles from the body', () => {
  expect(featureFor('PATCH', '/integrations/7', { trusted: false })).toEqual({ area: 'integrations', action: 'toggle_off' })
  expect(featureFor('PATCH', '/integrations/7', { kid_widget_ids: [1] })).toBeNull()
  expect(featureFor('GET', '/goals')).toBeNull()
})
