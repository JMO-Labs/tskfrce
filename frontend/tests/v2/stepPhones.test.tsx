import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StepPhones } from '@/v2/setup/StepPhones'
import { api } from '@/v2/api'
import type { Kid } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
const apiMock = api as unknown as Mock<typeof api>

const kids = [
  { id: 7, full_name: 'Mia', avatar: '🦊' },
  { id: 8, full_name: 'Leo', avatar: null },
] as Kid[]
const code = { url: 'https://x/e/1', qr_svg: '<svg/>', expires_at: '2026-11-06T00:00:00Z' }

const view = (k: Kid[]) =>
  render(
    <MantineProvider>
      <QueryClientProvider client={new QueryClient()}>
        <StepPhones kids={k} />
      </QueryClientProvider>
    </MantineProvider>,
  )

beforeEach(() => {
  apiMock.mockReset()
  apiMock.mockResolvedValue(code)
})

describe('StepPhones', () => {
  test('one Show code per kid; tap posts for that kid only', async () => {
    view(kids)
    expect(screen.getAllByRole('button', { name: /Show code/ })).toHaveLength(2)
    await userEvent.click(screen.getByRole('button', { name: 'Show code for Mia' }))
    expect(await screen.findByAltText('Sign-in code for Mia')).toBeInTheDocument()
    expect(screen.getByText('Works once, for 24 hours.')).toBeInTheDocument()
    expect(apiMock).toHaveBeenCalledTimes(1)
    expect(apiMock).toHaveBeenCalledWith('/kids/7/enroll', { method: 'POST' })
    expect(screen.getByRole('button', { name: 'Show code for Leo' })).toBeInTheDocument()
  })

  test('New code posts again', async () => {
    view(kids)
    await userEvent.click(screen.getByRole('button', { name: 'Show code for Mia' }))
    await userEvent.click(await screen.findByRole('button', { name: /New code/ }))
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2))
  })

  test('no kids', () => {
    view([])
    expect(screen.getByText('Add a kid first, or skip this step.')).toBeInTheDocument()
  })
})
