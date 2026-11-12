import { track } from './track'
import type { Style } from '../presets/types'

/** setup_detail{step, what}: enums only, mirrors backend SETUP_WHAT. */
export function setupDetail(step: number, what: string): void {
  track('setup_detail', { step, what })
}

export function devicesFound(n: number): string {
  if (n <= 0) return 'devices_found_0'
  if (n <= 3) return 'devices_found_1_3'
  return n <= 9 ? 'devices_found_4_9' : 'devices_found_10p'
}

/** Share of the offered starter chores the parent kept. */
export function choresKept(kept: number, offered: number): string {
  if (offered <= 0 || kept >= offered) return 'chores_kept_100'
  if (kept <= 0) return 'chores_kept_0'
  return kept * 2 < offered ? 'chores_kept_lt50' : 'chores_kept_50_99'
}

export function presetWhat(style: Style, perKid: Record<number, Style> | null): string {
  const picks = new Set(perKid ? Object.values(perKid) : [style])
  return picks.size > 1 ? 'preset_mixed' : `preset_${[...picks][0] ?? style}`
}
