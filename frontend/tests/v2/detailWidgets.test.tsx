import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { DetailHeader } from '@/v2/parent/DetailHeader'
import { ActionRow } from '@/v2/parent/ActionRow'
import { ProgressRing } from '@/v2/parent/ProgressRing'

jest.mock('next/link', () => ({ __esModule: true, default: ({ href, children, ...r }: any) => <a href={href} {...r}>{children}</a> }))

beforeAll(() => {
  window.matchMedia = jest.fn().mockReturnValue({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() }) as never
})
const wrap = (ui: React.ReactNode) => render(<MantineProvider env="test">{ui}</MantineProvider>)

test('DetailHeader status chip opens its pop-over', async () => {
  const user = userEvent.setup()
  wrap(<DetailHeader media={<i />} title="Dishes" status={{ tone: 'acc', icon: 'check', label: 'Open', pop: 'Waiting for a kid to do it' }} />)
  expect(screen.getByRole('heading', { level: 2, name: 'Dishes' })).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Open' }))
  expect(await screen.findByText('Waiting for a kid to do it')).toBeVisible()
})

test('DetailHeader status without pop is a plain chip', () => {
  wrap(<DetailHeader media={<i />} title="Dishes" status={{ tone: 'acc', icon: 'check', label: 'Open' }} />)
  expect(screen.queryByRole('button', { name: 'Open' })).toBeNull()
  expect(screen.getByText('Open')).toBeInTheDocument()
})

test('DetailHeader puts Delete only in the … menu', async () => {
  const user = userEvent.setup()
  wrap(<DetailHeader media={<i />} title="Dishes" sub="Daily" main={<button>Edit</button>} menuLabel="More for Dishes" menu={[{ label: 'Delete', icon: 'delete', tone: 'red', onClick: jest.fn() }]} />)
  expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
  expect(screen.getByText('Daily')).toHaveClass('p-dhead-sub')
  await user.click(screen.getByRole('button', { name: 'More for Dishes' }))
  expect(await screen.findByRole('menuitem', { name: 'Delete' })).toBeInTheDocument()
})

test('ActionRow main button and … menu', async () => {
  const user = userEvent.setup()
  const ok = jest.fn()
  wrap(<ActionRow icon="check" iconLabel="Spot check" title="Dishes" sub="Maya" main={{ label: 'Approve', onClick: ok }}
    menu={[{ label: 'Send back', icon: 'undo' }, { label: 'Reply', icon: 'chat' }]}>
    <p>reply box</p>
  </ActionRow>)
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  expect(ok).toHaveBeenCalledTimes(1)
  expect(screen.getByText('reply box')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'More' }))
  expect(await screen.findByRole('menuitem', { name: 'Send back' })).toBeInTheDocument()
  expect(screen.getByRole('menuitem', { name: 'Reply' })).toBeInTheDocument()
})

test('ActionRow busy main button', () => {
  wrap(<ActionRow icon="check" iconLabel="Spot check" title="Dishes" main={{ label: 'Approve', onClick: jest.fn(), busy: true }} />)
  const b = screen.getByRole('button', { name: 'Approve' })
  expect(b).toHaveAttribute('aria-busy', 'true')
  expect(b).toHaveAttribute('data-loading', 'true')
})

test('ActionRow type icon explains itself', async () => {
  const user = userEvent.setup()
  wrap(<ActionRow icon="check" iconLabel="Spot check" iconHelp="Check a photo" title="Dishes" />)
  await user.click(screen.getByRole('button', { name: 'Spot check' }))
  expect(await screen.findByText('Check a photo')).toBeVisible()
})

test('ProgressRing labels progress', () => {
  wrap(<ProgressRing done={4} total={6} />)
  expect(screen.getByRole('img', { name: '4 of 6 done' })).toBeInTheDocument()
  expect(screen.getByText('4 of 6')).toBeInTheDocument()
})

test('ActionRow icon without help is not a button', () => {
  wrap(<ActionRow icon="check" iconLabel="Spot check" title="Dishes" />)
  expect(screen.queryByRole('button', { name: 'Spot check' })).toBeNull()
  expect(screen.getByRole('img', { name: 'Spot check' })).toBeInTheDocument()
})

test('ActionRow disabled main button does not fire', async () => {
  const user = userEvent.setup(); const ok = jest.fn()
  wrap(<ActionRow icon="check" iconLabel="x" title="Dishes" main={{ label: 'Approve', onClick: ok, disabled: true }} />)
  expect(screen.getByRole('button', { name: 'Approve' })).toBeDisabled()
  await user.click(screen.getByRole('button', { name: 'Approve' }))
  expect(ok).not.toHaveBeenCalled()
})
