import { beforeEach, describe, expect, test } from '@jest/globals'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FunSettings } from '@/v2/kid/FunSettings'

const save = jest.fn()
jest.mock('@/v2/hooks/useKid', () => ({ useSetCelebrate: () => ({ mutate: save }) }))

beforeEach(() => {
  save.mockClear()
  localStorage.clear()
})
const show = (p: Partial<React.ComponentProps<typeof FunSettings>> = {}) =>
  render(<FunSettings level="full" mode="kid" freezes={2} {...p} />)

describe('FunSettings', () => {
  test('celebration level saves', async () => {
    show()
    expect(screen.getByRole('radio', { name: 'Full' })).toBeChecked()
    await userEvent.click(screen.getByRole('radio', { name: 'Small' }))
    expect(save).toHaveBeenCalledWith('small')
  })
  test('sounds switch is hidden until sound assets ship', () => {
    show({ mode: 'teen' })
    expect(screen.queryByRole('switch', { name: 'Sounds' })).toBeNull()
  })
  test('mascots switch only for teens, maps to full/small', async () => {
    show()
    expect(screen.queryByRole('switch', { name: 'Mascots' })).toBeNull()
  })
  test('teen mascots off saves small', async () => {
    show({ mode: 'teen' })
    const sw = screen.getByRole('switch', { name: 'Mascots' })
    expect(sw).toBeChecked()
    await userEvent.click(sw)
    expect(save).toHaveBeenCalledWith('small')
  })
  test('teen with small has mascots off; turning on saves full', async () => {
    show({ mode: 'teen', level: 'small' })
    await userEvent.click(screen.getByRole('switch', { name: 'Mascots' }))
    expect(save).toHaveBeenCalledWith('full')
  })
  test('freezes', () => {
    show()
    expect(screen.getByText('🧊 2 freezes saved')).toBeInTheDocument()
  })
  test('no freezes line when the family has streak freezes off (null)', () => {
    show({ freezes: null })
    expect(screen.queryByText(/freeze/)).toBeNull()
  })
  test('one freeze singular', () => {
    show({ freezes: 1 })
    expect(screen.getByText('🧊 1 freeze saved')).toBeInTheDocument()
  })
})
