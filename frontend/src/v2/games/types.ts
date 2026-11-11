/** Minigames: API shapes (contract in docs/superpowers/plans/2026-11-10-minigames.md) and the microgame interface. */
import type { JSX } from 'react'
import type { AgeGroup } from '../types'

export type GameKind = 'quick' | 'think'

export interface GameTile { key: string; name: string; kind: GameKind; icon: string; stars: number; rounds: number; best: number; upgrades?: number }
export interface BoardRow { kid_id: number; name: string; avatar: string | null; stars: number; me: boolean }

export interface PowerUp { key: string; name: string; icon: string }

export interface StartedPlay {
  play_id: number
  token: string
  game: string
  kind: GameKind
  level: number
  slots: string[]
  slot: number
  /** unlocked upgrade keys for this game */
  upgrades: string[]
  /** quick-fire only: per-microgame upgrade keys */
  micro_upgrades?: Record<string, string[]>
  power_ups: PowerUp[]
}

export interface GamesShelf {
  on: boolean
  saved: number
  fresh: number
  started: StartedPlay | null
  asleep_until: string | null
  games: GameTile[]
  board: { band: AgeGroup; rows: BoardRow[] } | null
  family_rounds: number
  cap: { left: number; max: number }
}

export interface GamePart { game: string; ok: boolean; ms: number }
export interface FinishBody { token: string; score: number; parts: GamePart[] | null; power_up: string | null }
export interface GameBadge { key: string; name: string; icon: string; tier: number }
export interface FinishResult {
  stars: number
  tickets: number
  points: number
  capped: boolean
  score: number
  best: number
  new_best: boolean
  badges: GameBadge[]
  saved: number
  upgrade: { name: string; have: number; need: number } | null
  unlocked: string | null
  bonus: PowerUp | null
}

export interface MicroProps {
  /** 1 easy … 5 hard; grows during a run */
  level: number
  /** seeded random for this microgame instance */
  rng: () => number
  /** call once: true = cleared. The runner ignores later calls and owns the countdown. */
  onDone: (ok: boolean) => void
  /** 'steady' upgrade: widen tolerance or ask for less */
  easier?: boolean
}

export interface Micro {
  key: string
  name: string
  /** one command word in caps, e.g. 'FLIP!' */
  cmd: string
  Component: (p: MicroProps) => JSX.Element
}
