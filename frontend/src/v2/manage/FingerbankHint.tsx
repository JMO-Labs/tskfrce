import Link from 'next/link'
import { useFamily, usePatchFamily } from '@/v2/hooks/useFamily'
import type { Device } from '@/v2/types'

/** The device's name is only the maker or "Unknown". */
export const weakName = (d: Pick<Device, 'name_source'>) => d.name_source === 'vendor' || d.name_source === 'unknown'

/** One-time hint on a device card whose name fell back to the MAC vendor or "Unknown". */
export function FingerbankHint({ device }: { device: Device }) {
  const fam = useFamily().data
  const patch = usePatchFamily()
  if (!fam || fam.fingerbank_enabled || fam.fingerbank_hint_seen || !weakName(device)) return null
  const dismiss = () => patch.mutate({ fingerbank_hint_seen: true })
  return (
    <p className="pn-help pn-note" role="note">
      Can&apos;t tell what this device is. Turn on better device names to recognise it.{' '}
      <Link className="pn-link" href="/settings?section=names" onClick={dismiss}>
        Turn on
      </Link>{' '}
      <button type="button" className="p-btn" onClick={dismiss}>
        Dismiss
      </button>
    </p>
  )
}
