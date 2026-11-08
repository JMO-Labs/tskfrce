import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { InfoPop } from '@/v2/parent/InfoPop'
import { MoreMenu } from '@/v2/parent/MoreMenu'

jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

beforeAll(() => {
  window.matchMedia = jest.fn().mockReturnValue({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() }) as never
})

const wrap = (ui: React.ReactNode) => render(<MantineProvider env="test">{ui}</MantineProvider>)

test('tap opens the pop-over', async () => {
  const user = userEvent.setup()
  wrap(<InfoPop label="About trust">pop body</InfoPop>)
  await user.click(screen.getByRole('button', { name: 'About trust' }))
  expect(await screen.findByText('pop body')).toBeVisible()
})

test('Esc closes the pop-over and returns focus to its button', async () => {
  const user = userEvent.setup()
  wrap(<InfoPop label="About trust">pop body</InfoPop>)
  const btn = screen.getByRole('button', { name: 'About trust' })
  await user.click(btn)
  await screen.findByText('pop body')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByText('pop body')).toBeNull())
  expect(document.activeElement).toBe(btn)
})

test('InfoPop dropdown is width-capped at 100vw - 32px', async () => {
  const user = userEvent.setup()
  wrap(<InfoPop label="About trust" width={300}>pop body</InfoPop>)
  await user.click(screen.getByRole('button', { name: 'About trust' }))
  await screen.findByText('pop body')
  expect(document.querySelector('.p-pop')).toHaveStyle({ maxWidth: 'calc(100vw - 32px)' })
})

test('MoreMenu shows items and hides hidden ones', async () => {
  const user = userEvent.setup()
  wrap(<MoreMenu label="More" items={[
    { label: 'Edit', icon: 'edit', href: '/edit' },
    { label: 'Secret', icon: 'lock', hidden: true },
    { label: 'Delete', icon: 'delete', tone: 'red', divider: true, onClick: jest.fn() },
  ]} />)
  await user.click(screen.getByRole('button', { name: 'More' }))
  expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Edit' })).toHaveAttribute('href', '/edit')
  expect(screen.queryByRole('menuitem', { name: 'Secret' })).toBeNull()
})
