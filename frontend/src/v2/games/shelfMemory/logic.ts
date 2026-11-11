/** Shelf Memory logic: look at the shelf, then put each item back where it was. */
import type { AgeGroup } from '../../types'

export const SHELF_MS = 120_000
export const PEEK_MS = 2_000
export const MAX_ITEMS = 8
const POOL = ['🧸', '📚', '🪴', '☕', '🧦', '🔦', '⏰', '🎨', '🧃', '🍎', '🧢', '🪁', '🔔', '🧴', '🥄', '🎒']

export const baseItems = (age: AgeGroup) => (age === 'little' ? 3 : age === 'kid' ? 4 : 5)
export const baseLookMs = (age: AgeGroup) => (age === 'little' ? 3000 : age === 'kid' ? 2500 : 2000)

export const clockMs = (upgrades: string[]) => Math.round(SHELF_MS * (upgrades.includes('extra_time') ? 1.15 : 1))
export const lookMs = (age: AgeGroup, upgrades: string[]) => baseLookMs(age) + (upgrades.includes('longer_look') ? 1000 : 0)

/** Item count for a 0-based round: base + round, one fewer in round 0 with fewer_items, capped. */
export function itemCount(round: number, age: AgeGroup, upgrades: string[]) {
  const n = baseItems(age) + round - (round === 0 && upgrades.includes('fewer_items') ? 1 : 0)
  return Math.min(MAX_ITEMS, Math.max(2, n))
}

/** `slots[i]` is the emoji that belongs in slot i (distinct emoji, shuffled). */
export function newRound(round: number, age: AgeGroup, upgrades: string[], rng: () => number): string[] {
  const pool = [...POOL]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.slice(0, itemCount(round, age, upgrades))
}

/** Placing `item` (index into slots) into `slot`: correct when equal, or when `locked` (counts as correct). */
export const isRight = (item: number, slot: number, locked: boolean) => locked || item === slot
