import { clockText } from '@/v2/clockText'
import { useExpired } from '@/v2/hooks/useDevices'
import type { Device } from '@/v2/types'
import { whyText } from './activityText'
import { ago } from './deviceMeta'

const clock = clockText

/** Device "Right now" row: state, why, when it locks, and any manual override. */
export function DeviceRightNow({ device, timeZone }: { device: Device; timeZone?: string }) {
  // an override that ran out while the screen was open no longer counts
  const expired = useExpired(device.override?.expires_at)
  const ov = expired ? null : device.override
  const verb = ov?.action === 'lock' ? 'Locked' : 'Unlocked'
  const override = !ov ? 'None · on schedule' : ov.expires_at ? `${verb} until ${clock(ov.expires_at, timeZone)}` : verb
  const why = whyText(device)
  return (
    <div className="dv-now">
      {why && (
        <div className="pk-kv">
          <span>Why</span>
          <b>{why}</b>
        </div>
      )}
      {device.locks_at && (
        <div className="pk-kv">
          <span>Locks at</span>
          <b>{clock(device.locks_at, timeZone)}</b>
        </div>
      )}
      <div className="pk-kv">
        <span>Override</span>
        <b>{override}</b>
      </div>
      <div className="pk-kv">
        <span>Last seen</span>
        <b>{device.seen_now ? 'Online now' : ago(device.last_seen)}</b>
      </div>
    </div>
  )
}
