import { describe, expect, test } from '@jest/globals'
import { render } from '@testing-library/react'
import { readFileSync } from 'fs'
import { join } from 'path'
import { KidsList } from '@/v2/manage/KidsList'
import type { Kid, TodayKid } from '@/v2/types'

const mockToday: { kids: Partial<TodayKid>[] } = { kids: [] }
jest.mock('@/v2/hooks/useToday', () => ({ useToday: () => ({ data: mockToday }) }))

const kid = (id: number, full_name: string, has_pin = true) => ({ id, full_name, username: full_name.toLowerCase(), avatar: null, has_pin }) as Kid

describe('kids list ring column (audit 23)', () => {
  test('every ring sits in its own right column, never on the name line, whatever the name or chip', () => {
    mockToday.kids = [
      { id: 1, done: 2, total: 6, points: 240, online_all: true, devices: [{ id: 1, name: 'x', vendor: null, online: true }], progress: { level: 7 } as never },
      { id: 2, done: 10, total: 10, points: 9999, online_all: false, devices: [] },
      { id: 3, done: 0, total: 1, points: 5, online_all: false, devices: [{ id: 2, name: 'y', vendor: null, online: false }] },
    ] as TodayKid[]
    const kids = [kid(1, 'Maya'), kid(2, 'Bartholomew Montgomery-Smythe the Third'), kid(3, 'Al', false), kid(4, 'Zed')]
    const { container } = render(<KidsList kids={kids} onSelect={() => {}} />)
    const rows = [...container.querySelectorAll('.kl-card')]
    expect(rows).toHaveLength(4)
    for (const row of rows) {
      expect(row.querySelector('.kl-line .p-ring')).toBeNull()
      const col = row.querySelector('.kl-ring')!
      expect(col).not.toBeNull()
      expect(col.parentElement).toBe(row)
    }
    expect(rows.slice(0, 3).every((r) => r.querySelector('.kl-ring .p-ring'))).toBe(true)
    // a kid with no Today data keeps an empty ring cell so the grid does not shift
    expect(rows[3].querySelector('.kl-ring')!.children).toHaveLength(0)
  })

  test('the kid row grid declares a fixed-width ring track', () => {
    const css = readFileSync(join(__dirname, '../../src/v2/parent/kid-focus.css'), 'utf8')
    const i = css.indexOf('.kl-card {')
    expect(i).toBeGreaterThan(-1)
    const body = css.slice(i, css.indexOf('}', i))
    expect(body).toMatch(/display:\s*grid/)
    expect(body).toMatch(/grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+\d+px/)
  })
})
