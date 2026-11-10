import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { HomeworkPane } from '@/v2/manage/HomeworkPane'
import { HomeworkRow } from '@/v2/manage/KidHomeworkSites'
import { useFocusParam } from '@/v2/parent/useFocusParam'
import type { Kid } from '@/v2/types'
import { fakeRouter } from './helpers/fakeRouter'

jest.mock('@/v2/api', () => ({ api: jest.fn(), kidToken: () => null, ApiError: class extends Error {} }))
jest.mock('next/router', () => ({ useRouter: () => require('./helpers/fakeRouter').useFakeRouter() }))
jest.mock('@mantine/notifications', () => ({ notifications: { show: jest.fn() } }))
const apiMock = api as unknown as Mock<(p: string, init?: { method?: string; body?: unknown }) => Promise<unknown>>
const sites = { starter: ['khanacademy.org', 'wikipedia.org'], allow: ['school.edu'], block: ['tiktok.com'], kids: { '3': ['mia.org'] } }

const show = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  )

beforeEach(() => {
  apiMock.mockReset().mockImplementation((p, init) => Promise.resolve(p === '/homework/sites' && !init?.method ? sites : { domain: 'x.org' }))
})

describe('HomeworkPane', () => {
  test('renders the three groups with the built-in count', async () => {
    show(<HomeworkPane />)
    expect(await screen.findByText('school.edu')).toBeInTheDocument()
    expect(screen.getByText('tiktok.com')).toBeInTheDocument()
    expect(screen.getByText('Built-in sites (2)')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Allowed for everyone' })).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Never during homework' })).toBeInTheDocument()
  })

  test('adding posts the raw pasted text', async () => {
    show(<HomeworkPane />)
    await screen.findByText('school.edu')
    const group = screen.getByRole('group', { name: 'Allowed for everyone' })
    await userEvent.type(within(group).getByRole('textbox'), 'https://Www.Quizlet.com/set/1')
    await userEvent.click(within(group).getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(apiMock).toHaveBeenCalledWith('/homework/sites', { method: 'POST', body: { domain: 'https://Www.Quizlet.com/set/1', kind: 'allow', kid_id: undefined } }),
    )
  })

  test('a server 400 shows inline', async () => {
    apiMock.mockImplementation((p, init) =>
      init?.method === 'POST' ? Promise.reject(Object.assign(new Error("That doesn't look like a website address."), { status: 400, detail: "That doesn't look like a website address." })) : Promise.resolve(sites),
    )
    show(<HomeworkPane />)
    await screen.findByText('school.edu')
    const group = screen.getByRole('group', { name: 'Never during homework' })
    await userEvent.type(within(group).getByRole('textbox'), 'nope')
    await userEvent.click(within(group).getByRole('button', { name: 'Add' }))
    expect(await within(group).findByRole('alert')).toHaveTextContent("That doesn't look like a website address.")
  })

  test('remove calls DELETE', async () => {
    show(<HomeworkPane />)
    await userEvent.click(await screen.findByRole('button', { name: 'Remove tiktok.com' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/homework/sites', { method: 'DELETE', body: { domain: 'tiktok.com', kind: 'block', kid_id: undefined } }))
  })
})

function Row() {
  const focus = useFocusParam('open')
  return <HomeworkRow kid={{ id: 3, full_name: 'Mia', username: 'mia' } as Kid} focus={focus} />
}

describe('HomeworkRow (kid page)', () => {
  test('lists this kid and posts with kid_id', async () => {
    fakeRouter.reset('/kids', { open: 'homework' })
    Element.prototype.scrollIntoView = jest.fn()
    show(<Row />)
    expect(await screen.findByText('mia.org')).toBeInTheDocument()
    expect(screen.getByRole('group', { name: 'Extra homework sites for Mia' })).toBeInTheDocument()
    expect(screen.getByText('Adds to the family list. Blocked sites stay blocked.')).toBeInTheDocument()
    await userEvent.type(screen.getByRole('textbox'), 'ixl.com')
    await userEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/homework/sites', { method: 'POST', body: { domain: 'ixl.com', kind: 'allow', kid_id: 3 } }))
    await userEvent.click(screen.getByRole('button', { name: 'Remove mia.org' }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/homework/sites', { method: 'DELETE', body: { domain: 'mia.org', kind: 'allow', kid_id: 3 } }))
  })
})
