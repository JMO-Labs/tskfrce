import { act, render, screen, waitFor } from '@testing-library/react'
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

test('after Discard a second guard() goes through without asking again', async () => {
  const user = userEvent.setup()
  const go = jest.fn(), go2 = jest.fn()
  function Twice() {
    const { guard, sheet } = useDiscardGuard(true)
    return <><button onClick={() => guard(go)}>first</button><button onClick={() => guard(go2)}>second</button>{sheet}</>
  }
  wrap(<Twice />)
  await user.click(screen.getByRole('button', { name: 'first' }))
  await user.click(await screen.findByRole('button', { name: 'Discard' }))
  await user.click(screen.getByRole('button', { name: 'second' }))
  expect(go2).toHaveBeenCalledTimes(1)
  expect(screen.queryByRole('dialog')).toBeNull()
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
  const go = jest.spyOn(window.history, 'go').mockImplementation(() => {})
  let r: boolean | undefined
  act(() => { r = fakeRouter.popHandler({}) })
  expect(r).toBe(false)
  expect(go).toHaveBeenCalledWith(1) // undo the Back; router.push of the same URL would only replace the popped entry
  expect(fakeRouter.push).not.toHaveBeenCalled()
  act(() => { r = fakeRouter.popHandler({}) })
  expect(r).toBe(false) // the popstate of our own go(1) is swallowed
  expect(await screen.findByText('Discard changes?')).toBeInTheDocument()
  go.mockRestore()
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

test('Discard on the Back sheet really goes back (no re-prompt loop)', async () => {
  const user = userEvent.setup()
  const go = jest.spyOn(window.history, 'go').mockImplementation(() => {})
  fakeRouter.stack.push({}) // a page to go back to
  wrap(<Probe dirty go={jest.fn()} />)
  act(() => { fakeRouter.popHandler({}) })
  go.mockRestore()
  const depth = fakeRouter.stack.length
  await user.click(await screen.findByRole('button', { name: 'Discard' }))
  expect(fakeRouter.stack.length).toBe(depth - 1)
  await waitFor(() => expect(screen.queryByText('Discard changes?')).toBeNull())
  expect(fakeRouter.push).not.toHaveBeenCalled()
})

test('two guards do not clobber each other', () => {
  const a = wrap(<Probe dirty go={jest.fn()} />)
  const b = wrap(<Probe dirty go={jest.fn()} />)
  b.unmount()
  let r: boolean | undefined
  act(() => { r = fakeRouter.popHandler({}) })
  expect(r).toBe(false) // guard A still blocks
  a.unmount()
  expect(fakeRouter.popHandler({})).toBe(true)
})

test('a go(1) popstate that never arrives does not swallow a later real Back', async () => {
  jest.useFakeTimers()
  const go = jest.spyOn(window.history, 'go').mockImplementation(() => {})
  wrap(<Probe dirty go={jest.fn()} />)
  act(() => { fakeRouter.popHandler({}) })
  act(() => { jest.advanceTimersByTime(600) })
  go.mockClear()
  act(() => { fakeRouter.popHandler({}) })
  expect(go).toHaveBeenCalledWith(1) // asked again, not swallowed
  go.mockRestore()
  jest.useRealTimers()
})

test('Keep after a cancelled in-app leave puts focus back in the field', async () => {
  const user = userEvent.setup()
  function Form() {
    const { sheet } = useDiscardGuard(true)
    return <><input aria-label="field" /><a href="#x">away</a>{sheet}</>
  }
  wrap(<Form />)
  await user.click(screen.getByLabelText('field'))
  act(() => { try { fakeRouter.events.emit('routeChangeStart', '/elsewhere', { shallow: true }) } catch { /* cancelled */ } })
  screen.getByLabelText('field').blur()
  await user.click(await screen.findByRole('button', { name: 'Keep' }))
  await waitFor(() => expect(screen.getByLabelText('field')).toHaveFocus())
})

test('Discard-triggered push keeps shallow and the guard resets after the navigation', async () => {
  const user = userEvent.setup()
  wrap(<Probe dirty go={jest.fn()} />)
  act(() => { try { fakeRouter.events.emit('routeChangeStart', '/elsewhere', { shallow: true }) } catch { /* cancelled */ } })
  await user.click(await screen.findByRole('button', { name: 'Discard' }))
  expect(fakeRouter.push).toHaveBeenCalledWith('/elsewhere', undefined, { shallow: true })
  // leaving stays set until the route ends; then a new leave asks again
  act(() => { fakeRouter.events.emit('routeChangeComplete') })
  await user.click(screen.getByRole('button', { name: 'leave' }))
  expect(await screen.findByText('Discard changes?')).toBeInTheDocument()
})

test('release() lets a navigation through without the Discard prompt (record deleted)', () => {
  function Gone() {
    const { release, sheet } = useDiscardGuard(true)
    return <><button onClick={release}>gone</button>{sheet}</>
  }
  wrap(<Gone />)
  act(() => { screen.getByRole('button', { name: 'gone' }).click() })
  expect(() => fakeRouter.events.emit('routeChangeStart', '/kids')).not.toThrow()
  expect(screen.queryByText('Discard changes?')).toBeNull()
})

test('Keep returns focus to the field that was focused before the form turned dirty, not the clicked link', async () => {
  const user = userEvent.setup()
  function Form({ dirty }: { dirty: boolean }) {
    const { sheet } = useDiscardGuard(dirty)
    return <><input aria-label="field" /><a href="#x">away</a>{sheet}</>
  }
  const { rerender } = wrap(<Form dirty={false} />)
  await user.click(screen.getByLabelText('field'))
  rerender(<MantineProvider env="test"><Form dirty /></MantineProvider>)
  await user.click(screen.getByRole('link', { name: 'away' }))
  act(() => { try { fakeRouter.events.emit('routeChangeStart', '/elsewhere') } catch { /* cancelled */ } })
  await user.click(await screen.findByRole('button', { name: 'Keep' }))
  await waitFor(() => expect(screen.getByLabelText('field')).toHaveFocus())
})

test('Back within the same record is asked only for forms that do not opt in', () => {
  function Form({ mode }: { mode?: 'allow' }) {
    useDiscardGuard(true, undefined, mode ? { inRecord: mode } : undefined)
    return null
  }
  fakeRouter.reset('/x', { item: '1', open: 'a' })
  const go = jest.spyOn(window.history, 'go').mockImplementation(() => {})
  const same = { as: '/x?item=1' }
  const other = { as: '/x?item=2' }
  const view = wrap(<Form mode="allow" />)
  expect(fakeRouter.popHandler(same)).toBe(true)
  act(() => { expect(fakeRouter.popHandler(other)).toBe(false) })
  view.unmount()
  wrap(<Form />)
  act(() => { expect(fakeRouter.popHandler(same)).toBe(false) })
  go.mockRestore()
})

test('the cancelled-navigation rejection is swallowed, other rejections are not', () => {
  wrap(<Probe dirty go={jest.fn()} />)
  let cancel: unknown
  act(() => { try { fakeRouter.events.emit('routeChangeStart', '/elsewhere') } catch (e) { cancel = e } })
  const fire = (reason: unknown) => { const e = new Event('unhandledrejection', { cancelable: true }) as Event & { reason: unknown }; e.reason = reason; window.dispatchEvent(e); return e.defaultPrevented }
  expect(fire(cancel)).toBe(true)
  expect(fire(new Error('real'))).toBe(false)
})

test('Keep does not focus a field from an earlier dirty spell', async () => {
  const user = userEvent.setup()
  function Form({ dirty }: { dirty: boolean }) {
    const { sheet } = useDiscardGuard(dirty)
    return <><input aria-label="field" /><button>other</button>{sheet}</>
  }
  const { rerender } = wrap(<Form dirty />)
  await user.click(screen.getByLabelText('field'))
  rerender(<MantineProvider env="test"><Form dirty={false} /></MantineProvider>)
  await user.click(screen.getByRole('button', { name: 'other' }))
  rerender(<MantineProvider env="test"><Form dirty /></MantineProvider>)
  act(() => { try { fakeRouter.events.emit('routeChangeStart', '/elsewhere') } catch { /* cancelled */ } })
  await user.click(await screen.findByRole('button', { name: 'Keep' }))
  await new Promise((r) => setTimeout(r, 120))
  expect(screen.getByLabelText('field')).not.toHaveFocus()
})
