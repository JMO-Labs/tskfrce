import { MASCOTS } from '../kid/celebrate/catalog'
import type { CelebrateLevel } from '../types'
import { reduceDecor } from './useGames'

const CAST = MASCOTS.filter((m) => m.art === 'cutout' && m.level === 0)

/** One of the owner's mascots, stable for a number (kid id, play id). */
export const mascotSrc = (n: number) => CAST[Math.abs(n) % CAST.length].src

/** 'off' skips decorative motion, 'small' shortens it. */
export const decor = (c: CelebrateLevel): CelebrateLevel => (reduceDecor(c) ? 'off' : c)

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
