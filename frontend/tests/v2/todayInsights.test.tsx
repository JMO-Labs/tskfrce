import { fireEvent, render, screen } from '@testing-library/react'
import { GoalsCard } from '../../src/v2/today/GoalsCard'
import { WeekCard } from '../../src/v2/today/WeekCard'
import type { InsightGoal, InsightWeek } from '../../src/v2/today/insightsTypes'

const kids = [
  { id: 1, name: 'Richard 6' },
  { id: 2, name: 'Evie 12' },
]
const goals: InsightGoal[] = [
  { id: 1, name: 'Zoo trip', kid_id: 1, family: false, saved: 78, target: 100, pct: 78, eta_days: 5 },
  { id: 2, name: 'Headphones', kid_id: 2, family: false, saved: 92, target: 100, pct: 92, eta_days: 2 },
  { id: 3, name: 'Lego', kid_id: null, family: true, saved: 0, target: 100, pct: 0, eta_days: null },
]

const series = Array.from({ length: 14 }, (_, i) => ({ day: `2026-10-${String(8 + i).padStart(2, '0')}`, rate: i === 3 ? null : 60 + i, done: 3, total: 4 }))
const week: InsightWeek = {
  rate: 81,
  delta: 9,
  goal: 75,
  series,
  when: [
    [1, 0, 0, 0, 0, 0, 0],
    [0, 4, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 2],
  ],
  has_history: true,
}

describe('GoalsCard', () => {
  it('lists goals closest first with % and ETA', () => {
    render(<GoalsCard goals={goals} kids={kids} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows[0]).toHaveTextContent('Headphones')
    expect(rows[0]).toHaveTextContent('92%')
    expect(rows[0]).toHaveTextContent('~2 days')
    expect(rows[1]).toHaveTextContent('Zoo trip')
  })
  it('says nothing about ETA when there is no recent earning', () => {
    render(<GoalsCard goals={goals} kids={kids} />)
    expect(screen.getByText('Lego').closest('li')).toHaveTextContent('no pace yet')
  })
  it('draws a bar per goal at its percentage', () => {
    render(<GoalsCard goals={goals} kids={kids} />)
    expect(screen.getAllByRole('progressbar')[0]).toHaveAttribute('aria-valuenow', '92')
  })
  it('is calm when there are no goals', () => {
    render(<GoalsCard goals={[]} kids={kids} />)
    expect(screen.getByText(/no goals yet/i)).toBeInTheDocument()
  })
})

describe('WeekCard', () => {
  it('shows the hero rate and delta vs last week', () => {
    render(<WeekCard week={week} />)
    expect(screen.getByText('81%')).toBeInTheDocument()
    expect(screen.getByText(/\+9 pts vs last week/)).toBeInTheDocument()
  })
  it('draws the dashed 75% goal line', () => {
    const { container } = render(<WeekCard week={week} />)
    const line = container.querySelector('line[data-goal]')
    expect(line).toHaveAttribute('stroke-dasharray')
    expect(screen.getByText('goal 75%')).toBeInTheDocument()
  })
  it('has a tooltip on every trend point and grid cell', () => {
    const { container } = render(<WeekCard week={week} />)
    expect(container.querySelectorAll('[data-trend][data-tip]')).toHaveLength(14)
    const cells = container.querySelectorAll('[data-cell]')
    expect(cells).toHaveLength(21)
    cells.forEach((c) => expect(c).toHaveAttribute('data-tip'))
    expect(cells[8]).toHaveAttribute('data-tip', 'Tue PM: 4 chores')
  })
  it('shows the tip text on hover', () => {
    const { container } = render(<WeekCard week={week} />)
    fireEvent.pointerOver(container.querySelectorAll('[data-cell]')[8])
    expect(screen.getByRole('tooltip')).toHaveTextContent('Tue PM: 4 chores')
  })
  it('uses accent opacity steps only (single hue)', () => {
    const { container } = render(<WeekCard week={week} />)
    const cells = Array.from(container.querySelectorAll<HTMLElement>('[data-cell]'))
    expect(Number(cells[8].style.opacity)).toBeGreaterThan(Number(cells[0].style.opacity))
    cells.forEach((c) => expect(c.style.background).toBe(''))
  })
  it('is calm for a family with no history', () => {
    render(<WeekCard week={{ ...week, rate: null, delta: null, has_history: false }} />)
    expect(screen.getByText(/first week/i)).toBeInTheDocument()
    expect(screen.queryByText('0%')).not.toBeInTheDocument()
  })
  it('omits the delta when there is no previous week', () => {
    render(<WeekCard week={{ ...week, delta: null }} />)
    expect(screen.queryByText(/vs last week/)).not.toBeInTheDocument()
  })
})
