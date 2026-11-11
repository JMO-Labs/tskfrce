/** Quick-fire run rules softened by upgrades and power-ups (pure). */
import type { AgeGroup } from '../types'
import { HEARTS, microLevel, windowMs } from './scoring'

export interface RunFx { upgrades: string[]; powerUp: string | null; /** this microgame's upgrades */ micro: string[] }

export const runHearts = (upgrades: string[], powerUp: string | null) =>
  HEARTS + (upgrades.includes('spare_heart') ? 1 : 0) + (powerUp === 'heart_plus' ? 1 : 0)

/** Time to act on game i. */
export const runWindow = (age: AgeGroup, i: number, fx: RunFx) => {
  let w = windowMs(age, i)
  if (fx.upgrades.includes('extra_time')) w *= 1.15
  if (fx.micro.includes('extra_time')) w *= 1.15
  if (fx.powerUp === 'slow_mo' && i < 6) w *= 1.5
  return Math.round(w)
}

/** Level of game i; `cycle` = number of microgames in the order, so i < cycle is a first appearance. */
export const runLevel = (start: number, i: number, cycle: number, fx: RunFx) => {
  let l = microLevel(start, i)
  if (fx.upgrades.includes('calm_start') && i < 4) l -= 1
  if (fx.micro.includes('slow_start') && i < cycle) l -= 1
  return Math.max(1, l)
}
