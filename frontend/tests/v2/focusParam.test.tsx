import { useEffect } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useFocusParam, withoutFocus, type FocusOptions } from '@/v2/parent/useFocusParam'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))

const h = {} as { focus: ReturnType<typeof useFocusParam>; kid?: ReturnType<typeof useFocusParam> }
function Harness({ opts }: { opts?: FocusOptions }) {
  const focus = useFocusParam('open', opts)
  useEffect(() => { h.focus = focus })
  return (
    <div>
      <span data-testid="open">{focus.open ?? ''}</span>
      <button data-focus-head="a" onClick={() => focus.openTo('a')}>A</button>
      <button data-focus-head="b" onClick={() => focus.openTo('b')}>B</button>
    </div>
  )
}

function Child() {
  useFocusParam('chore')
  return null
}
function Nested({ innerInChild }: { innerInChild?: boolean }) {
  useFocusParam('kid', { clears: ['chore'] })
  return innerInChild ? <Child /> : <Inner />
}
function Inner() { useFocusParam('chore'); return null }

const flushRaf = () => act(() => { jest.runOnlyPendingTimers() })

beforeEach(() => {
  jest.useFakeTimers()
  fakeRouter.reset('/x')
  document.body.innerHTML = ''
})
afterEach(() => { jest.restoreAllMocks(); jest.useRealTimers() })

const click = (name: string) => act(() => { fireEvent.click(screen.getByRole('button', { name })) })

test('openTo pushes the param with shallow routing', () => {
  render(<Harness />)
  click('A')
  expect(fakeRouter.push).toHaveBeenCalledWith({ pathname: '/x', query: { open: 'a' } }, undefined, { shallow: true, scroll: false })
  expect(fakeRouter.stack).toHaveLength(2)
})

test('reads the open section from the URL on first render', () => {
  fakeRouter.reset('/x', { open: 'b' })
  render(<Harness />)
  expect(screen.getByTestId('open')).toHaveTextContent('b')
})

test('switching sections replaces, so one Back returns to calm', () => {
  render(<Harness />)
  click('A'); click('B')
  expect(fakeRouter.stack).toHaveLength(2)
  act(() => fakeRouter.back())
  expect(fakeRouter.query.open).toBeUndefined()
})

test('close after a push goes back instead of adding an entry', () => {
  render(<Harness />)
  click('A')
  act(() => h.focus.close())
  expect(fakeRouter.back).toHaveBeenCalled()
  expect(fakeRouter.stack).toHaveLength(1)
})

test('close on a deep-linked section replaces', () => {
  fakeRouter.reset('/x', { open: 'a' })
  render(<Harness />)
  act(() => h.focus.close())
  expect(fakeRouter.replace).toHaveBeenCalled()
  expect(fakeRouter.query).toEqual({})
})

test('Esc closes the open section', () => {
  render(<Harness />)
  click('A')
  act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
  expect(fakeRouter.query.open).toBeUndefined()
})

test('ignores Esc while a popover or menu dropdown is open', () => {
  render(<Harness />)
  click('A')
  const d = document.createElement('div')
  d.className = 'mantine-Popover-dropdown'
  document.body.appendChild(d)
  act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
  expect(fakeRouter.query.open).toBe('a')
})

test('Esc closes only the deepest level', () => {
  fakeRouter.reset('/x', { kid: '3', chore: '12' })
  render(<Nested />)
  act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
  expect(fakeRouter.query).toEqual({ kid: '3' })
})

test('Esc closes the deepest level when the inner hook is in a child component', () => {
  fakeRouter.reset('/x', { kid: '3', chore: '12' })
  render(<Nested innerInChild />)
  act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
  expect(fakeRouter.query).toEqual({ kid: '3' })
})

test('keeps a deep link while valid is undefined (data loading)', () => {
  fakeRouter.reset('/x', { open: 'a' })
  const { rerender } = render(<Harness opts={{ valid: undefined }} />)
  expect(fakeRouter.replace).not.toHaveBeenCalled()
  rerender(<Harness opts={{ valid: (id) => id === 'a' }} />)
  expect(fakeRouter.query.open).toBe('a')
})

test('openTo with extra sets several params in one navigation', () => {
  render(<Harness />)
  act(() => h.focus.openTo('settings', { extra: { edit: '1' } }))
  expect(fakeRouter.push).toHaveBeenCalledTimes(1)
  expect(fakeRouter.query).toEqual({ open: 'settings', edit: '1' })
})

test('openTo with replace adds no history entry', () => {
  render(<Harness />)
  act(() => h.focus.openTo('basics', { replace: true }))
  expect(fakeRouter.push).not.toHaveBeenCalled()
  expect(fakeRouter.stack).toHaveLength(1)
})

test('restores the calm scroll position on close', () => {
  let top = 0
  jest.spyOn(document.documentElement, 'scrollTop', 'get').mockImplementation(() => top)
  jest.spyOn(document.documentElement, 'scrollTop', 'set').mockImplementation((v) => { top = v })
  top = 420
  render(<Harness />)
  click('A')
  top = 0
  act(() => h.focus.close())
  flushRaf()
  expect(top).toBe(420)
})

test('returns focus to the opener on close', () => {
  render(<Harness />)
  const a = screen.getByRole('button', { name: 'A' })
  a.focus()
  click('A')
  screen.getByRole('button', { name: 'B' }).focus()
  act(() => h.focus.close())
  flushRaf()
  expect(document.activeElement).toBe(a)
})

test('drops an invalid value with replace', () => {
  fakeRouter.reset('/x', { open: 'bogus' })
  render(<Harness opts={{ valid: (id) => ['a', 'b'].includes(id) }} />)
  expect(fakeRouter.replace).toHaveBeenCalled()
  expect(fakeRouter.query.open).toBeUndefined()
})

test('group params are swapped without a new history entry', () => {
  fakeRouter.reset('/x', { focus: 'needs' })
  function G() { const f = useFocusParam('kid', { group: ['focus'] }); useEffect(() => { h.focus = f }); return null }
  render(<G />)
  act(() => h.focus.openTo('3'))
  expect(fakeRouter.query).toEqual({ kid: '3' })
  expect(fakeRouter.push).not.toHaveBeenCalled()
})

test('double close before the route lands goes back only once', () => {
  render(<Harness />)
  click('A')
  fakeRouter.back.mockImplementationOnce(() => {}) // route update is async in real Next
  act(() => { h.focus.close(); h.focus.close() })
  expect(fakeRouter.back).toHaveBeenCalledTimes(1)
})

test('double open before the route lands pushes only once', () => {
  render(<Harness />)
  fakeRouter.push.mockImplementationOnce(() => {})
  act(() => { h.focus.openTo('a'); h.focus.openTo('a') })
  expect(fakeRouter.push).toHaveBeenCalledTimes(1)
})

test('group swap across hooks then close goes back, leaving no duplicate calm entry', () => {
  function Two() {
    const n = useFocusParam('focus')
    const k = useFocusParam('kid', { group: ['focus'] })
    useEffect(() => { h.focus = n; h.kid = k })
    return null
  }
  render(<Two />)
  act(() => h.focus.openTo('needs'))
  act(() => h.kid!.openTo('3'))
  expect(fakeRouter.query).toEqual({ kid: '3' })
  act(() => h.kid!.close())
  expect(fakeRouter.back).toHaveBeenCalled()
  expect(fakeRouter.stack).toHaveLength(1)
})

test('openTo another id removes the clears keys', () => {
  fakeRouter.reset('/x', { kid: '3', chore: '12' })
  function O() { const f = useFocusParam('kid', { clears: ['chore'] }); useEffect(() => { h.focus = f }); return null }
  render(<O />)
  act(() => h.focus.openTo('4'))
  expect(fakeRouter.query).toEqual({ kid: '4' })
})

test('outer close removes the clears keys', () => {
  fakeRouter.reset('/x', { kid: '3', chore: '12' })
  function O() { const f = useFocusParam('kid', { clears: ['chore'] }); useEffect(() => { h.focus = f }); return null }
  render(<O />)
  act(() => h.focus.close())
  expect(fakeRouter.query).toEqual({})
})

test('falls back to the data-focus-head element when the opener is gone', () => {
  render(<Harness />)
  const a = screen.getByRole('button', { name: 'A' })
  a.focus()
  click('A')
  a.remove()
  const head = document.createElement('button')
  head.setAttribute('data-focus-head', 'a')
  document.body.appendChild(head)
  act(() => h.focus.close())
  flushRaf()
  expect(document.activeElement).toBe(head)
})

test('Back from outside resets pushed, so the next close replaces', () => {
  render(<Harness />)
  click('A')
  act(() => fakeRouter.back())
  click('B') // deep-ish: pushes again
  act(() => fakeRouter.back())
  fakeRouter.reset('/x', { open: 'a' }) // deep link now; nothing pushed by us
  act(() => h.focus.close())
  expect(fakeRouter.replace).toHaveBeenCalled()
  expect(fakeRouter.back).not.toHaveBeenCalled()
})

test('a role=dialog blocks Esc', () => {
  render(<Harness />)
  click('A')
  const d = document.createElement('div')
  d.setAttribute('role', 'dialog')
  document.body.appendChild(d)
  act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
  expect(fakeRouter.query.open).toBe('a')
})

describe('closing blurs a focused field in the open body first', () => {
  const mount = () => {
    fakeRouter.reset('/x', { open: 'a' })
    const onBlur = jest.fn()
    render(<><Harness /><div className="p-srow-body"><input aria-label="f" onBlur={onBlur} /></div></>)
    act(() => screen.getByLabelText('f').focus())
    return onBlur
  }
  test('close()', () => {
    const onBlur = mount()
    act(() => h.focus.close())
    expect(onBlur).toHaveBeenCalledTimes(1)
  })
  test('Esc', () => {
    const onBlur = mount()
    act(() => { fireEvent.keyDown(document, { key: 'Escape' }) })
    expect(onBlur).toHaveBeenCalledTimes(1)
  })
  test('a route change (browser Back)', () => {
    const onBlur = mount()
    act(() => fakeRouter.events.emit('routeChangeStart', '/x'))
    expect(onBlur).toHaveBeenCalledTimes(1)
  })
  test('a field outside the body keeps focus', () => {
    fakeRouter.reset('/x', { open: 'a' })
    const onBlur = jest.fn()
    render(<><Harness /><input aria-label="g" onBlur={onBlur} /></>)
    act(() => screen.getByLabelText('g').focus())
    act(() => h.focus.close())
    expect(onBlur).not.toHaveBeenCalled()
  })
})

describe('replace option and withoutFocus', () => {
  test('replace: true opens without a history entry, and close does not go Back', () => {
    render(<Harness opts={{ replace: true }} />)
    click('A')
    expect(fakeRouter.push).not.toHaveBeenCalled()
    expect(fakeRouter.replace).toHaveBeenCalled()
    act(() => h.focus.close())
    expect(fakeRouter.back).not.toHaveBeenCalled()
    expect(screen.getByTestId('open').textContent).toBe('')
  })
  test('withoutFocus drops every focus param and keeps the rest', () => {
    expect(withoutFocus({ item: '3', tab: 'groups', open: 'a', edit: '1', pin: '1', pick: '2' })).toEqual({ item: '3', tab: 'groups' })
  })
})
