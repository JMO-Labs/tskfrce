/** Before a round: tap a held power-up to arm it (max one, default none), then go. */
import { useState } from 'react'
import { PowerSlots } from './PowerSlots'
import s from './games.module.css'
import type { PowerUp } from './types'

export function PowerUpPick({ held, onGo }: { held: PowerUp[]; onGo: (armed: string | null) => void }) {
  const [armed, setArmed] = useState<string | null>(null)
  return (
    <div className={s.root}>
      <h2 className={s.h}>Use a power-up?</h2>
      <p className={s.hint}>Tap one to use it this round. Or just play!</p>
      <PowerSlots held={held} armed={armed} onArm={(k) => setArmed((a) => (a === k ? null : k))} />
      <button type="button" className={`${s.kb} ${s.sun} ${s.wide}`} onClick={() => onGo(armed)}>{armed ? 'Go!' : 'Go without'}</button>
    </div>
  )
}
