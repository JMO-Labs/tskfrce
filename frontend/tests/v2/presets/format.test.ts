import { describe, expect, test } from '@jest/globals'
import { clock, fmtValue, keyLabel, minutes, ROWS, STYLE_LABEL } from '@/v2/presets/format'

describe('preset format', () => {
  test('minutes', () => {
    expect(minutes(120)).toBe('2h')
    expect(minutes(210)).toBe('3h 30m')
    expect(minutes(30)).toBe('30m')
  })
  test('clock', () => {
    expect(clock('20:30')).toBe('8:30')
    expect(clock('22:00')).toBe('10:00')
  })
  test('labels and rows', () => {
    expect(STYLE_LABEL.balanced).toBe('Balanced')
    expect(ROWS.map((r) => r.label)).toEqual(['Chores a day', 'Screen time', 'Bedtime', 'Internet locks till chores done', 'You check every chore'])
    const plan = { chores: ['a', 'b'], screen: 90, bedtime: '21:00', weekend: '22:30', lock: false, trust: true, photo: false }
    expect(ROWS.map((r) => r.value(plan))).toEqual(['2', '1h 30m', '9:00', 'no', 'trust mode'])
    expect(ROWS[4].value({ ...plan, trust: false, photo: true })).toBe('yes + photo')
    expect(ROWS[4].value({ ...plan, trust: false })).toBe('yes')
  })
  test('keyLabel and fmtValue', () => {
    expect(keyLabel('screen')).toBe('Screen time')
    expect(keyLabel('banked')).toBe('Banked time')
    expect(keyLabel('penalties')).toBe('Penalties')
    expect(fmtValue('penalties', true)).toBe('on')
    expect(fmtValue('chores', ['a', 'b', 'c'])).toBe('3')
    expect(fmtValue('chores', 4)).toBe('4')
    expect(fmtValue('screen', 60)).toBe('1h')
    expect(fmtValue('bedtime', '20:00')).toBe('8:00')
    expect(fmtValue('banked', true)).toBe('on')
    expect(fmtValue('lock', false)).toBe('off')
  })
})
