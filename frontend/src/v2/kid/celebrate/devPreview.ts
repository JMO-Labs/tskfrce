import type { KidAge } from '../modes/types'
import { BURSTS, CARDS, type BurstFx, type CardFx, type Combo } from './pick'
import type { Show } from './plan'

/**
 * Dev-only screenshot hook: /kid?celebrate=<effect>&freeze=<ms>[&mascot=<id>][&small=1][&static=1].
 * effect: a card (pop wiggle stamp blast explode), a burst (confetti coins balloon disco sneeze),
 * word (pop + word + confetti), mascot, or parade / party (legendary). freeze pauses every animation at that time.
 */
export interface DevPreview {
  show: Show
  freeze: number | null
}

export function devPreview(search: string, mode: KidAge): DevPreview | null {
  if (process.env.NODE_ENV === 'production') return null
  const q = new URLSearchParams(search)
  const fx = q.get('celebrate')
  if (!fx) return null
  const event = { kind: 'submit' as const, key: 'dev', title: 'Feed the dog', points: 20, big: fx === 'mascot' }
  const freeze = q.has('freeze') ? Number(q.get('freeze')) : null
  if (q.has('static')) return { show: { event, kind: 'static', combo: null, mode }, freeze }
  if (q.has('small')) return { show: { event, kind: 'small', combo: null, mode }, freeze }
  const base: Combo = { card: 'pop', burst: 'confetti', word: 'BAM!', color: 'coral', mascot: null, say: 'COOL!', legendary: null }
  let combo: Combo = { ...base, mascot: q.get('mascot') }
  if (fx === 'mascot') combo = { ...base, card: 'wiggle', word: 'ROAR-SOME!', mascot: q.get('mascot') ?? 'trex', say: 'COOL!' }
  else if (fx === 'parade' || fx === 'party' || fx === 'legendary') {
    const legendary = fx === 'legendary' ? 'party' : fx
    combo = { ...base, legendary, word: legendary === 'party' ? 'DANCE PARTY!' : 'LEGENDARY!', mascot: q.get('mascot') }
  } else if ((CARDS as string[]).includes(fx)) {
    const words: Record<string, string> = { blast: 'WHOOSH!', explode: 'KAPOW!', stamp: 'WOW!' }
    combo = { ...combo, card: fx as CardFx, word: words[fx] ?? 'POW!' }
  } else if ((BURSTS as string[]).includes(fx)) {
    const words: Record<string, string> = { balloon: 'POP!', disco: 'GROOVY!', sneeze: 'ACHOO!', coins: 'ZAP!' }
    combo = { ...combo, burst: fx as BurstFx, word: words[fx] ?? 'BOOM!' }
  }
  return { show: { event, kind: 'full', combo, mode }, freeze }
}
