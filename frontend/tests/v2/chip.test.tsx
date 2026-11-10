import { render, screen } from '@testing-library/react'
import { Chip } from '@/v2/parent/Chip'

test('renders without icon', () => {
  render(<Chip tone="grey">Declined</Chip>)
  const chip = screen.getByText('Declined')
  expect(chip).toHaveClass('p-chip')
  expect(chip.querySelector('.ms')).toBeNull()
  expect(chip.children).toHaveLength(0)
})

test('renders icon when given', () => {
  render(<Chip tone="lav" icon="bolt">Auto</Chip>)
  const chip = screen.getByText('Auto')
  expect(chip.querySelector('.ms')).toHaveTextContent('bolt')
})
