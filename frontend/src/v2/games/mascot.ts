/** Rive mascot animation contract and fallback SVG animations */

/**
 * .riv file contract spec: owner drops .riv file at /celebrate/mascots/{name}.riv
 * File must have:
 * - Artboard: `mascot`
 * - State machine: `states`
 * - Boolean inputs: `cheer`, `wince`, `dance`
 */
export const RIV_CONTRACT = {
  artboard: 'mascot',
  stateMachine: 'states',
  inputs: {
    cheer: 'boolean',
    wince: 'boolean',
    dance: 'boolean',
  },
}

/** SVG fallback animation CSS class names for state transitions */
export const SVG_FALLBACK_ANIMATIONS = {
  idle: '',
  cheer: 'cheerAnimation',
  wince: 'winceAnimation',
  dance: 'danceAnimation',
} as const

/** Mascot animation state type */
export type MascotState = 'idle' | 'cheer' | 'wince' | 'dance'
