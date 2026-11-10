import { forwardRef, useState } from 'react'
import { useAwardBadge } from '@/v2/hooks/useCustomBadges'
import { errorText } from '@/v2/errorText'
import { Icon } from '@/v2/parent/Icon'
import { KidPicker } from '@/v2/parent/KidPicker'
import type { CustomBadge, Kid } from '@/v2/types'
import { nameOf } from './choreMeta'
import { tierLabel } from './TierPips'
import { useSingle } from './useSingle'
import { toastOk } from '../notify'

/** Award form, shown after tapping Award: pick a kid, see their next tier, add an optional note. */
export const BadgeAward = forwardRef<HTMLDivElement, { id: string; badge: CustomBadge; kids: Kid[]; tiers: Record<string, number> }>(function BadgeAward({ id, badge, kids, tiers }, ref) {
  const award = useAwardBadge()
  const awardOnce = useSingle(award)
  const [kidId, setKidId] = useState<number | null>(null)
  const [note, setNote] = useState('')
  const [err, setErr] = useState('')
  const kid = kids.find((k) => k.id === kidId) ?? kids[0]
  if (!kid) return <p id={id} className="pk-hint">Add a kid first.</p>
  const who = nameOf(kid)
  const tier = tiers[String(kid.id)] ?? 0
  const maxed = tier >= 5
  const give = () => {
    setErr('')
    awardOnce(
      { id: badge.id, kid_id: kid.id, ...(note.trim() && { note: note.trim() }) },
      { onError: (e) => setErr(errorText(e)), onSuccess: (r) => (setNote(''), toastOk(`${badge.name}: ${tierLabel(r.tier)}`)) },
    )
  }
  return (
    <div id={id} ref={ref} role="region" aria-label={`Award ${badge.name}`} className="bd-award">
      <div className="pk-field">
        <span className="pk-label">Award to</span>
        <KidPicker kids={kids} value={[String(kid.id)]} onChange={(v) => setKidId(Number(v[0]))} label="Award to" single />
      </div>
      <div className="bd-line" data-testid="award-preview">
        <span>{`${who} ${maxed ? 'is at' : 'gets'}`}</span>
        <b>{maxed ? 'Mega-diamond' : tierLabel(tier + 1)}</b>
      </div>
      {maxed && <p className="pk-hint">Already Mega-diamond, the top tier.</p>}
      <label className="pk-field">
        <span className="pk-label">{`Note to ${who} (optional)`}</span>
        <input className="pk-input" value={note} maxLength={200} onChange={(e) => setNote(e.currentTarget.value)} />
      </label>
      {err && <span role="alert" className="pk-error">{err}</span>}
      <button type="button" className="p-btn rw-self-start" data-variant="accent" disabled={maxed || award.isPending} aria-busy={award.isPending} onClick={give}>
        <Icon name={award.isPending ? 'progress_activity' : 'emoji_events'} className={award.isPending ? 'pk-spin' : ''} />
        {`Award ${badge.name}`}
      </button>
    </div>
  )
})
