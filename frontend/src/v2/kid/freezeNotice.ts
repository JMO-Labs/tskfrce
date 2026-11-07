import { useEffect } from 'react'
import { toastOk } from '../notify'

export const FREEZE_MSG = 'Freeze used: your streak is safe 🧊'
const key = (kidId?: number | null) => `t4c-freeze-seen-${kidId ?? 'me'}`

/** One kind toast per new freeze, per kid, per device. Stores only the latest frozen date (bounded). */
export function useFreezeNotice(frozen: string[] | undefined, kidId: number | null | undefined, on: boolean) {
  const latest = frozen?.length ? [...frozen].sort().at(-1)! : null
  useEffect(() => {
    if (!on || !latest) return
    try {
      const seen = localStorage.getItem(key(kidId))
      if (seen && seen >= latest) return
      localStorage.setItem(key(kidId), latest)
    } catch {
      return // no storage: skip rather than nag every poll
    }
    toastOk(FREEZE_MSG)
  }, [on, latest, kidId])
}
