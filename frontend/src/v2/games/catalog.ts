import type { GameKind } from './types'

/** Client names and icons; the server catalog (games_catalog.py) is the authority. */
export const GAME_INFO: Record<string, { name: string; icon: string; kind: GameKind }> = {
  quickfire: { name: 'Quick-fire', icon: '⚡', kind: 'quick' },
  'hungry-cat': { name: 'Hungry Cat', icon: '🐱', kind: 'think' },
}

export const gameName = (key: string) => GAME_INFO[key]?.name ?? key
