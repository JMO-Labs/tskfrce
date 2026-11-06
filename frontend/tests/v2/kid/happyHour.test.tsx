import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { HappyHourBanner } from '@/v2/kid/HappyHourBanner'
import { boosted, hhLeft, mmss } from '@/v2/kid/happyHour'
import { PointsChip } from '@/v2/kid/KidChip'
import type { KidChore } from '@/v2/types'

let reduced = false
beforeEach(() => {
  reduced = false
  jest.useFakeTimers().setSystemTime(Date.parse('2026-11-06T16:00:00Z'))
  window.matchMedia = ((q: string) => ({ matches: q.includes('reduce') ? reduced : false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
})
afterEach(() => jest.useRealTimers())

const at = (s: number) => new Date(Date.now() + s * 1000).toISOString()

describe('happy hour helpers', () => {
  test('mmss and hhLeft', () => {
    expect(mmss(41 * 60 + 58)).toBe('41:58')
    expect(mmss(5)).toBe('0:05')
    expect(mmss(3725)).toBe('1:02:05')
    expect(hhLeft({ ends_at: at(90), multiplier: 2 }, Date.now())).toBe(90)
    expect(hhLeft(null, Date.now())).toBe(0)
    expect(hhLeft({ ends_at: at(-1), multiplier: 2 }, Date.now())).toBe(0)
  })
  test('boosted only while active and above base', () => {
    const c = { points: 10, points_now: 20 } as KidChore
    const hh = { ends_at: at(60), multiplier: 2 }
    expect(boosted(c, hh, Date.now())).toBe(20)
    expect(boosted(c, null, Date.now())).toBeUndefined()
    expect(boosted(c, { ends_at: at(-5), multiplier: 2 }, Date.now())).toBeUndefined()
    expect(boosted({ points: 10, points_now: 10 } as KidChore, hh, Date.now())).toBeUndefined()
  })
})

describe('HappyHourBanner', () => {
  test('nothing without a Happy Hour', () => {
    const { container } = render(<HappyHourBanner hh={null} onGo={() => {}} />)
    expect(container).toBeEmptyDOMElement()
  })
  test('shows multiplier text and ticks every second', () => {
    render(<HappyHourBanner hh={{ ends_at: at(41 * 60 + 58), multiplier: 1.5 }} onGo={() => {}} />)
    expect(screen.getByText('HAPPY HOUR!')).toBeInTheDocument()
    expect(screen.getByText('Every chore is worth 1.5×')).toBeInTheDocument()
    expect(screen.getByText('41:58')).toBeInTheDocument()
    act(() => void jest.advanceTimersByTime(2000))
    expect(screen.getByText('41:56')).toBeInTheDocument()
  })
  test('hides itself at zero without a refetch', () => {
    render(<HappyHourBanner hh={{ ends_at: at(3), multiplier: 2 }} onGo={() => {}} />)
    expect(screen.getByText('Every chore is worth 2×')).toBeInTheDocument()
    act(() => void jest.advanceTimersByTime(3000))
    expect(screen.queryByText('HAPPY HOUR!')).toBeNull()
  })
  test('Go calls onGo', () => {
    const go = jest.fn()
    render(<HappyHourBanner hh={{ ends_at: at(60), multiplier: 3 }} onGo={go} />)
    fireEvent.click(screen.getByRole('button', { name: /Go/ }))
    expect(go).toHaveBeenCalled()
  })
  test('reduced motion is a still banner', () => {
    reduced = true
    render(<HappyHourBanner hh={{ ends_at: at(60), multiplier: 2 }} onGo={() => {}} />)
    expect(screen.getByTestId('hh')).toHaveAttribute('data-still', 'true')
  })
  test('animated by default', () => {
    render(<HappyHourBanner hh={{ ends_at: at(60), multiplier: 2 }} onGo={() => {}} />)
    expect(screen.getByTestId('hh')).not.toHaveAttribute('data-still')
  })
})

describe('PointsChip doubled', () => {
  test('old points struck, new highlighted', () => {
    render(<PointsChip points={10} now={20} />)
    expect(screen.getByText('+10').tagName).toBe('S')
    expect(screen.getByText('+20')).toHaveAttribute('data-x2')
  })
  test('plain without now', () => {
    render(<PointsChip points={10} />)
    expect(screen.getByText('+10', { exact: false }).tagName).not.toBe('S')
  })
})
