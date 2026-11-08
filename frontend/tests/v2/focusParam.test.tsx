import { useEffect } from 'react'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { useFocusParam, type FocusOptions } from '@/v2/parent/useFocusParam'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))

const h = {} as { focus: ReturnType<typeof useFocusParam> }
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
afterEach(() => jest.useRealTimers())

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
  const spy = jest.spyOn(document.documentElement, 'scrollTop', 'get').mockImplementation(() => top)
  jest.spyOn(document.documentElement, 'scrollTop', 'set').mockImplementation((v) => { top = v })
  top = 420
  render(<Harness />)
  click('A')
  top = 0
  act(() => h.focus.close())
  flushRaf()
  expect(top).toBe(420)
  spy.mockRestore()
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
