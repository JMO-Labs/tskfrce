import { useSyncExternalStore } from 'react'
import { alertLink, deviceKid, alertStored } from './kidDevice'
import { alertsMoved, onAlertsMoved, setAlertsMoved } from './movedFlag'

/** One line shown when a removed phone changed this kid's alert topic. Tapping reopens ntfy. */
export function AlertsMoved() {
  const moved = useSyncExternalStore(onAlertsMoved, alertsMoved, () => false)
  const a = moved ? alertStored() : null
  if (!a || !deviceKid()) return null
  return (
    <a className="k-gate-msg" href={alertLink(a)} onClick={() => setAlertsMoved(false)}>
      Your alerts moved. Tap to reconnect.
    </a>
  )
}
