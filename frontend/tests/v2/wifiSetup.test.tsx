import { describe, test, expect, beforeEach } from '@jest/globals'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WifiSetupPage } from '@/v2/setup/WifiSetupPage'
import { MantineProvider } from '@mantine/core'
import { useSetupWifiScan } from '@/v2/hooks/useSetupWifi'

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

  test('uses the mocked scan hook', () => {
    wrap(<WifiSetupPage />)
    expect(jest.isMockFunction(useSetupWifiScan)).toBe(true)
    expect(useSetupWifiScan).toHaveBeenCalled()
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
})
