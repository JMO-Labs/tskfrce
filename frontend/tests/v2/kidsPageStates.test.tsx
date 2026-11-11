import { describe, expect, test } from '@jest/globals'
import type { ReactNode } from 'react'
import { render, screen, waitFor, within } from '@testing-library/react'
import { KidsPage } from '@/v2/manage/KidsPage'
import { apiMock, detail, kids, mockRoute, serve, setupLibrary, wrap } from './libraryHelpers'

jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('next/router', () => ({
  useRouter: () => ({ query: mockRoute.query, push: mockRoute.push, replace: mockRoute.replace, beforePopState: jest.fn(), pathname: '/kids' }),
}))
jest.mock('@/v2/api', () => ({ api: jest.fn() }))
jest.mock('@/v2/parent/ParentShell', () => ({
  ParentShell: ({ list, children }: { list: ReactNode; children: ReactNode }) => (
    <>
      <div data-testid="list">{list}</div>
      <div data-testid="detail">{children}</div>
    </>
  ),
}))
jest.mock('@/v2/components/RequireParent', () => ({
  RequireParent: ({ children }: { children: ReactNode }) => <>{children}</>,
  startSignOut: jest.fn(),
  cancelSignOut: jest.fn(),
}))

setupLibrary()
const NAV = { shallow: true, scroll: false }

describe('Kids & chores deep links and load states', () => {
  test('?section=chores&kid=N opens a new chore, not the kid profile', async () => {
    mockRoute.query = { section: 'chores', kid: '7' }
    render(wrap(<KidsPage />))
    await waitFor(() => expect(mockRoute.replace).toHaveBeenCalledWith({ pathname: '/kids', query: { section: 'chores', item: 'new' } }, undefined, NAV))
  })

  test('?section=kids&kid=N&pin=1 opens that kid\'s Settings in edit with the PIN focused', async () => {
    mockRoute.query = { kid: '7', pin: '1' }
    render(wrap(<KidsPage />))
    await waitFor(() =>
      expect(mockRoute.replace).toHaveBeenCalledWith({ pathname: '/kids', query: { section: 'kids', item: '7', open: 'settings', edit: '1', pin: '1' } }, undefined, NAV),
    )
  })

  test('?kid=N#trust opens that kid\'s Trust row', async () => {
    window.history.replaceState(null, '', '/kids?kid=7#trust')
    mockRoute.query = { kid: '7' }
    render(wrap(<KidsPage />))
    await waitFor(() => expect(mockRoute.replace).toHaveBeenCalledWith({ pathname: '/kids', query: { section: 'kids', item: '7', open: 'trust' } }, undefined, NAV))
    window.history.replaceState(null, '', '/')
  })

  test('a failing chore library shows an error with Retry', async () => {
    serve()
    apiMock.mockImplementation(async (path) => {
      if (path === '/chores/') throw new Error('boom')
      return path === '/kids' ? kids : []
    })
    mockRoute.query = { section: 'chores' }
    render(wrap(<KidsPage />))
    const retry = await within(detail()).findByRole('button', { name: /retry|try again/i })
    expect(retry).toBeInTheDocument()
  })
})
