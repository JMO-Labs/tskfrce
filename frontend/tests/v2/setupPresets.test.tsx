import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StepStyle } from '@/v2/setup/StepStyle'
import { StepPlan } from '@/v2/setup/StepPlan'
import { StepHours } from '@/v2/setup/StepHours'
import { DEFAULT_DRAFTS } from '@/v2/setup/setupJobs'
import { api } from '@/v2/api'
import { catalog } from './helpers/presetCatalog'
import type { Kid } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
const apiMock = api as unknown as Mock<(p: string) => Promise<unknown>>
;(globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} }
if (!window.matchMedia) window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  )
const ivy = { id: 1, full_name: 'Ivy', username: 'ivy', age_group: 'kid' } as Kid
const theo = { id: 2, full_name: 'Theo', username: 'theo', age_group: 'teen' } as Kid

beforeEach(() => {
  apiMock.mockReset().mockResolvedValue(catalog)
})

describe('StepStyle', () => {
  test('three choices, Balanced picked, limits table collapsed, no per-kid switch with one kid', async () => {
    const { container } = wrap(<StepStyle kids={[ivy]} style="balanced" onStyle={() => {}} styles={null} onStyles={() => {}} />)
    expect(screen.getAllByRole('radio')).toHaveLength(3)
    expect(screen.getByRole('radio', { name: /Balanced/ })).toBeChecked()
    expect(screen.queryByRole('switch')).toBeNull()
    expect(await screen.findByText('See what this sets')).toBeInTheDocument()
    expect(container.querySelector('details')).not.toHaveAttribute('open')
  })

  test('picking a style reports it', async () => {
    const onStyle = jest.fn()
    wrap(<StepStyle kids={[]} style="balanced" onStyle={onStyle} styles={null} onStyles={() => {}} />)
    await userEvent.click(screen.getByRole('radio', { name: /Strict/ }))
    expect(onStyle).toHaveBeenCalledWith('strict')
  })

  test('with 2 kids the switch gives each kid the family style to start; off clears them', async () => {
    const onStyles = jest.fn()
    const { rerender } = wrap(<StepStyle kids={[ivy, theo]} style="strict" onStyle={() => {}} styles={null} onStyles={onStyles} />)
    const sw = screen.getByRole('switch', { name: 'Different for each kid' })
    expect(sw).toHaveAttribute('aria-checked', 'false')
    expect(screen.queryByRole('radiogroup', { name: 'Style for Ivy' })).toBeNull()
    await userEvent.click(sw)
    expect(onStyles).toHaveBeenCalledWith({ 1: 'strict', 2: 'strict' })
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider>
          <StepStyle kids={[ivy, theo]} style="strict" onStyle={() => {}} styles={{ 1: 'strict', 2: 'relaxed' }} onStyles={onStyles} />
        </MantineProvider>
      </QueryClientProvider>,
    )
    expect(screen.getByRole('switch', { name: 'Different for each kid' })).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getAllByText('Balanced')[1])
    expect(onStyles).toHaveBeenLastCalledWith({ 1: 'balanced', 2: 'relaxed' })
    await userEvent.click(screen.getByRole('switch', { name: 'Different for each kid' }))
    expect(onStyles).toHaveBeenLastCalledWith(null)
  })
})

describe('StepPlan', () => {
  const kids = [
    { id: 1, name: 'Ivy', age_group: 'kid' as const, style: null },
    { id: 2, name: 'Theo', age_group: 'teen' as const, style: 'relaxed' as const },
  ]
  test('one card per kid with chores, screen time and bedtime; Tweak hands over the plan', async () => {
    const onTweak = jest.fn()
    wrap(<StepPlan kids={kids} style="balanced" onTweak={onTweak} />)
    expect(await screen.findByText('Ivy · Balanced')).toBeInTheDocument()
    expect(screen.getByText('Theo · Relaxed')).toBeInTheDocument()
    expect(screen.getByText('Make bed, Tidy room')).toBeInTheDocument()
    expect(screen.getByText('2h · bed 8:30')).toBeInTheDocument()
    expect(screen.getByText('3h 30m · bed 10:00')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Tweak' }))
    expect(onTweak).toHaveBeenCalledWith(catalog)
  })

  test('no kids: one line and nothing to tweak', async () => {
    wrap(<StepPlan kids={[]} style="strict" onTweak={() => {}} />)
    expect(await screen.findByText('No kids yet. Your family settings follow Strict.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tweak' })).toBeNull()
  })
})

describe('StepHours bedtimes', () => {
  const rule = (name: string, category: 'school_night' | 'weekend', end: string, kid: number) => ({ ...DEFAULT_DRAFTS[0], name, category, everyone: false, kid_ids: [kid], times: [{ start: '07:00', end }] })
  test('Everyone rules keep the old labels', () => {
    wrap(<StepHours drafts={DEFAULT_DRAFTS} onChange={() => {}} choresLock onChoresLock={() => {}} />)
    expect(screen.getByLabelText('Bedtime on school nights')).toHaveValue('20:00')
    expect(screen.getByLabelText('Bedtime on weekends')).toHaveValue('22:00')
  })

  test('per-kid rules get their own input, named by rule, and editing keeps who it is for', () => {
    const onChange = jest.fn()
    const drafts = [rule('School nights · Ivy', 'school_night', '20:30', 1), rule('School nights · Theo', 'school_night', '22:00', 2)]
    wrap(<StepHours drafts={drafts} onChange={onChange} choresLock onChoresLock={() => {}} />)
    expect(screen.getByLabelText('School nights · Ivy')).toHaveValue('20:30')
    const theoIn = screen.getByLabelText('School nights · Theo')
    expect(theoIn).toHaveValue('22:00')
    fireEvent.change(theoIn, { target: { value: '21:45' } })
    expect(onChange.mock.calls[0][0][1]).toMatchObject({ everyone: false, kid_ids: [2], times: [{ start: '07:00', end: '21:45' }] })
  })
})
