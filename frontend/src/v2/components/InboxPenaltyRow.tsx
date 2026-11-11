import type { ComponentProps } from 'react'
import { useDevices } from '../hooks/useDevices'
import { useFamily } from '../hooks/useFamily'
import { InboxRow } from './InboxRow'

const ALERTS = ['device_resisting', 'device_bypass', 'workaround_try']

/** InboxRow plus the kid a penalty from a security alert goes to: the notification's kid, else the device's only owner. */
export function InboxPenaltyRow(props: ComponentProps<typeof InboxRow>) {
  const { n } = props
  const on = !!useFamily().data?.penalties_enabled && ALERTS.includes(n.kind)
  const devices = useDevices(on && !n.kid_id && !!n.device_id).data
  const owners = devices?.find((d) => d.id === n.device_id)?.owner_ids
  const kid = n.kid_id ?? (owners?.length === 1 ? owners[0] : undefined)
  return <InboxRow {...props} penaltyKid={on ? kid : undefined} />
}
