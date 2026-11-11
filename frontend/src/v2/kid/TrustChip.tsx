import type { KidTrust } from '../trustTypes'
import type { KidAge } from './modes/types'
import { KidChip, type ChipSize } from './KidChip'
import type { KidChipT } from './kidChips'

const NAMES = ['New', 'Trusted', 'Proven'] as const
const NEXT = ['Trusted', 'Proven'] as const
const TONES: KidChipT['tone'][] = ['today', 'done', 'sun']
const SIZE: Record<KidAge, ChipSize> = { little: 'lg', kid: 'md', teen: 'sm' }

/** The one line beside the chip. Teen is plain, no cheering. */
export function trustLine(t: KidTrust, mode: KidAge): string {
  if (t.to_next == null || t.goal == null || t.level === 2) return mode === 'teen' ? 'You made it to Proven.' : 'You made it to Proven. Keep it up!'
  const next = NEXT[t.level]
  if (mode === 'teen') return `${t.goal - t.to_next} of ${t.goal} toward ${next}.`
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
