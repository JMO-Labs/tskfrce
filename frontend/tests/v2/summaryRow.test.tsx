import fs from 'fs'
import path from 'path'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { SummaryRow, FocusArea } from '@/v2/parent/SummaryRow'
import { useFocusParam } from '@/v2/parent/useFocusParam'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))

function Page() {
  const focus = useFocusParam('open')
  return (
    <FocusArea focus={focus} label="Sections">
      <SummaryRow id="trust" icon={<i />} title="Trust" summary="3 ok" line2={<button>trust line 2</button>} aside={<input type="checkbox" role="switch" aria-label="sw" />} focus={focus}>
        <button>inside trust</button>
      </SummaryRow>
      <SummaryRow id="devices" icon={<i />} title="Devices" summary="2" focus={focus}>
        <p>devices body</p>
      </SummaryRow>
    </FocusArea>
  )
}

const css = fs.readFileSync(path.join(__dirname, '../../src/v2/parent/declutter.css'), 'utf8')
const head = (name: RegExp) => screen.getByRole('button', { name })
const click = (el: HTMLElement) => act(() => { fireEvent.click(el) })

beforeEach(() => {
  fakeRouter.reset('/x')
  window.matchMedia = jest.fn().mockReturnValue({ matches: false, addEventListener: jest.fn(), removeEventListener: jest.fn() }) as never
  Element.prototype.scrollIntoView = jest.fn()
})

test('head is a button with aria-expanded and opens the body', () => {
  render(<Page />)
  expect(head(/^Trust/)).toHaveAttribute('aria-expanded', 'false')
  click(head(/^Trust/))
  expect(head(/^Trust/)).toHaveAttribute('aria-expanded', 'true')
  expect(screen.getByRole('region', { name: /Trust/ })).toBeInTheDocument()
})

test('only one row is open at a time and others drop their second line', () => {
  render(<Page />)
  expect(screen.getByText('trust line 2')).toBeInTheDocument()
  click(head(/^Trust/))
  click(head(/^Devices/))
  expect(screen.queryByRole('region', { name: /Trust/ })).toBeNull()
  expect(screen.getByRole('region', { name: /Devices/ })).toBeInTheDocument()
  expect(screen.queryByText('trust line 2')).toBeNull()
})

test('focus moves into the opened body', () => {
  render(<Page />)
  click(head(/^Trust/))
  const region = screen.getByRole('region', { name: /Trust/ })
  expect(region).toContainElement(document.activeElement as HTMLElement)
  expect(document.activeElement).toBe(screen.getByText('inside trust'))
})

test('body itself takes focus when it has nothing focusable', () => {
  render(<Page />)
  click(head(/^Devices/))
  expect(document.activeElement).toBe(screen.getByRole('region', { name: /Devices/ }))
})

test('opening scrolls nearest, smooth unless reduced motion', () => {
  render(<Page />)
  click(head(/^Trust/))
  expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'smooth' })
  click(head(/^Trust/))
  ;(window.matchMedia as jest.Mock).mockReturnValue({ matches: true })
  click(head(/^Devices/))
  expect(Element.prototype.scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest', behavior: 'auto' })
})

test('tapping the open head closes it', () => {
  render(<Page />)
  click(head(/^Trust/))
  expect(fakeRouter.query.open).toBe('trust')
  click(head(/^Trust/))
  expect(fakeRouter.query.open).toBeUndefined()
})

test('swipe down on the open head closes it', () => {
  render(<Page />)
  click(head(/^Trust/))
  const h = head(/^Trust/)
  fireEvent.touchStart(h, { touches: [{ clientY: 100 }] })
  fireEvent.touchEnd(h, { changedTouches: [{ clientY: 180 }] })
  expect(fakeRouter.query.open).toBeUndefined()
})

test('short swipe or swipe on a closed head does nothing', () => {
  render(<Page />)
  const h = head(/^Trust/)
  fireEvent.touchStart(h, { touches: [{ clientY: 100 }] })
  fireEvent.touchEnd(h, { changedTouches: [{ clientY: 200 }] })
  expect(fakeRouter.push).not.toHaveBeenCalled()
  click(h)
  fireEvent.touchStart(h, { touches: [{ clientY: 100 }] })
  fireEvent.touchEnd(h, { changedTouches: [{ clientY: 140 }] })
  expect(fakeRouter.query.open).toBe('trust')
})

test('aside switch does not toggle the row', () => {
  render(<Page />)
  click(screen.getByRole('switch', { name: 'sw' }))
  expect(fakeRouter.push).not.toHaveBeenCalled()
})

test('line2 sits outside the head button', () => {
  render(<Page />)
  expect(head(/^Trust/)).not.toContainElement(screen.getByText('trust line 2'))
  expect(head(/^Trust/)).not.toContainElement(screen.getByRole('switch', { name: 'sw' }))
})

test('region is named by the title only', () => {
  render(<Page />)
  click(head(/^Trust/))
  expect(screen.getByRole('region', { name: 'Trust' })).toBeInTheDocument()
  expect(head(/^Trust/)).toHaveAttribute('aria-controls', 'srow-trust-body')
})

test('focus area is labelled and flags focus state', () => {
  const { container } = render(<Page />)
  const area = container.querySelector('.p-srows')!
  expect(area).toHaveAttribute('aria-label', 'Sections')
  expect(area).not.toHaveAttribute('data-focused')
  click(head(/^Trust/))
  expect(area).toHaveAttribute('data-focused')
})

test('kid names never break mid-word', () => {
  expect(css).toMatch(/\.p-kn\s*{[^}]*white-space:\s*nowrap/)
  expect(css).toMatch(/\.p-kn\s*{[^}]*word-break:\s*keep-all/)
})
