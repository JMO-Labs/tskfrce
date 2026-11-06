import { describe, expect, test } from '@jest/globals'
import { planShow, type PlanCtx } from '@/v2/kid/celebrate/plan'
import { seeded } from '@/v2/kid/celebrate/pick'
import { mascotsFor, activeSeason } from '@/v2/kid/celebrate/catalog'

const ev = { kind: 'submit' as const, key: 's:1', title: 'Dishes', points: 20 }
const ctx = (over: Partial<PlanCtx> = {}): PlanCtx => ({
  level: 'full',
  mode: 'kid',
  reduced: false,
  rng: seeded(1),
  last: null,
  kidLevel: 1,
  date: new Date('2026-06-01T12:00:00Z'),
  ...over,
})

describe('planShow', () => {
  test('off shows nothing', () => {
    expect(planShow(ev, ctx({ level: 'off' }))).toBeNull()
  })

  test('small is card pop and tag only', () => {
    const s = planShow(ev, ctx({ level: 'small' }))!
    expect(s.kind).toBe('small')
    expect(s.combo).toBeNull()
  })

  test('reduced motion gives the static badge', () => {
    expect(planShow(ev, ctx({ reduced: true }))!.kind).toBe('static')
    expect(planShow(ev, ctx({ reduced: true, level: 'off' }))).toBeNull()
  })

  test('full gives a combo', () => {
    const s = planShow(ev, ctx())!
    expect(s.kind).toBe('full')
    expect(s.combo).not.toBeNull()
  })

  test('Little always gets a mascot', () => {
    const rng = seeded(9)
    for (let i = 0; i < 30; i++) expect(planShow(ev, ctx({ mode: 'little', rng }))!.combo!.mascot).not.toBeNull()
  })

  test.each(['level', 'streak'] as const)('big moment %s always gets a mascot', (kind) => {
    const rng = seeded(5)
    for (let i = 0; i < 30; i++) expect(planShow({ ...ev, kind, big: true }, ctx({ rng }))!.combo!.mascot).not.toBeNull()
  })

  test('first chore of a Happy Hour always gets a mascot', () => {
    const rng = seeded(11)
    for (let i = 0; i < 30; i++) expect(planShow({ ...ev, big: true }, ctx({ rng }))!.combo!.mascot).not.toBeNull()
  })
})

describe('catalog', () => {
  test('mascots unlock with level', () => {
    expect(mascotsFor(1, new Date('2026-06-01')).length).toBeLessThan(mascotsFor(10, new Date('2026-06-01')).length)
    expect(mascotsFor(1, new Date('2026-06-01'))).toContain('trex')
  })

  test('December adds its seasonal set', () => {
    expect(activeSeason(new Date('2026-12-10T12:00:00'))?.id).toBe('december')
    expect(activeSeason(new Date('2026-06-10T12:00:00'))).toBeNull()
    expect(mascotsFor(1, new Date('2026-12-10T12:00:00'))).toContain('snowman')
  })
})
