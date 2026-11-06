import { describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { api } from '@/v2/api'
import { PasswordCard } from '@/v2/manage/PasswordCard'

const mockShow = jest.fn()
jest.mock('@mantine/notifications', () => ({ notifications: { show: (...a: unknown[]) => mockShow(...a) } }))
jest.mock('@/v2/api', () => {
  class ApiError extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  }
  return { api: jest.fn(), ApiError }
})
const apiMock = api as unknown as Mock<(p: string, i?: { body?: unknown }) => Promise<unknown>>

const fill = async (cur: string, next: string, again: string) => {
  render(
    <MantineProvider>
      <PasswordCard />
    </MantineProvider>,
  )
  await userEvent.type(screen.getByLabelText('Current password'), cur)
  await userEvent.type(screen.getByLabelText('New password'), next)
  await userEvent.type(screen.getByLabelText('Confirm new password'), again)
  await userEvent.click(screen.getByRole('button', { name: 'Change password' }))
}

describe('PasswordCard', () => {
  test('posts current and new password, then confirms', async () => {
    apiMock.mockReset().mockResolvedValue({})
    await fill('old-pass-1', 'new-pass-123', 'new-pass-123')
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/users/password', { method: 'POST', body: { current_password: 'old-pass-1', new_password: 'new-pass-123' } }))
    await waitFor(() => expect(mockShow).toHaveBeenCalledWith(expect.objectContaining({ message: 'Password changed.' })))
  })
  test('mismatch never calls the server', async () => {
    apiMock.mockReset()
    await fill('old-pass-1', 'new-pass-123', 'new-pass-124')
    expect(await screen.findByText("Passwords don't match.")).toBeTruthy()
    expect(apiMock).not.toHaveBeenCalled()
  })
  test('400 shows the wrong-password detail after exactly one POST', async () => {
    const { ApiError } = jest.requireMock('@/v2/api') as { ApiError: new (s: number, d: string) => Error }
    apiMock.mockReset().mockRejectedValue(new ApiError(400, "That's not your current password."))
    await fill('nope', 'new-pass-123', 'new-pass-123')
    expect(await screen.findByText("That's not your current password.")).toBeTruthy()
    expect(apiMock).toHaveBeenCalledTimes(1)
  })
  test('422 shows the server detail', async () => {
    const { ApiError } = jest.requireMock('@/v2/api') as { ApiError: new (s: number, d: string) => Error }
    apiMock.mockReset().mockRejectedValue(new ApiError(422, 'Password is too common.'))
    await fill('old-pass-1', 'password123', 'password123')
    expect(await screen.findByText('Password is too common.')).toBeTruthy()
  })
})
