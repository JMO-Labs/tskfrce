import { track } from '@/v2/eval/track'
import { choresKept, devicesFound, presetWhat, setupDetail } from '@/v2/eval/setupDetail'

jest.mock('@/v2/eval/track', () => ({ track: jest.fn() }))

beforeEach(() => jest.clearAllMocks())

test('devices found buckets match the backend allow-list', () => {
  expect([0, 1, 3, 4, 9, 10, 40].map(devicesFound)).toEqual([
    'devices_found_0', 'devices_found_1_3', 'devices_found_1_3', 'devices_found_4_9',
    'devices_found_4_9', 'devices_found_10p', 'devices_found_10p',
  ])
})

test('chores kept is a percent bucket of the offered starters', () => {
  expect([[0, 5], [2, 5], [3, 5], [4, 5], [5, 5], [6, 5], [0, 0]].map(([k, o]) => choresKept(k, o))).toEqual([
    'chores_kept_0', 'chores_kept_lt50', 'chores_kept_50_99', 'chores_kept_50_99',
    'chores_kept_100', 'chores_kept_100', 'chores_kept_100',
  ])
})

test('preset is the family style, or mixed when kids differ', () => {
  expect(presetWhat('strict', null)).toBe('preset_strict')
  expect(presetWhat('balanced', { 1: 'balanced', 2: 'balanced' })).toBe('preset_balanced')
  expect(presetWhat('balanced', { 1: 'relaxed', 2: 'strict' })).toBe('preset_mixed')
})

test('setupDetail sends step + what only', () => {
  setupDetail(7, 'rescan')
  expect(track).toHaveBeenCalledWith('setup_detail', { step: 7, what: 'rescan' })
})
