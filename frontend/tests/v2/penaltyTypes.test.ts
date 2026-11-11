import { duration, earnLine, kidTitle, presetFor, repeatHint, stepAmount, whatLine } from '@/v2/penaltyTypes'
import type { KidPenalty, PenaltyDraft } from '@/v2/penaltyTypes'

const d = (o: Partial<PenaltyDraft>): PenaltyDraft => ({ kind: 'points', amount: 20, earn_back: 'none', reason: '', ...o })

test('duration', () => {
  expect(duration(1440)).toBe('1 day')
  expect(duration(4320)).toBe('3 days')
  expect(duration(120)).toBe('2 hours')
  expect(duration(1620)).toBe('1 day 3 hours')
})
test('whatLine', () => {
  expect(whatLine(d({}), 'x')).toBe('−20 points')
  expect(whatLine(d({ kind: 'screen', amount: 30 }), 'x')).toBe('−30 min saved screen time')
  expect(whatLine(d({ kind: 'block', amount: 1440 }), 'Nintendo')).toBe('No Nintendo, 1 day')
  expect(whatLine(d({ kind: 'block', amount: 1440 }), 'devices')).toBe('No devices, 1 day')
})
test('earnLine/preset/hint', () => {
  expect(earnLine('half')).toBe('Earn back half')
  expect(earnLine('all')).toBe('Earn back all')
  expect(earnLine('none')).toBe('No earn-back')
  expect([0, 1, 2, 5].map(presetFor)).toEqual(['small', 'medium', 'big', 'big'])
  expect([0, 1, 2, 3].map(repeatHint)).toEqual([null, '2nd this week', '3rd this week', '4th this week'])
})
test('stepAmount', () => {
  expect(stepAmount('points', 20, 1)).toBe(25)
  expect(stepAmount('points', 5, -1)).toBe(5)
  expect(stepAmount('points', 1000, 1)).toBe(1000)
  expect(stepAmount('screen', 30, 1)).toBe(45)
  expect(stepAmount('screen', 15, -1)).toBe(15)
  expect(stepAmount('block', 120, 1)).toBe(180)
  expect(stepAmount('block', 60, -1)).toBe(60)
  expect(stepAmount('block', 1440, 1)).toBe(2880)
  expect(stepAmount('block', 1440, -1)).toBe(1380)
  expect(stepAmount('block', 20160, 1)).toBe(20160)
})
test('kidTitle', () => {
  const p = (o: Partial<KidPenalty>) => ({ kind: 'block', label: 'Nintendo', amount_taken: 20, ends_at: null, ...o }) as KidPenalty
  const now = new Date(2026, 10, 10, 9, 0)
  expect(kidTitle(p({}), now)).toBe('No Nintendo')
  expect(kidTitle(p({ kind: 'points' }), now)).toBe('20 points taken')
  expect(kidTitle(p({ kind: 'screen' }), now)).toBe('20 min of saved screen time taken')
  expect(kidTitle(p({ ends_at: new Date(2026, 10, 10, 15, 30).toISOString() }), now)).toBe('No Nintendo until 3:30 pm')
  expect(kidTitle(p({ ends_at: new Date(2026, 10, 12, 9, 0).toISOString() }), now)).toBe('No Nintendo until Thursday')
})
