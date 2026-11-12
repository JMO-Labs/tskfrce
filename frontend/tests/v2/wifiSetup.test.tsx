import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WifiSetupPage } from '@/v2/setup/WifiSetupPage'
import { MantineProvider } from '@mantine/core'
import { track } from '@/v2/eval/track'

jest.mock('@/v2/eval/track', () => ({ track: jest.fn() }))
jest.mock('@/v2/hooks/useSetupWifi', () => ({
  useSetupWifiStatus: jest.fn(() => ({
    data: { phase: 'idle' },
    isPending: false,
    isError: false,
  })),
  useSetupWifiJoin: jest.fn(() => ({
    mutate: jest.fn(),
    isPending: false,
  })),
  useSetupWifiScan: jest.fn(() => ({
    data: [
      { ssid: 'TestWifi', signal: 80, security: 'wpa' },
      { ssid: 'GuestNet', signal: 60, security: 'wpa' },
    ],
    isPending: false,
  })),
}))

const wrap = (ui: React.ReactElement) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  )

describe('WifiSetup page', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  test('renders heading and description', () => {
    wrap(<WifiSetupPage />)
    expect(screen.getByText('Connect to Wi-Fi')).toBeInTheDocument()
  })

  test('displays available networks section', () => {
    wrap(<WifiSetupPage />)
    expect(screen.getByText('Available Networks')).toBeInTheDocument()
  })

  test('page renders without error', () => {
    wrap(<WifiSetupPage />)
    expect(screen.getByText('Connect to Wi-Fi')).toBeInTheDocument()
  })

  test('no emoji in WifiSetup page', () => {
    const { container } = wrap(<WifiSetupPage />)
    const textContent = container.textContent ?? ''
    // Check for emoji using Unicode Extended_Pictographic property
    const hasEmoji = /\p{Extended_Pictographic}/gu.test(textContent)
    expect(hasEmoji).toBe(false)
  })

  test('emits screen_view on open and feature start on join', () => {
    wrap(<WifiSetupPage />)
    expect(track).toHaveBeenCalledWith('screen_view', { route: '/wifi-setup' })
    fireEvent.click(screen.getByText('TestWifi'))
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'hunter22' } })
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    expect(track).toHaveBeenCalledWith('feature', { area: 'wifi', action: 'start' })
  })

  test('emits feature done / fail from the join phase', () => {
    const m = jest.requireMock('@/v2/hooks/useSetupWifi') as { useSetupWifiStatus: jest.Mock }
    m.useSetupWifiStatus.mockReturnValueOnce({ data: { phase: 'connected' }, isPending: false })
    wrap(<WifiSetupPage />)
    expect(track).toHaveBeenCalledWith('feature', { area: 'wifi', action: 'done' })
    expect(track).toHaveBeenCalledWith('setup_detail', { step: 1, what: 'wifi_changed' })
    m.useSetupWifiStatus.mockReturnValueOnce({ data: { phase: 'failed' }, isPending: false })
    wrap(<WifiSetupPage />)
    expect(track).toHaveBeenCalledWith('feature', { area: 'wifi', action: 'fail' })
  })
})
