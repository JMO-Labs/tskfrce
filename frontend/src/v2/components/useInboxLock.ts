import { useEffect } from 'react'
import type { InboxItem } from '../hooks/useInbox'
import { useLockKid } from '../hooks/useDeviceActivity'
import { toastOk } from '../notify'

/** "Lock all <kid>'s devices" from an inbox row, with Undo (same as the device activity row). */
export function useInboxLock() {
  const lock = useLockKid()
  return (n: InboxItem) => {
    if (!n.kid_id) return
    const kidId = n.kid_id
    const name = n.kid_name ?? 'kid'
    lock.mutate({ kidId, action: 'lock' }, {
      onSuccess: () => toastOk(`Locked all ${name}'s devices`, { undo: () => lock.mutate({ kidId, action: 'clear' }, { onSuccess: () => toastOk('Undone') }) }),
    })
  }
}

/** Escape closes the desktop popover wherever focus is, except inside a row's "..." menu (that closes just the menu). */
export function useEscClose(opened: boolean, close: () => void) {
  useEffect(() => {
    if (!opened) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target as Element | null)?.closest?.('[role="menu"], [aria-expanded="true"], [data-mantine-stop-propagation]')) close() }
    window.addEventListener('keydown', esc, true)
    return () => window.removeEventListener('keydown', esc, true)
  }, [opened, close])
}
