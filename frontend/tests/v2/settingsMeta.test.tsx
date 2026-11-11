import { describe, expect, test } from '@jest/globals'
import { ago, countLine, lastActive } from '@/v2/manage/settingsMeta'

const now = Date.parse('2026-10-27T12:00:00Z')
const back = (min: number) => new Date(now - min * 60_000).toISOString()

describe('settingsMeta', () => {
  test('ago buckets', () => {
    expect(ago(back(1), now)).toBe('just now')
    expect(ago(back(5), now)).toBe('5 min ago')
    expect(ago(back(180), now)).toBe('3 h ago')
    expect(ago(back(1440), now)).toBe('1 day ago')
    expect(ago(back(3 * 1440), now)).toBe('3 days ago')
  })
  test('lastActive', () => {
    expect(lastActive(null)).toBe('Never signed in')
    expect(lastActive(back(5), now)).toBe('Last active 5 min ago')
    expect(lastActive(back(1), now)).toBe('Last active now')
  })
  test('countLine', () => {
    expect(countLine(1, 'parent')).toBe('1 parent')
    expect(countLine(4, 'device')).toBe('4 devices')
    expect(countLine(undefined, 'device')).toBeUndefined()
  })
})
