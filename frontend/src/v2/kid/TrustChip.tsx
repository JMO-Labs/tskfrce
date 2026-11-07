import type { KidTrust } from '../types'
import type { KidAge } from './modes/types'
import { KidChip, type ChipSize } from './KidChip'
import type { KidChipT } from './kidChips'

const NAMES = ['New', 'Trusted', 'Proven'] as const
const NEXT = ['Trusted', 'Proven'] as const
/** clean chores to move up from each level (mirrors backend services/trust.py UP_AT) */
const UP_AT = [10, 30] as const
const TONES: KidChipT['tone'][] = ['today', 'done', 'sun']
const SIZE: Record<KidAge, ChipSize> = { little: 'lg', kid: 'md', teen: 'sm' }

/** The one line beside the chip. Teen is plain, no cheering. */
export function trustLine(t: KidTrust, mode: KidAge): string {
  if (t.to_next == null || t.level === 2) return mode === 'teen' ? 'You made it to Proven.' : 'You made it to Proven. Keep it up!'
  const next = NEXT[t.level]
  const total = UP_AT[t.level]
  if (mode === 'teen') return `${total - t.to_next} of ${total} toward ${next}.`
  const more = `${t.to_next} more ${t.to_next === 1 ? 'chore' : 'chores'} to ${next}`
  return t.level === 0 ? `${more}!` : `${more}. Nice going.`
}

/** Me page trust chip and line (mockup s5). Nothing when trust mode is off. */
export function TrustChip({ trust, mode }: { trust?: KidTrust | null; mode: KidAge }) {
  if (!trust) return null
  return (
    <div className="me-trust">
      <KidChip chip={{ tone: TONES[trust.level], icon: 'verified', label: NAMES[trust.level] }} size={SIZE[mode]} />
      <span>{trustLine(trust, mode)}</span>
    </div>
  )
}
