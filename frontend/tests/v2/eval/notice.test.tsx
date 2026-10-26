import { fireEvent, render, screen } from '@testing-library/react'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { useEvalStatus } from '@/v2/eval/useEvalStatus'
import { EvalNotice } from '@/v2/eval/EvalNotice'
import { EvalSettings } from '@/v2/eval/EvalSettings'
import { useAgePicker } from '@/v2/eval/AgePicker'

jest.mock('@/v2/eval/useEvalStatus')
jest.mock('@/v2/api', () => ({ ...jest.requireActual('@/v2/api'), api: jest.fn() }))

const status = useEvalStatus as jest.Mock
const on = { data: { stats: true, feedback: false, household: 'abc' } }
const off = { data: { stats: false, feedback: false, household: null } }
const ui = (n: React.ReactNode) => <MantineProvider>{n}</MantineProvider>

beforeAll(() => {
  global.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver
})

beforeEach(() => {
  status.mockReturnValue(on)
  ;(api as jest.Mock).mockReset().mockResolvedValue({})
})

test('notice hidden when stats off', () => {
  status.mockReturnValue(off)
  render(ui(<EvalNotice />))
  expect(screen.queryByText('This is an evaluation kit')).toBeNull()
})

test('notice shows all lines when on', () => {
  render(ui(<EvalNotice />))
  expect(screen.getByText('This is an evaluation kit')).toBeInTheDocument()
  expect(screen.getByText(/lent to you by the person who set it up/)).toBeInTheDocument()
  expect(screen.getByText(/What's sent: which screens are opened/)).toBeInTheDocument()
  expect(screen.getByText(/Never sent: names, usernames/)).toBeInTheDocument()
  expect(screen.getByText('Feedback is only sent when you press Send.')).toBeInTheDocument()
})

test('settings shows household id, or off text', () => {
  render(ui(<EvalSettings />))
  expect(screen.getByText('Household ID: abc')).toBeInTheDocument()
  status.mockReturnValue(off)
  render(ui(<EvalSettings />))
  expect(screen.getByText('Usage stats are off on this box.')).toBeInTheDocument()
})

function Harness() {
  const age = useAgePicker()
  return (
    <>
      {age.picker}
      <button onClick={() => age.save(7)}>save</button>
    </>
  )
}

test('age picker saves the pick once, then clears it', () => {
  render(ui(<Harness />))
  fireEvent.click(screen.getByLabelText('8–10'))
  fireEvent.click(screen.getByText('save'))
  expect(api).toHaveBeenCalledWith('/eval/kids/7/age', { method: 'PUT', body: { age_group: '8–10' } })
  fireEvent.click(screen.getByText('save'))
  expect(api).toHaveBeenCalledTimes(1)
})

test('no pick, no call', () => {
  render(ui(<Harness />))
  fireEvent.click(screen.getByText('save'))
  expect(api).not.toHaveBeenCalled()
})

test('picker hidden and save a no-op when stats off', () => {
  status.mockReturnValue(off)
  render(ui(<Harness />))
  expect(screen.queryByText('Age range (for anonymous stats)')).toBeNull()
  fireEvent.click(screen.getByText('save'))
  expect(api).not.toHaveBeenCalled()
})
