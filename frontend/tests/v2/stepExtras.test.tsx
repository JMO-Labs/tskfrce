import { expect, test } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StepExtras } from '@/v2/setup/StepExtras'
import type { Kid } from '@/v2/types'

const kid = (id: number, name: string, age_group: Kid['age_group']) => ({ id, full_name: name, username: name, avatar: name[0], has_pin: false, age_group }) as Kid
const kids = [kid(1, 'Maya', 'kid'), kid(2, 'Leo', 'teen'), kid(3, 'Sam', 'little')]

function show(over: Partial<Parameters<typeof StepExtras>[0]> = {}) {
  const props = { kids, trust: [] as number[], bedtime: false, onTrust: jest.fn(), onBedtime: jest.fn(), ...over }
  render(<StepExtras {...props} />)
  return props
}

test('a switch per kid and one for bedtime, all off, with the mockup copy', () => {
  show()
  expect(screen.getByText('Chores approve themselves as a kid earns it, with random spot checks.')).toBeInTheDocument()
  expect(screen.getByText('At 9:00 PM, chores still waiting approve themselves.')).toBeInTheDocument()
  expect(screen.getByText('Kid (9–12)')).toBeInTheDocument()
  for (const n of ['Trust mode for Maya', 'Trust mode for Leo', 'Trust mode for Sam', 'Bedtime auto-approve'])
    expect(screen.getByRole('switch', { name: n })).toHaveAttribute('aria-checked', 'false')
})

test('bedtime time stays hidden here', () => {
  show({ bedtime: true })
  expect(screen.getByRole('switch', { name: 'Bedtime auto-approve' })).toHaveAttribute('aria-checked', 'true')
  expect(document.querySelector('input[type="time"]')).toBeNull()
})

test('toggling reports the new selection', async () => {
  const p = show({ trust: [2] })
  await userEvent.click(screen.getByRole('switch', { name: 'Trust mode for Maya' }))
  expect(p.onTrust).toHaveBeenCalledWith([2, 1])
  await userEvent.click(screen.getByRole('switch', { name: 'Trust mode for Leo' }))
  expect(p.onTrust).toHaveBeenCalledWith([])
  await userEvent.click(screen.getByRole('switch', { name: 'Bedtime auto-approve' }))
  expect(p.onBedtime).toHaveBeenCalledWith(true)
})

test('no kids: no trust card, bedtime still offered', () => {
  show({ kids: [] })
  expect(screen.queryByText('Trust mode')).toBeNull()
  expect(screen.getByRole('switch', { name: 'Bedtime auto-approve' })).toBeInTheDocument()
})
