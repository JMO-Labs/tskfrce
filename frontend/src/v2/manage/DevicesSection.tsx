import { useRouter } from 'next/router'
import { useCallback } from 'react'
import type { Device, Group, Kid } from '@/v2/types'
import { withoutFocus } from '@/v2/parent/useFocusParam'
import { DeviceList } from './DeviceList'

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)

export function DevicesSection({
  devices,
  kids,
  groups = [],
  focus,
  tab = 'devices',
  onTabChange,
  unknownOpen = false,
}: {
  devices: Device[]
  kids: Kid[]
  groups?: Group[]
  focus: number
  tab?: 'devices' | 'groups'
  onTabChange?: (tab: 'devices' | 'groups') => void
  unknownOpen?: boolean
}) {
  const router = useRouter()
  const item = first(router.query.item)
  const selectedId = item === 'new' ? ('new' as const) : focus || null

  const handleSelectDevice = useCallback(
    (id: number) => {
      const { tab: _t, ...rest } = withoutFocus(router.query)
      router.push({ pathname: router.pathname, query: { ...rest, item: id } }, undefined, { shallow: true })
    },
    [router],
  )

  const handleSelectUnknown = useCallback(() => {
    const { tab: _t, ...rest } = withoutFocus(router.query)
    router.push({ pathname: router.pathname, query: { ...rest, item: 'unknown' } }, undefined, { shallow: true })
  }, [router])

  const handleSelectGroup = useCallback(
    (id: number | 'new') => router.push({ pathname: router.pathname, query: { ...withoutFocus(router.query), item: id, tab: 'groups' } }, undefined, { shallow: true }),
    [router],
  )

  return (
    <DeviceList
      devices={devices}
      kids={kids}
      groups={groups}
      selectedDevice={unknownOpen || selectedId === 'new' ? null : selectedId}
      selectedGroup={selectedId}
      onSelectDevice={handleSelectDevice}
      onSelectGroup={handleSelectGroup}
      onSelectUnknown={handleSelectUnknown}
      selectedUnknown={unknownOpen}
      tab={tab}
      onTabChange={onTabChange}
    />
  )
}
