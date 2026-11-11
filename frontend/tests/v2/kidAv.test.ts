import { describe, test, expect } from '@jest/globals'
import { kidBadges } from '@/v2/KidAv'

describe('kidBadges', () => {
  test('two-letter labels, distinct colors', () => {
    const m = kidBadges([{ id: 1, name: 'Richard' }, { id: 2, name: 'Evie' }])
    expect([m.get(1)!.label, m.get(2)!.label]).toEqual(['Ri', 'Ev'])
    expect(m.get(1)!.color).not.toBe(m.get(2)!.color)
  })
  test('same first name falls back to first + last initial', () => {
    const m = kidBadges([{ id: 1, name: 'Richard 6' }, { id: 2, name: 'Richard 9' }, { id: 3, name: 'Rita' }])
    expect([1, 2, 3].map((i) => m.get(i)!.label)).toEqual(['R6', 'R9', 'Ri'])
  })
  test('identical names get an index', () => {
    const m = kidBadges([{ id: 1, name: 'Sam' }, { id: 2, name: 'Sam' }])
    expect([m.get(1)!.label, m.get(2)!.label]).toEqual(['S1', 'S2'])
  })
})
