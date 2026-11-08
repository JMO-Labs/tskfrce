import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { KidPicker } from '@/v2/parent/KidPicker'
import type { Kid } from '@/v2/types'

beforeAll(() => {
  window.matchMedia = jest.fn().mockReturnValue({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() }) as never
})
const kids = [{ id: 3, full_name: 'Maya', username: 'maya' }, { id: 4, full_name: 'Leo', username: 'leo' }] as Kid[]
const extras = [{ value: 'guest', label: 'Guest' }]
const wrap = (ui: React.ReactNode) => render(<MantineProvider env="test">{ui}</MantineProvider>)

test('KidPicker pills is a labelled group', () => {
  wrap(<KidPicker kids={kids} value={['3']} onChange={jest.fn()} label="Assign to" />)
  const g = screen.getByRole('group', { name: 'Assign to' })
  expect(g).toHaveClass('pk-pills')
  expect(screen.getByRole('button', { name: /Maya/ })).toHaveAttribute('aria-pressed', 'true')
  expect(screen.getByRole('button', { name: /Leo/ })).toHaveAttribute('aria-pressed', 'false')
})

test('KidPicker multi toggles kids', async () => {
  const user = userEvent.setup(); const onChange = jest.fn()
  wrap(<KidPicker kids={kids} value={['3']} onChange={onChange} label="Assign to" />)
  await user.click(screen.getByRole('button', { name: /Leo/ }))
  expect(onChange).toHaveBeenCalledWith(['3', '4'])
  await user.click(screen.getByRole('button', { name: /Maya/ }))
  expect(onChange).toHaveBeenLastCalledWith([])
})

test('KidPicker extras are exclusive', async () => {
  const user = userEvent.setup(); const onChange = jest.fn()
  const { rerender } = wrap(<KidPicker kids={kids} value={['3']} onChange={onChange} label="Assign to" extras={extras} />)
  await user.click(screen.getByRole('button', { name: 'Guest' }))
  expect(onChange).toHaveBeenLastCalledWith(['guest'])
  rerender(<MantineProvider env="test"><KidPicker kids={kids} value={['guest']} onChange={onChange} label="Assign to" extras={extras} /></MantineProvider>)
  await user.click(screen.getByRole('button', { name: /Leo/ }))
  expect(onChange).toHaveBeenLastCalledWith(['4'])
})

test('KidPicker single replaces', async () => {
  const user = userEvent.setup(); const onChange = jest.fn()
  wrap(<KidPicker kids={kids} value={['3']} onChange={onChange} label="Assign to" single />)
  await user.click(screen.getByRole('button', { name: /Leo/ }))
  expect(onChange).toHaveBeenCalledWith(['4'])
})

test('KidPicker busy ignores taps but stays focusable', async () => {
  const user = userEvent.setup(); const onChange = jest.fn()
  wrap(<KidPicker kids={kids} value={[]} onChange={onChange} label="Assign to" busy />)
  const b = screen.getByRole('button', { name: /Leo/ })
  await user.click(b)
  expect(onChange).not.toHaveBeenCalled()
  expect(b).not.toBeDisabled()
})

test('KidPicker pop variant shows the pick and closes after choosing', async () => {
  const user = userEvent.setup(); const onChange = jest.fn()
  wrap(<KidPicker kids={kids} value={[]} onChange={onChange} label="Owner of this" variant="pop" />)
  const btn = screen.getByRole('button', { name: 'Owner of this' })
  expect(btn).toHaveTextContent('Owner')
  await user.click(btn)
  await user.click(await screen.findByRole('button', { name: /Maya/ }))
  expect(onChange).toHaveBeenCalledWith(['3'])
  await waitFor(() => expect(screen.queryByRole('button', { name: /Maya/ })).toBeNull())
})

test('KidPicker pop variant labels the current pick', () => {
  wrap(<KidPicker kids={kids} value={['4']} onChange={jest.fn()} label="Owner of this" variant="pop" />)
  expect(screen.getByRole('button', { name: 'Owner of this: Leo' })).toHaveTextContent('Leo')
})

test('KidPicker pop variant lists kids, divider, extras; extra pick clears kids', async () => {
  const user = userEvent.setup(); const onChange = jest.fn()
  wrap(<KidPicker kids={kids} value={['3']} onChange={onChange} label="Owner of this" variant="pop" extras={extras} />)
  await user.click(screen.getByRole('button', { name: 'Owner of this: Maya' }))
  expect(await screen.findByRole('button', { name: /Leo/ })).toBeInTheDocument()
  expect(document.querySelector('.p-pk-div')).not.toBeNull()
  await user.click(screen.getByRole('button', { name: 'Guest' }))
  expect(onChange).toHaveBeenCalledWith(['guest'])
})

test('KidPicker pop variant with a kid with no name initial still groups as a kid', async () => {
  const user = userEvent.setup()
  const odd = [{ id: 9, full_name: '', username: '' }] as Kid[]
  wrap(<KidPicker kids={odd} value={[]} onChange={jest.fn()} label="Owner of this" variant="pop" extras={extras} />)
  await user.click(screen.getByRole('button', { name: 'Owner of this' }))
  const list = (await screen.findAllByRole('button', { name: /Guest/ }))[0]
  expect(list.previousElementSibling).toHaveClass('p-pk-div')
})

test('KidPicker pop variant stays open while busy', async () => {
  const user = userEvent.setup(); const onChange = jest.fn()
  wrap(<KidPicker kids={kids} value={[]} onChange={onChange} label="Owner of this" variant="pop" busy />)
  await user.click(screen.getByRole('button', { name: 'Owner of this' }))
  await user.click(await screen.findByRole('button', { name: /Maya/ }))
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: /Maya/ })).toBeInTheDocument()
})

test('KidPicker pop trigger shows an extra\'s short label, the list keeps the full one', async () => {
  const user = userEvent.setup()
  const ex = [{ value: 'guest', label: 'Guest (never blocked)', short: 'Guest' }]
  wrap(<KidPicker kids={kids} value={['guest']} onChange={jest.fn()} label="Owner of this" variant="pop" extras={ex} />)
  const btn = screen.getByRole('button', { name: 'Owner of this: Guest' })
  expect(btn).toHaveTextContent(/^Guest/)
  await user.click(btn)
  expect(await screen.findByRole('button', { name: 'Guest (never blocked)' })).toBeInTheDocument()
})
