import { describe, expect, test } from '@jest/globals'
import { applyBody, hoursFromPlans, presetKids, tweakStart } from '@/v2/setup/setupJobs'
import type { KidPlan, PresetCatalog } from '@/v2/presets/types'
import type { Kid } from '@/v2/types'

const plan = (o: Partial<KidPlan> = {}): KidPlan => ({ chores: ['Make bed'], screen: 120, bedtime: '20:30', weekend: '22:00', lock: true, trust: false, photo: false, ...o })
const kids = [
  { id: 1, full_name: 'Ivy', username: 'ivy', age_group: 'kid' },
  { id: 2, full_name: null, username: 'theo', age_group: 'teen' },
] as Kid[]
const catalog = {
  style: null,
  kids: [],
  plans: {
    little: { relaxed: plan(), balanced: plan(), strict: plan() },
    kid: { relaxed: plan(), balanced: plan({ chores: ['Make bed', 'Tidy room'] }), strict: plan() },
    teen: { relaxed: plan({ chores: ['Make bed', 'Take out trash'], bedtime: '22:00', weekend: '23:30', lock: false, trust: true }), balanced: plan(), strict: plan() },
  },
  family: {},
} as unknown as PresetCatalog

describe('presetKids', () => {
  test('maps name, age and style; no styles means follow the family', () => {
    expect(presetKids(kids, null)).toEqual([
      { id: 1, name: 'Ivy', age_group: 'kid', style: null },
      { id: 2, name: 'theo', age_group: 'teen', style: null },
    ])
    expect(presetKids(kids, { 2: 'relaxed' }, 'strict').map((k) => k.style)).toEqual(['strict', 'relaxed'])
  })
})

describe('applyBody', () => {
  test('Different off: every kid follows the family', () => {
    expect(applyBody('strict', kids, null)).toEqual({ style: 'strict', kids: { 1: null, 2: null } })
  })
  test('Different on: each kid has a style, skip is passed along', () => {
    expect(applyBody('balanced', kids, { 2: 'relaxed' }, ['chores'])).toEqual({ style: 'balanced', kids: { 1: 'balanced', 2: 'relaxed' }, skip: ['chores'] })
  })
})

describe('hoursFromPlans', () => {
  const p = (id: number, name: string, o: Partial<KidPlan>) => ({ id, name, plan: plan(o) })
  test('equal bedtimes: two Everyone rules', () => {
    const r = hoursFromPlans([p(1, 'Ivy', {}), p(2, 'Theo', {})])
    expect(r.map((d) => [d.name, d.category, d.days, d.everyone, d.kid_ids, d.times])).toEqual([
      ['School nights', 'school_night', '01236', true, [], [{ start: '07:00', end: '20:30' }]],
      ['Weekends', 'weekend', '45', true, [], [{ start: '08:00', end: '22:00' }]],
    ])
  })
  test('different bedtimes: one rule per kid for each day type', () => {
    const r = hoursFromPlans([p(1, 'Ivy', {}), p(2, 'Theo', { bedtime: '22:00', weekend: '23:30' })])
    expect(r.map((d) => [d.name, d.everyone, d.kid_ids, d.times[0].end])).toEqual([
      ['School nights · Ivy', false, [1], '20:30'],
      ['School nights · Theo', false, [2], '22:00'],
      ['Weekends · Ivy', false, [1], '22:00'],
      ['Weekends · Theo', false, [2], '23:30'],
    ])
  })
  test('no kids: nothing to build from', () => expect(hoursFromPlans([])).toEqual([]))
})

describe('tweakStart', () => {
  test('pre-fills chores, who gets them, hours, lock and trust from the plans', () => {
    const t = tweakStart(presetKids(kids, { 2: 'relaxed' }, 'balanced'), catalog, 'balanced')
    expect(t.chores).toEqual(['Make bed', 'Tidy room', 'Take out trash'])
    expect(t.assign).toEqual({ 'Make bed': [1, 2], 'Tidy room': [1], 'Take out trash': [2] })
    expect(t.hours.map((d) => d.name)).toEqual(['School nights · Ivy', 'School nights · theo', 'Weekends · Ivy', 'Weekends · theo'])
    expect(t.lock).toBe(true)
    expect(t.trust).toEqual([2])
  })
})
