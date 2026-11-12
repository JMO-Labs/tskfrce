import { beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiError, AuthError, api } from '@/v2/api'
import { StepParent, type ParentForm } from '@/v2/setup/StepParent'

jest.mock('@/v2/api', () => ({ ...(jest.requireActual('@/v2/api') as object), api: jest.fn() }))

const apiMock = api as unknown as Mock<(p: string) => Promise<unknown>>

function Harness() {
  const [v, setV] = useState<ParentForm>({ username: '', password: '', again: '', fullName: '' })
  return <StepParent value={v} showError={false} onChange={setV} />
}
const renderStep = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <Harness />
    </QueryClientProvider>,
  )
const checks = () => apiMock.mock.calls.filter(([p]) => p.startsWith('/setup/username-available'))

beforeEach(() => apiMock.mockReset())

describe('StepParent username check', () => {
  test('typing a long username sends only 1-2 checks', async () => {
    apiMock.mockResolvedValue({ available: true })
    renderStep()
    await userEvent.type(screen.getByLabelText('Username'), 'alexander_smith')
    expect(await screen.findByText('Available')).toBeInTheDocument()
    expect(checks().length).toBeGreaterThanOrEqual(1)
    expect(checks().length).toBeLessThanOrEqual(2)
    expect(checks().at(-1)?.[0]).toBe('/setup/username-available?u=alexander_smith')
  })

  test('falls back to the auth endpoint on 401', async () => {
    apiMock.mockImplementation(async (p) => {
      if (p.startsWith('/setup/username-available?')) throw new AuthError('auth')
      return { available: false }
    })
    renderStep()
    await userEvent.type(screen.getByLabelText('Username'), 'alex')
    expect(await screen.findByText('Taken, try another')).toBeInTheDocument()
    expect(checks().map(([p]) => p)).toEqual([
      '/setup/username-available?u=alex',
      '/setup/username-available-auth?u=alex',
    ])
  })

  test('429 does not hit the auth endpoint and shows a message', async () => {
    apiMock.mockRejectedValue(new ApiError(429, 'Too many requests'))
    renderStep()
    await userEvent.type(screen.getByLabelText('Username'), 'alex')
    expect(await screen.findByText(/Couldn't check this username/)).toBeInTheDocument()
    expect(checks().map(([p]) => p)).toEqual(['/setup/username-available?u=alex'])
  })
})
