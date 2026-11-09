import { beforeAll, beforeEach, describe, expect, test } from '@jest/globals'
import type { Mock } from 'jest-mock'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MantineProvider } from '@mantine/core'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StepKids } from '@/v2/setup/StepKids'
import { api } from '@/v2/api'
import { fridgeTheme } from '@/v2/theme'
import type { Kid } from '@/v2/types'

jest.mock('@/v2/api', () => ({ api: jest.fn() }))
const apiMock = api as unknown as Mock<(p: string, i?: { method?: string; body?: unknown }) => Promise<unknown>>

const added: Kid[] = [{ id: 1, full_name: 'Maya', username: 'm', avatar: '🦊', has_pin: true } as Kid, { id: 2, full_name: 'Leo', username: 'l', avatar: '🐼', has_pin: false } as Kid]

function setup(kids: Kid[] = [], name = '') {
  const onAdd = jest.fn()
  const onName = jest.fn()
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider theme={fridgeTheme}>
        <StepKids kids={kids} name={name} onName={onName} onAdd={onAdd} />
      </MantineProvider>
    </QueryClientProvider>,
  )
  return { onAdd, onName }
}

beforeAll(() => {
  window.matchMedia = window.matchMedia || ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) as unknown as MediaQueryList)
  window.ResizeObserver = window.ResizeObserver || class { observe() {} unobserve() {} disconnect() {} }
})
beforeEach(() => { apiMock.mockReset().mockResolvedValue({ id: 9, full_name: 'Ava', username: 'a', avatar: '🦊', has_pin: false }) })

describe('StepKids calm', () => {
  test('avatar grid opens from the avatar button in a pop-over', async () => {
    const user = userEvent.setup()
    setup([], 'Ava')
    expect(screen.queryByRole('button', { name: 'Avatar 🐼' })).not.toBeInTheDocument()
    const btn = screen.getByRole('button', { name: /Pick an avatar, now/ })
    await user.click(btn)
    await user.click(await screen.findByRole('button', { name: 'Avatar 🐼' }))
    expect(screen.queryAllByRole('button', { name: /^Avatar / })).toHaveLength(0) // picking closes it
    await waitFor(() => expect(screen.getByRole('button', { name: 'Pick an avatar, now 🐼' })).toBeInTheDocument())
  })

  test('Esc closes the avatar pop-over and focus returns to the button', async () => {
    const user = userEvent.setup()
    setup()
    const btn = screen.getByRole('button', { name: /Pick an avatar, now/ })
    await user.click(btn)
    const grid = await screen.findByRole('group', { name: 'Pick an avatar' })
    await waitFor(() => expect(grid).toContainElement(document.activeElement as HTMLElement)) // focus trapped in the grid
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Avatar 🐼' })).not.toBeInTheDocument())
    expect(btn).toHaveFocus()
  })

  test('added kids show one line each', () => {
    setup(added)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('Maya')
    expect(rows[0]).toHaveTextContent('PIN set')
    expect(rows[1]).toHaveTextContent('No PIN')
    expect(rows[1]).toHaveTextContent('Added')
  })

  test('PIN helper is in the (i) pop-over, not on screen', async () => {
    const user = userEvent.setup()
    setup()
    expect(screen.queryByText(/prove it's them/)).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'About PINs' }))
    expect(await screen.findByText(/prove it's them on a shared device/)).toBeInTheDocument()
  })

  test('bad PIN shows inline error and disables Add kid', async () => {
    const user = userEvent.setup()
    setup([], 'Ava')
    await user.type(screen.getByRole('textbox', { name: /PIN \(optional\)/ }), '12')
    expect(screen.getByText('Use exactly 4 digits.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Add kid/ })).toBeDisabled()
  })

  test('PIN error line is an alert under the pair, flags the field, and clears when fixed', async () => {
    const user = userEvent.setup()
    setup([], 'Ava')
    const pin = screen.getByRole('textbox', { name: /PIN \(optional\)/ })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    await user.type(pin, '12')
    expect(screen.getByRole('alert')).toHaveTextContent('Use exactly 4 digits.')
    expect(pin).toHaveAttribute('aria-invalid', 'true')
    await user.type(pin, '34')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(pin).not.toHaveAttribute('aria-invalid', 'true')
    expect(screen.getByRole('button', { name: /Add kid/ })).toBeEnabled()
  })

  test('Add kid posts the picked avatar and PIN', async () => {
    const user = userEvent.setup()
    const { onAdd } = setup([], 'Ava')
    await user.click(screen.getByRole('button', { name: /Pick an avatar, now/ }))
    await user.click(await screen.findByRole('button', { name: 'Avatar 🐼' }))
    await user.type(screen.getByRole('textbox', { name: /PIN \(optional\)/ }), '1234')
    await user.click(screen.getByRole('button', { name: /Add kid/ }))
    await waitFor(() => expect(onAdd).toHaveBeenCalled())
    expect(apiMock).toHaveBeenCalledWith('/kids', { method: 'POST', body: { full_name: 'Ava', avatar: '🐼', pin: '1234' } })
  })
})
