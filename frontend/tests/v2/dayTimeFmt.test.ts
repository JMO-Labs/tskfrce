import { describe, expect, test } from '@jest/globals'
import { ageText, headerStamp } from '@/v2/today/dayTime'

describe('minute formatting', () => {
  test.each([[55, '55m'], [60, '1h'], [90, '1h 30m'], [840, '14h']])('%i -> %s', (m, t) => expect(ageText(m)).toBe(t))
})
describe('headerStamp', () => {
  const at = Date.parse('2026-11-11T16:12:00Z') // a Wednesday
  test('desktop has weekday and time', () => expect(headerStamp(at, 'UTC', false)).toBe('Wednesday · 4:12 PM'))
  test('phone has time only', () => expect(headerStamp(at, 'UTC', true)).toBe('4:12 PM'))
})
