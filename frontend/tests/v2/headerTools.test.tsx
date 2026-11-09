import { readFileSync } from 'fs'
import { join } from 'path'
import { render, screen, within } from '@testing-library/react'
import { useRouter } from 'next/router'
import { ReactNode } from 'react'
import { MantineProvider } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { ParentShell } from '@/v2/parent/ParentShell'
import { Rail } from '@/v2/parent/Rail'
import { MoreMenu } from '@/v2/parent/MoreMenu'
import { useUnifiedAuth } from '@/contexts/UnifiedAuthContext'

jest.mock('@mantine/hooks', () => ({ ...jest.requireActual('@mantine/hooks'), useMediaQuery: jest.fn(() => false) }))
jest.mock('next/router', () => ({ useRouter: jest.fn() }))
jest.mock('@/contexts/UnifiedAuthContext', () => ({
  useUnifiedAuth: jest.fn(() => ({ user: { id: '1', username: 'testuser' }, logout: jest.fn() })),
}))
jest.mock('@/v2/chat/ChatDock', () => ({ ChatDock: () => null }))
jest.mock('@/v2/components/BlockerBanner', () => ({ BlockerBanner: () => null }))
jest.mock('@/v2/parent/Freshness', () => ({ Freshness: () => null }))
jest.mock('@/v2/components/RequireParent', () => ({ startSignOut: jest.fn(), cancelSignOut: jest.fn() }))
jest.mock('@/v2/parent/useLook', () => ({ useLook: jest.fn() }))
jest.mock('@/v2/hooks/useChat', () => ({ useThreads: jest.fn(() => ({ data: { total: 0 } })) }))
jest.mock('@/v2/hooks/useFamily', () => ({ useFamily: jest.fn(() => ({ data: { name: 'The Smiths' } })) }))
jest.mock('@/v2/components/Bell', () => ({
  Bell: () => {
    const { useThreads } = require('@/v2/hooks/useChat')
    const unread = useThreads().data?.total ?? 0
    const n = unread > 9 ? '9+' : unread
    return (
      <button type="button" className="p-bell p-htool" aria-label={unread ? `Notifications, ${n} unread` : 'Notifications'}>
        {unread > 0 && <span className="p-bell-count" data-testid="bell-count">{n}</span>}
      </button>
    )
  },
}))
jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ href, children, ...props }: { href: string; children: ReactNode; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  ),
}))

const phone = (on: boolean) => (useMediaQuery as jest.Mock).mockReturnValue(on)
const ui = (node: ReactNode) => render(<MantineProvider>{node}</MantineProvider>)
const header = () => document.querySelector('.p-header') as HTMLElement
const order = () =>
  Array.from(header().children).map((el) => el.tagName === 'H1' ? 'h1' : el.getAttribute('aria-label') ?? el.textContent)

beforeEach(() => {
  jest.clearAllMocks()
  phone(false)
  ;(useRouter as jest.Mock).mockReturnValue({ pathname: '/', push: jest.fn(), replace: jest.fn(), query: {} })
})

describe('header tools', () => {
  test('desktop header shows bell then avatar after actions', () => {
    ui(<ParentShell title="Today" actions={<button>…</button>}>x</ParentShell>)
    expect(order()).toEqual(['h1', '…', 'Notifications', 'Account and settings'])
  })

  test('desktop list-detail page has a header with bell and avatar', () => {
    ui(<ParentShell title="Devices" list={<div />}>x</ParentShell>)
    const h = header()
    expect(h).toBeInTheDocument()
    expect(within(h).getByRole('heading', { name: 'Devices' })).toBeInTheDocument()
    expect(within(h).getByRole('button', { name: 'Notifications' })).toBeInTheDocument()
    expect(h.querySelector('a[aria-label="Account and settings"]')).toBeInTheDocument()
  })

  test.each([true, false])('avatar links to /more with the user initial (phone=%s)', (small) => {
    phone(small)
    const { unmount } = ui(<ParentShell title="Today">x</ParentShell>)
    const me = screen.getByRole('link', { name: 'Account and settings' })
    expect(me).toHaveAttribute('href', '/more')
    expect(me).toHaveTextContent(/^T$/)
    unmount()
    ;(useUnifiedAuth as jest.Mock).mockReturnValueOnce({ user: null, logout: jest.fn() })
    ui(<ParentShell title="Today">x</ParentShell>)
    expect(screen.getByRole('link', { name: 'Account and settings' })).toHaveTextContent(/^\?$/)
  })

  test('phone header unchanged', () => {
    phone(true)
    const { unmount } = ui(<ParentShell title="Today" actions={<button>…</button>}>x</ParentShell>)
    expect(order()).toEqual(['h1', '…', 'Notifications', 'Account and settings'])
    expect(document.querySelector('.p-rail')).toBeNull()
    unmount()
    ui(<ParentShell title="Devices" list={<div />}>x</ParentShell>)
    expect(order()).toEqual(['h1', 'Notifications', 'Account and settings'])
    expect(document.querySelector('.p-rail')).toBeNull()
  })

  test('rail has no bell', () => {
    const { container } = ui(<Rail />)
    const labels = Array.from(container.querySelectorAll('.p-rail [aria-label]')).map((el) => el.getAttribute('aria-label'))
    expect(labels).toEqual(['t@sk4ce', 'Today', 'Devices', 'Kids & chores', 'Chat', 'Settings', 'Log out'])
    expect(labels).not.toContain('Notifications')
    expect(container.querySelector('.p-rail-bell')).toBeNull()
  })

  test.each([[3, '3'], [15, '9+']])('header bell shows count badge (%i → %s)', (total, text) => {
    const { useThreads } = require('@/v2/hooks/useChat')
    useThreads.mockReturnValue({ data: { total } })
    ui(<ParentShell title="Today">x</ParentShell>)
    expect(within(header()).getByTestId('bell-count')).toHaveTextContent(text)
  })

  test('header tools share one box class', () => {
    ui(
      <ParentShell title="Today" actions={<MoreMenu label="More for Today" items={[]} className="p-htool" />}>x</ParentShell>,
    )
    expect(screen.getByRole('button', { name: /^Notifications/ })).toHaveClass('p-htool')
    expect(screen.getByRole('link', { name: 'Account and settings' })).toHaveClass('p-htool')
    const more = screen.getByRole('button', { name: 'More for Today' })
    expect(more).toHaveClass('p-htool')
    expect(more).toHaveClass('p-btn', 'p-ib')
  })

  test('Today passes the header tool class to its "…"', () => {
    const src = readFileSync(join(__dirname, '../../src/v2/today/TodayPage.tsx'), 'utf8')
    expect(src).toMatch(/<MoreMenu label="More for Today"[^>]*className="p-htool"/)
  })
})

describe('header tool CSS', () => {
  const read = (p: string) => readFileSync(join(__dirname, '../../src/v2', p), 'utf8')
  test('.p-htool is a 44 px bordered rounded box', () => {
    const rule = read('parent/declutter.css').match(/\.p-htool\s*\{[^}]*\}/)![0]
    expect(rule).toMatch(/width:\s*44px/)
    expect(rule).toMatch(/height:\s*44px/)
    expect(rule).toMatch(/border-radius:\s*8px/)
    expect(rule).toMatch(/border:\s*1px solid var\(--p-line\)/)
    expect(rule).toMatch(/background:\s*var\(--p-card\)/)
  })
  test('dead rules are gone', () => {
    expect(read('parent/rail.css')).not.toContain('.p-rail-bell')
    expect(read('parent/touch.css')).not.toContain('.p-head-me')
    expect(read('parent/layout.css')).not.toMatch(/\.p-head-me\s*\{[^}]*border-radius:\s*50%/)
  })
})
