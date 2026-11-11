import { useEffect, useRef, useState } from 'react'

/** Milliseconds since mount, ticking ~60/s while running. Remount (React `key`) to restart.
 *  setInterval + Date.now() so jest fake timers drive it. Pausing keeps the value. */
export function useElapsed(running = true): number {
  const [ms, setMs] = useState(0)
  const base = useRef(0)
  useEffect(() => {
    if (!running) return
    const start = Date.now() - base.current
    const id = setInterval(() => {
      base.current = Date.now() - start
      setMs(base.current)
    }, 16)
    return () => clearInterval(id)
  }, [running])
  return ms
}
