/**
 * @fileoverview Captive portal for Wi-Fi setup during box initialization
 */

import { useState, useCallback } from 'react'
import { Button, Modal, PasswordInput, Select, Stack, Text, TextInput, Group, Alert, Loader, Center, Box, Checkbox } from '@mantine/core'
import { IconWifi, IconPlus } from '@tabler/icons-react'
import { useSetupWifiStatus, useSetupWifiScan } from '@/v2/hooks/useSetupWifi'
import { api, ApiError } from '@/v2/api'
import { useMutation } from '@tanstack/react-query'
import { tokenManager } from '@/services/tokenManager'
import styles from '@/v2/setup/wifiSetup.module.css'

interface NetworkItem {
  ssid: string
  signal: number
  security: string
}

export function WifiSetupPage() {
  const [selectedNetwork, setSelectedNetwork] = useState<NetworkItem | null>(null)
  const [manualSsid, setManualSsid] = useState('')
  const [manualPassword, setManualPassword] = useState('')
  const [manualSecurity, setManualSecurity] = useState('wpa')
  const [manualHidden, setManualHidden] = useState(false)
  const [showOtherDialog, setShowOtherDialog] = useState(false)
  const [showParentLogin, setShowParentLogin] = useState(false)
  const [parentUsername, setParentUsername] = useState('')
  const [parentPassword, setParentPassword] = useState('')
  const [pendingJoin, setPendingJoin] = useState<{
    ssid: string
    password?: string
    security: string
    hidden: boolean
  } | null>(null)
  const [authError, setAuthError] = useState('')
  const [authForbidden, setAuthForbidden] = useState(false)

  const scanQuery = useSetupWifiScan()
  const statusQuery = useSetupWifiStatus(false)

  // Custom join mutation that handles auth errors
  const joinMutation = useMutation({
    mutationFn: async (params: { ssid: string; password?: string; security: string; hidden: boolean }) => {
      const response = await api('/v1/network/wifi/setup/join', {
        method: 'POST',
        body: { ssid: params.ssid, password: params.password, security: params.security, hidden: params.hidden },
      })
      return response
    },
    onSuccess: () => {
      setPendingJoin(null)
      setParentUsername('')
      setParentPassword('')
      setShowParentLogin(false)
      setAuthError('')
    },
    onError: (error: any) => {
      const status = error?.status
      if (status === 401) {
        setShowParentLogin(true)
        setAuthError('Parent sign-in required to change Wi-Fi')
      } else if (status === 403) {
        setAuthForbidden(true)
        setAuthError('A parent must sign in to change Wi-Fi')
      }
    },
  })

  const networks = scanQuery.data ?? []
  const isConnecting = joinMutation.isPending || (statusQuery.data?.state === 'connecting')
  const isSuccess = statusQuery.data?.state === 'connected'
  const isError = statusQuery.data?.state === 'failed'

  const handleNetworkClick = (net: NetworkItem) => {
    setSelectedNetwork(net)
    setManualSsid(net.ssid)
  }

  const handleJoin = (ssid: string, password?: string, security?: string) => {
    const joinParams = {
      ssid,
      password: password || undefined,
      security: security || 'wpa',
      hidden: false,
    }
    setPendingJoin(joinParams)
    joinMutation.mutate(joinParams)
  }

  const handleOtherNetworkJoin = () => {
    if (!manualSsid.trim()) return
    handleJoin(manualSsid, manualPassword || undefined, manualSecurity)
    setShowOtherDialog(false)
  }

  const handleParentSignIn = useCallback(async () => {
    if (!parentUsername.trim() || !parentPassword.trim() || !pendingJoin) return
    setAuthError('')

    try {
      // ponytail: POST to /auth/login, store token, retry join
      const loginResp = await api<{ access_token: string; refresh_token?: string; expires_in: number }>('/auth/login', {
        method: 'POST',
        body: { username: parentUsername, password: parentPassword },
      })

      if (!loginResp?.access_token) {
        setAuthError('Invalid response from server')
        return
      }

      // Store tokens in tokenManager so subsequent requests use them
      tokenManager.setTokens({
        access_token: loginResp.access_token,
        refresh_token: loginResp.refresh_token || '',
        expires_in: loginResp.expires_in || 3600,
      })

      // Retry the join request - it will now use the parent token
      await joinMutation.mutateAsync(pendingJoin)
    } catch (e: any) {
      const apiError = e as ApiError
      setAuthError(apiError?.detail || e?.message || 'Sign-in failed')
    }
  }, [parentUsername, parentPassword, pendingJoin, joinMutation])

  const getSignalLabel = (signal: number) => {
    if (signal >= 70) return 'Strong'
    if (signal >= 50) return 'Fair'
    return 'Weak'
  }

  if (authForbidden) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div style={{ fontSize: 32, marginBottom: 16, textAlign: 'center' }}>✕</div>
          <h1>Access Restricted</h1>
          <p>A parent must sign in to change the Wi-Fi network</p>
        </div>
        <Button
          fullWidth
          onClick={() => {
            setAuthForbidden(false)
            setParentUsername('')
            setParentPassword('')
            setShowParentLogin(false)
            setPendingJoin(null)
          }}
          variant="filled"
        >
          Try Again
        </Button>
      </div>
    )
  }

  if (isSuccess) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div style={{ fontSize: 32, marginBottom: 16, textAlign: 'center' }}>✓</div>
          <h1>Connected</h1>
          <p>Your box is on {statusQuery.data?.ssid}</p>
          <p style={{ fontSize: 12, marginTop: 8, opacity: 0.7 }}>
            Scan &quot;Open my box&quot; on the sticker to continue setup.
          </p>
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className={styles.container}>
        <div className={styles.header}>
          <div style={{ fontSize: 32, marginBottom: 16, textAlign: 'center', color: 'var(--p-error)' }}>✕</div>
          <h1>Connection Failed</h1>
          <p>
            {statusQuery.data?.error === 'wrong_password'
              ? 'Check the password and try again'
              : 'Unable to connect. Verify network and try again'}
          </p>
        </div>
        <Button
          fullWidth
          onClick={() => {
            setManualPassword('')
            setSelectedNetwork(null)
            setManualSsid('')
          }}
          variant="filled"
        >
          Try Again
        </Button>
      </div>
    )
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <h1>Connect to Wi-Fi</h1>
        <p>Select your home network and enter the password</p>
      </div>

      {isConnecting && (
        <Alert icon={<Loader size={16} />} color="blue" mb="md">
          <Text size="sm">Connecting…</Text>
          <Text size="xs" mt={8} opacity={0.8}>
            Your phone will leave the setup Wi-Fi. If this page doesn&apos;t update within a minute, rejoin
            Wi-Fi <code>t@sk4ce-K7M2</code> and reopen this page.
          </Text>
        </Alert>
      )}

      <Box mb="md">
        <Text size="sm" fw={500} mb={8}>
          Available Networks
        </Text>
        <Stack gap={0} className={styles.networkList}>
          {networks.map((net) => (
            <button
              key={net.ssid}
              className={styles.networkItem}
              onClick={() => handleNetworkClick(net)}
              disabled={isConnecting}
            >
              <div>
                <div className={styles.networkName}>{net.ssid}</div>
                <div className={styles.networkSignal}>
                  {getSignalLabel(net.signal)} ({net.signal}%)
                </div>
              </div>
              <IconWifi size={20} />
            </button>
          ))}
          <button
            className={styles.networkItem}
            onClick={() => setShowOtherDialog(true)}
            disabled={isConnecting}
          >
            <div className={styles.networkName}>Other network…</div>
            <IconPlus size={20} />
          </button>
        </Stack>
      </Box>

      {!selectedNetwork && (
        <Stack gap="md">
          <TextInput
            label="Network Name"
            placeholder="MyHomeWifi"
            value={manualSsid}
            onChange={(e) => setManualSsid(e.currentTarget.value)}
            disabled={isConnecting}
          />
          <PasswordInput
            label="Password"
            placeholder="••••••••"
            value={manualPassword}
            onChange={(e) => setManualPassword(e.currentTarget.value)}
            disabled={isConnecting}
          />
          <Button
            fullWidth
            onClick={() => handleJoin(manualSsid, manualPassword || undefined)}
            disabled={!manualSsid.trim() || isConnecting}
            loading={isConnecting}
          >
            Connect
          </Button>
        </Stack>
      )}

      {selectedNetwork && (
        <Stack gap="md">
          <TextInput label="Network Name" value={selectedNetwork.ssid} disabled />
          <PasswordInput
            label="Password"
            placeholder="••••••••"
            value={manualPassword}
            onChange={(e) => setManualPassword(e.currentTarget.value)}
            disabled={isConnecting}
          />
          <Group grow>
            <Button
              variant="default"
              onClick={() => {
                setSelectedNetwork(null)
                setManualPassword('')
              }}
              disabled={isConnecting}
            >
              Back
            </Button>
            <Button
              onClick={() => handleJoin(selectedNetwork.ssid, manualPassword || undefined, selectedNetwork.security)}
              disabled={!manualPassword.trim() || isConnecting}
              loading={isConnecting}
            >
              Connect
            </Button>
          </Group>
        </Stack>
      )}

      <Text size="xs" opacity={0.6} mt="lg" ta="center">
        Your phone will return to your home network. Scan &quot;Open my box&quot; QR to continue setup.
      </Text>

      <Modal opened={showOtherDialog} onClose={() => setShowOtherDialog(false)} title="Join Network" centered>
        <Stack gap="md">
          <TextInput
            label="Network Name (SSID)"
            placeholder="Network name"
            value={manualSsid}
            onChange={(e) => setManualSsid(e.currentTarget.value)}
            disabled={isConnecting}
          />
          <Select
            label="Security"
            data={[
              { value: 'wpa', label: 'WPA2/WPA3 Personal' },
              { value: 'sae', label: 'WPA3 Personal only' },
              { value: 'open', label: 'Open (no password)' },
            ]}
            value={manualSecurity}
            onChange={(val) => setManualSecurity(val || 'wpa')}
            disabled={isConnecting}
          />
          {manualSecurity !== 'open' && (
            <PasswordInput
              label="Password"
              placeholder="8–63 characters"
              value={manualPassword}
              onChange={(e) => setManualPassword(e.currentTarget.value)}
              disabled={isConnecting}
              description="8–63 characters"
            />
          )}
          <Checkbox label="Hidden network" checked={manualHidden} onChange={(e) => setManualHidden(e.currentTarget.checked)} />
          <Group grow>
            <Button variant="default" onClick={() => setShowOtherDialog(false)} disabled={isConnecting}>
              Cancel
            </Button>
            <Button
              onClick={handleOtherNetworkJoin}
              disabled={!manualSsid.trim() || (manualSecurity !== 'open' && !manualPassword.trim()) || isConnecting}
              loading={isConnecting}
            >
              Join
            </Button>
          </Group>
        </Stack>
      </Modal>

      <Modal opened={showParentLogin} onClose={() => setShowParentLogin(false)} title="Parent Sign-In" centered>
        <Stack gap="md">
          {authError && <Alert color="red">{authError}</Alert>}
          <TextInput
            label="Username"
            placeholder="Parent username"
            value={parentUsername}
            onChange={(e) => setParentUsername(e.currentTarget.value)}
            disabled={joinMutation.isPending}
            autoFocus
          />
          <PasswordInput
            label="Password"
            placeholder="••••••••"
            value={parentPassword}
            onChange={(e) => setParentPassword(e.currentTarget.value)}
            disabled={joinMutation.isPending}
          />
          <Group grow>
            <Button variant="default" onClick={() => setShowParentLogin(false)} disabled={joinMutation.isPending}>
              Cancel
            </Button>
            <Button
              onClick={handleParentSignIn}
              disabled={!parentUsername.trim() || !parentPassword.trim() || joinMutation.isPending}
              loading={joinMutation.isPending}
            >
              Sign In
            </Button>
          </Group>
        </Stack>
      </Modal>
    </div>
  )
}
