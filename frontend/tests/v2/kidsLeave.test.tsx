import { describe, expect, test } from '@jest/globals'
import type { ReactNode } from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { KidsPage } from '@/v2/manage/KidsPage'
import { detail, list, mockRoute, serve, setupLibrary, wrap } from './libraryHelpers'

jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
jest.mock('next/router', () => ({
  useRouter: () => ({ query: mockRoute.query, push: mockRoute.push, replace: mockRoute.replace, beforePopState: jest.fn(), pathname: '/kids', asPath: '/kids' }),
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

describe('switching kids with unsaved edits', () => {
  test('asks first; Discard switches and drops open and edit', async () => {
    serve()
    mockRoute.query = { section: 'kids', item: '8', open: 'settings', edit: '1' }
    render(wrap(<KidsPage />))
    await userEvent.type(await within(detail()).findByRole('textbox', { name: 'Name' }), 'x')
    mockRoute.push.mockClear()
    await userEvent.click(within(list()).getByRole('button', { name: /Maya/ }))
    const d = await screen.findByRole('dialog', { name: 'Discard changes?' })
    expect(mockRoute.push).not.toHaveBeenCalled()
    await userEvent.click(within(d).getByRole('button', { name: 'Discard' }))
    expect(mockRoute.push).toHaveBeenCalledWith({ pathname: '/kids', query: { section: 'kids', item: 7 } }, undefined, { shallow: true })
  })

  test('a clean form switches straight away', async () => {
    serve()
    mockRoute.query = { section: 'kids', item: '8', open: 'settings', edit: '1' }
    render(wrap(<KidsPage />))
    await within(detail()).findByRole('textbox', { name: 'Name' })
    mockRoute.push.mockClear()
    await userEvent.click(within(list()).getByRole('button', { name: /Maya/ }))
    expect(mockRoute.push).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
