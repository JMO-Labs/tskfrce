import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { ChoreHead } from '@/v2/manage/ChoreHead'
import { UNIVERSAL_NOTES } from '@/v2/manage/choreMeta'
import type { ChoreType } from '@/v2/types'

beforeAll(() => {
  window.matchMedia = jest.fn().mockReturnValue({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() }) as never
})

const school: ChoreType = { id: 1, name: 'School', glyph: 'school', builtin: true, notes: [{ id: 7, label: 'Forgot my book', glyph: 'menu_book' }], chore_count: 2 }
const wrap = (type?: ChoreType, onEditType = jest.fn()) =>
  render(<MantineProvider env="test"><ChoreHead title="Homework" sub="School · daily" type={type} onEditType={onEditType} /></MantineProvider>)
const trigger = () => screen.getByRole('button', { name: /notes kids can send/i })

test('has no type chip in the header', () => {
  const { container } = wrap(school)
  expect(container.querySelector('.kd-pill')).toBeNull()
  expect(screen.getAllByText(/School/)).toHaveLength(1)
  expect(screen.getByText('School · daily')).toBeInTheDocument()
})

test('the type tile is the trigger (approved mockup, option A)', () => {
  wrap(school)
  expect(trigger()).toHaveClass('pk-tile')
  expect(trigger()).toHaveAttribute('aria-haspopup', 'dialog')
})

test('opens kid notes from the new trigger', async () => {
  wrap(school)
  await userEvent.click(trigger())
  expect(await screen.findByText('Forgot my book')).toBeVisible()
  expect(screen.getByText(UNIVERSAL_NOTES[0].label)).toBeVisible()
})

test('edit type stays reachable', async () => {
  const onEditType = jest.fn()
  wrap(school, onEditType)
  await userEvent.click(trigger())
  await userEvent.click(await screen.findByRole('button', { name: 'Edit School type' }))
  expect(onEditType).toHaveBeenCalledTimes(1)
})

test('no type, no trigger', () => {
  const { container } = wrap(undefined)
  expect(screen.queryByRole('button', { name: /notes kids can send/i })).toBeNull()
  expect(within(container).getByText('Homework')).toBeInTheDocument()
})
