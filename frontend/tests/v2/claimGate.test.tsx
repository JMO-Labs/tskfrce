import React from 'react'
import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { fridgeTheme } from '@/v2/theme'
import { api, ApiError } from '@/v2/api'
import { ClaimGate } from '@/v2/setup/ClaimGate'
import { CLAIM_KEY, readClaim } from '@/v2/setup/claim'

jest.mock('@/v2/api', () => ({
  api: jest.fn(),
  ApiError: class extends Error {
    constructor(public status: number, public detail: string) {
      super(detail)
    }
  },
}))
const mockApi = api as unknown as Mock<(...a: unknown[]) => Promise<unknown>>
const onClaimed = jest.fn()
const wrap = () =>
  render(
    <MantineProvider theme={fridgeTheme}>
      <ClaimGate onClaimed={onClaimed} />
    </MantineProvider>,
  )

beforeEach(() => {
  sessionStorage.clear()
  onClaimed.mockReset()
  mockApi.mockReset()
})

describe('ClaimGate', () => {
  test('stored code is posted once, no form shown', async () => {
    sessionStorage.setItem(CLAIM_KEY, 'K7M2QXA9PB')
    mockApi.mockResolvedValue(undefined)
    wrap()
    expect(screen.getByText('Checking your box…')).toBeTruthy()
    expect(screen.queryByLabelText('Box code')).toBeNull()
    await waitFor(() => expect(onClaimed).toHaveBeenCalledWith('K7M2QXA9PB'))
    expect(mockApi).toHaveBeenCalledTimes(1)
    expect(mockApi).toHaveBeenCalledWith('/setup/claim', { method: 'POST', body: { code: 'K7M2QXA9PB' } })
  })
  test('403 on a stored code clears it and shows the form with the detail', async () => {
    sessionStorage.setItem(CLAIM_KEY, 'K7M2QXA9PB')
    mockApi.mockRejectedValue(new ApiError(403, 'Wrong code. 4 tries left.'))
    wrap()
    expect(await screen.findByLabelText('Box code')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('Wrong code. 4 tries left.')
    expect(readClaim()).toBeNull()
  })
  test('typing is grouped and uppercased; 429 shows the wait', async () => {
    mockApi.mockRejectedValue(new ApiError(429, 'Too many tries. Wait 2 minutes.'))
    wrap()
    const input = screen.getByLabelText('Box code') as HTMLInputElement
    expect(document.activeElement).toBe(input)
    await userEvent.type(input, 'k7m2qxa9pb')
    expect(input.value).toBe('K7M2Q-XA9PB')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect((await screen.findByRole('alert')).textContent).toContain('Wait 2 minutes')
    expect(mockApi).toHaveBeenCalledWith('/setup/claim', { method: 'POST', body: { code: 'K7M2QXA9PB' } })
  })
  test('button is disabled while pending', async () => {
    let done: () => void = () => {}
    mockApi.mockReturnValue(new Promise<void>((r) => (done = r)))
    wrap()
    await userEvent.type(screen.getByLabelText('Box code'), 'k7m2qxa9pb')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true)
    done()
    await waitFor(() => expect(onClaimed).toHaveBeenCalled())
  })
  test('409 links to login', async () => {
    mockApi.mockRejectedValue(new ApiError(409, 'x'))
    wrap()
    await userEvent.type(screen.getByLabelText('Box code'), 'k7m2qxa9pb')
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(await screen.findByText(/already set up/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Log in' }).getAttribute('href')).toBe('/login')
  })
})
