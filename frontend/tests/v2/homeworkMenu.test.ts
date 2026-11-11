import { describe, expect, test } from '@jest/globals'
import { homeworkItems } from '@/v2/manage/homeworkMenu'

describe('homeworkItems', () => {
  test('one entry per length, divider on the first, each starts with its minutes', () => {
    const onStart = jest.fn()
    const items = homeworkItems({ hidden: false, onStart })
    expect(items.map((i) => i.label)).toEqual(['Homework 30 min', 'Homework 1 hour', 'Homework 90 min', 'Homework 2 hours'])
    expect(items.map((i) => !!i.divider)).toEqual([true, false, false, false])
    items[2].onClick?.()
    expect(onStart).toHaveBeenCalledWith(90)
  })

  test('hidden while the target is open', () => {
    expect(homeworkItems({ hidden: true, onStart: jest.fn() }).every((i) => i.hidden)).toBe(true)
  })
})
