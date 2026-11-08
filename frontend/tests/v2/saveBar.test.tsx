import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { SaveBar, useDiscardGuard } from '@/v2/parent/SaveBar'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))

beforeEach(() => {
  fakeRouter.reset('/x')
  window.matchMedia = jest.fn().mockReturnValue({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() }) as never
})
const wrap = (ui: React.ReactNode) => render(<MantineProvider env="test">{ui}</MantineProvider>)

test('SaveBar is hidden until dirty', () => {
  wrap(<SaveBar dirty={false} saving={false} onSave={jest.fn()} onCancel={jest.fn()} />)
  expect(screen.queryByRole('region', { name: 'Unsaved changes' })).toBeNull()
})

test('SaveBar Cancel and Save', async () => {
  const user = userEvent.setup()
  const onSave = jest.fn(), onCancel = jest.fn()
  const { rerender } = wrap(<SaveBar dirty saving={false} onSave={onSave} onCancel={onCancel} saveLabel="Save chore" note="Name is required" />)
  expect(screen.getByRole('region', { name: 'Unsaved changes' })).toBeInTheDocument()
  expect(screen.getByText('Name is required')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Cancel' }))
  await user.click(screen.getByRole('button', { name: 'Save chore' }))
  expect(onCancel).toHaveBeenCalledTimes(1); expect(onSave).toHaveBeenCalledTimes(1)
  rerender(<MantineProvider env="test"><SaveBar dirty saving onSave={onSave} onCancel={onCancel} saveLabel="Save chore" /></MantineProvider>)
  const b = screen.getByRole('button', { name: 'Save chore' })
  expect(b).toHaveAttribute('aria-busy', 'true'); expect(b).toHaveAttribute('data-loading', 'true')
})

function Probe({ dirty, go }: { dirty: boolean; go: () => void }) {
  const { guard, sheet } = useDiscardGuard(dirty)
  return <><button onClick={() => guard(go)}>leave</button>{sheet}</>
}

test('useDiscardGuard asks before leaving a dirty form', async () => {
  const user = userEvent.setup()
  const go = jest.fn()
  wrap(<Probe dirty go={go} />)
  await user.click(screen.getByRole('button', { name: 'leave' }))
  expect(go).not.toHaveBeenCalled()
  expect(await screen.findByText('Discard changes?')).toBeInTheDocument()
  expect(screen.getByText("What you changed here won't be saved.")).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Discard' }))
  expect(go).toHaveBeenCalledTimes(1)
})

test('useDiscardGuard passes straight through when clean', async () => {
  const user = userEvent.setup()
  const go = jest.fn()
  wrap(<Probe dirty={false} go={go} />)
  await user.click(screen.getByRole('button', { name: 'leave' }))
  expect(go).toHaveBeenCalledTimes(1)
  expect(screen.queryByText('Discard changes?')).toBeNull()
})

test('useDiscardGuard adds beforeunload only while dirty', () => {
  const { rerender } = wrap(<Probe dirty go={jest.fn()} />)
  const ev = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(ev)
  expect(ev.defaultPrevented).toBe(true)
  rerender(<MantineProvider env="test"><Probe dirty={false} go={jest.fn()} /></MantineProvider>)
  const ev2 = new Event('beforeunload', { cancelable: true })
  window.dispatchEvent(ev2)
  expect(ev2.defaultPrevented).toBe(false)
})

test('useDiscardGuard blocks browser Back while dirty', async () => {
  const user = userEvent.setup()
  const { rerender } = wrap(<Probe dirty go={jest.fn()} />)
  let r: boolean | undefined
  act(() => { r = fakeRouter.popHandler({}) })
  expect(r).toBe(false)
  expect(fakeRouter.push).toHaveBeenCalledWith('/x', undefined, { shallow: true, scroll: false })
  expect(await screen.findByText('Discard changes?')).toBeInTheDocument()
  fakeRouter.push.mockClear()
  await user.click(screen.getByRole('button', { name: 'Discard' }))
  expect(fakeRouter.back).toHaveBeenCalled()
  rerender(<MantineProvider env="test"><Probe dirty={false} go={jest.fn()} /></MantineProvider>)
  expect(fakeRouter.popHandler({})).toBe(true)
})

test('useDiscardGuard resets beforePopState on unmount', () => {
  const { unmount } = wrap(<Probe dirty go={jest.fn()} />)
  unmount()
  expect(fakeRouter.popHandler({})).toBe(true)
})
