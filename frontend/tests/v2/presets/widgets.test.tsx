import { describe, expect, test } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { StylePicker } from '@/v2/presets/StylePicker'
import { StyleSeg } from '@/v2/presets/StyleSeg'
import { LimitsTable } from '@/v2/presets/LimitsTable'
import type { KidPlan, PresetCatalog } from '@/v2/presets/types'

;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
const wrap = (ui: React.ReactElement) => render(<MantineProvider>{ui}</MantineProvider>)
const plan = (o: Partial<KidPlan> = {}): KidPlan => ({ chores: ['a', 'b', 'c'], screen: 120, bedtime: '20:30', weekend: '22:00', lock: true, trust: false, photo: false, ...o })
const catalog: PresetCatalog = {
  style: 'balanced',
  kids: [],
  plans: {
    little: { relaxed: plan(), balanced: plan(), strict: plan() },
    kid: { relaxed: plan(), balanced: plan(), strict: plan() },
    teen: { relaxed: plan({ chores: ['a', 'b'], screen: 210, bedtime: '22:00', lock: false, trust: true }), balanced: plan(), strict: plan() },
  },
  family: { relaxed: { banked: true }, balanced: { banked: true }, strict: { banked: false } },
}

describe('StylePicker', () => {
  test('three radios, pill on Balanced, click and arrows change', async () => {
    const calls: string[] = []
    wrap(<StylePicker value="balanced" onChange={(s) => calls.push(s)} />)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: /Balanced/ })).toBeChecked()
    expect(screen.getByText('Most families')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('radio', { name: /Strict/ }))
    expect(calls).toEqual(['strict'])
    screen.getByRole('radio', { name: /Balanced/ }).focus()
    await userEvent.keyboard('{ArrowLeft}')
    expect(calls[1]).toBe('relaxed')
  })
})

describe('StyleSeg', () => {
  test('changes style', async () => {
    const calls: string[] = []
    wrap(<StyleSeg value="balanced" label="Style for Ivy" onChange={(s) => calls.push(s)} />)
    await userEvent.click(screen.getByText('Strict'))
    expect(calls).toEqual(['strict'])
  })
})

describe('LimitsTable', () => {
  const kids = [{ id: 1, name: 'Ivy', age_group: 'kid' as const, style: 'balanced' as const }, { id: 2, name: 'Theo', age_group: 'teen' as const, style: 'relaxed' as const }]
  test('closed by default, a column per kid, family note', () => {
    const { container } = wrap(<LimitsTable catalog={catalog} kids={kids} />)
    expect(container.querySelector('details')).not.toHaveAttribute('open')
    expect(screen.getByText('See what this sets')).toBeInTheDocument()
    expect(screen.getByText('Ivy · Balanced')).toBeInTheDocument()
    expect(screen.getByText('Theo · Relaxed')).toBeInTheDocument()
    expect(screen.getByText('Internet locks till chores done').closest('tr')).toHaveTextContent('yesno')
    expect(screen.getByText('Bedtime').closest('tr')).toHaveTextContent('8:3010:00')
    expect(screen.getByText(/Family-wide: banked time on/)).toBeInTheDocument()
  })
})
