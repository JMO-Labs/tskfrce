import { render, screen, fireEvent } from '@testing-library/react'
import { DeviceControls } from '@/v2/manage/DeviceControls'
import { EMPTY_FILTER } from '@/v2/manage/deviceFilter'

const base = { sort: 'name' as const, onSort: jest.fn(), filter: EMPTY_FILTER, onFilter: jest.fn() }
const open = () => fireEvent.click(screen.getByRole('button', { name: /Filter/ }))

describe('DeviceControls', () => {
  it('shows network chips when 2+ networks are passed', () => {
    render(<DeviceControls {...base} networks={[{ id: 1, label: 'Home' }, { id: 2, label: 'Guest' }]} />)
    open()
    expect(screen.getByRole('button', { name: 'Guest' })).toBeTruthy()
  })
  it('leaves out flags listed in hideFlags', () => {
    render(<DeviceControls {...base} hideFlags={['unassigned']} />)
    open()
    expect(screen.queryByRole('button', { name: 'Unassigned' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Locked' })).toBeTruthy()
  })
})
