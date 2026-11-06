import { useEffect, useState, type ReactNode } from 'react'
import { useFamily, usePatchFamily } from '@/v2/hooks/useFamily'
import { useHappyHours } from '@/v2/hooks/useHappyHour'
import { useKids, usePatchKid } from '@/v2/hooks/useKids'
import { useToday } from '@/v2/hooks/useToday'
import { useDismissTip, useTips } from '@/v2/hooks/useTips'
import { CelebratePreview } from '@/v2/manage/CelebratePreview'
import { toastFail } from '../notify'
import { HappyHourButton } from './HappyHourButton'
import { TRY_ORDER, nudgeKey, nudgeSnoozed, pickCard, snoozeNudge, writeShown } from './tryCards'
import styles from '../components/QuickTip.module.css'

const TEXT: Record<(typeof TRY_ORDER)[number], { icon: string; text: string }> = {
  'try.celebrate': { icon: 'celebration', text: 'Kids now get a comic-book cheer when they finish a chore.' },
  'try.happyhour': { icon: 'bolt', text: 'Double points for an hour gets chores moving.' },
  'try.autoboost': { icon: 'auto_awesome', text: 'If a kid goes quiet for 2 days, we start a Happy Hour for them and let you know.' },
  'try.streakfreeze': { icon: 'ac_unit', text: 'Kids earn a freeze every 7 days in a row, so one missed day doesn\'t break their streak.' },
}

/** One "Try this" card at a time (Today). Dismissals are per parent (tips API); pacing is per device. */
export function TryCards() {
  const tips = useTips().data
  const fam = useFamily().data
  const kids = useKids().data
  const hh = useHappyHours().data
  const today = useToday().data
  const dismiss = useDismissTip()
  const patchFam = usePatchFamily()
  const patchKid = usePatchKid()
  const [, bump] = useState(0) // re-pick after a local "Not now"

  const quietKid = !fam?.hh_auto_boost ? today?.kids.find((k) => k.quiet && !nudgeSnoozed(k.id)) : undefined
  const ready = !!(tips && fam && kids && hh && today)
  const seen = new Set(tips?.dismissed)
  const on: Record<string, boolean> = {
    'try.celebrate': !!kids?.some((k) => k.celebrate !== 'off'),
    'try.happyhour': !hh?.active.length,
    'try.autoboost': !!fam?.hh_auto_boost,
    'try.streakfreeze': !!fam?.streak_freeze,
  }
  const eligible = ready ? [...TRY_ORDER.filter((k) => on[k] && !seen.has(k)), ...(quietKid ? [nudgeKey(quietKid.id)] : [])] : []
  const key = ready ? pickCard(eligible) : null
  useEffect(() => {
    if (key) writeShown(key)
  }, [key])
  if (!key) return null

  const done = () => dismiss.mutate(key)
  const off = (turnOff: () => void) => () => (turnOff(), done())
  const setFam = (body: { hh_auto_boost?: boolean; streak_freeze?: boolean }) => patchFam.mutate(body, { onError: toastFail })
  const gotIt = <Btn onClick={done}>Got it</Btn>
  let icon: string, text: string, actions: ReactNode
  if (key === 'try.celebrate') {
    ;({ icon, text } = TEXT[key])
    actions = (
      <>
        <CelebratePreview mode={kids?.[0]?.age_group ?? 'kid'} level="full" label="Preview" />
        <Btn onClick={off(() => kids?.forEach((k) => patchKid.mutate({ id: k.id, body: { celebrate: 'off' } }, { onError: toastFail })))}>Turn off for all kids</Btn>
        {gotIt}
      </>
    )
  } else if (key === 'try.happyhour') {
    ;({ icon, text } = TEXT[key])
    actions = (
      <>
        <HappyHourButton allKids label="Start one now" />
        {gotIt}
      </>
    )
  } else if (key === 'try.autoboost' || key === 'try.streakfreeze') {
    ;({ icon, text } = TEXT[key])
    const body = key === 'try.autoboost' ? { hh_auto_boost: false } : { streak_freeze: false }
    actions = (
      <>
        <Btn onClick={off(() => setFam(body))}>Turn off</Btn>
        {gotIt}
      </>
    )
  } else {
    const k = quietKid!
    icon = 'bolt'
    text = `${k.name} has had a quiet couple of days. Start a Happy Hour?`
    actions = (
      <>
        <HappyHourButton kidId={k.id} label={`Start for ${k.name}`} />
        <Btn onClick={() => (snoozeNudge(k.id), bump((n) => n + 1))}>Not now</Btn>
      </>
    )
  }
  return (
    <section className={`${styles.tip} ${styles.parentMode}`} style={{ flexWrap: 'wrap', marginBottom: 16 }} aria-label="Try this">
      <span className={styles.icon} aria-hidden="true">
        <span className="material-symbols-rounded">{icon}</span>
      </span>
      <span className={styles.text} style={{ flexBasis: 240 }}>{text}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{actions}</div>
    </section>
  )
}

const Btn = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button type="button" className="p-btn" onClick={onClick}>
    {children}
  </button>
)
