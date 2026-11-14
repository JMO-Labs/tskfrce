import { useEffect, useRef } from 'react'
import { track } from './track'

/** Shipped minigames; mirrors backend GAME_IDS (games_catalog.GAMES). */
const GAME_IDS = new Set(['quickfire', 'hungry-cat', 'math-dash', 'pack-the-box', 'shelf-memory'])

export function durationBucket(ms: number): string {
  const s = ms / 1000
  if (s < 30) return '<30s'
  if (s < 60) return '30-60s'
  if (s < 120) return '1-2m'
  return s < 300 ? '2-5m' : '5m+'
}

export function scoreBucket(n: number): string {
  if (n <= 0) return '0'
  if (n < 10) return '1-9'
  if (n < 50) return '10-49'
  if (n < 200) return '50-199'
  return n < 1000 ? '200-999' : '1000+'
}

/** game{id, result: start|finish|quit} kid events; quit fires when the screen unmounts mid-game. */
export function useGameTelemetry() {
  const cur = useRef<{ id: string; at: number } | null>(null)
  const send = (result: string, extra: Record<string, string> = {}) => {
    const c = cur.current
    if (c) track('game', { id: c.id, result, ...extra }, { kid: true })
  }
  const since = () => durationBucket(Date.now() - (cur.current?.at ?? Date.now()))
  useEffect(() => () => {
    send('quit', { duration_bucket: since() })
    cur.current = null
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  return {
    started: (id: string) => {
      cur.current = GAME_IDS.has(id) ? { id, at: Date.now() } : null
      send('start')
    },
    finished: (score: number) => {
      send('finish', { duration_bucket: since(), score_bucket: scoreBucket(score) })
      cur.current = null
    },
  }
}
