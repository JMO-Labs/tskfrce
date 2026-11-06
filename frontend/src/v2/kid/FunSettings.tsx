import { useState } from 'react'
import { useSetCelebrate } from '../hooks/useKid'
import type { CelebrateLevel } from '../types'
import { setSound, soundOn } from './celebrate/sound'
import type { KidAge } from './modes/types'

const LEVELS: [CelebrateLevel, string][] = [
  ['full', 'Full'],
  ['small', 'Small'],
  ['off', 'Off'],
]

function Switch({ label, on, onChange, disabled }: { label: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label className="me-fun-row">
      {label}
      <input type="checkbox" role="switch" className="me-sw" checked={on} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
    </label>
  )
}

/** Me tab: celebration level, sounds (this device), teen mascots, and the streak freezes saved. */
export function FunSettings({ level, mode, freezes }: { level: CelebrateLevel; mode: KidAge; freezes?: number }) {
  const save = useSetCelebrate()
  const [sound, setSnd] = useState(soundOn)
  return (
    <section className="me-fun" aria-label="Fun settings">
      <h2 className="k-disp">Fun</h2>
      <div className="me-fun-row" role="radiogroup" aria-label="Celebrations">
        <span>Celebrations</span>
        <span className="me-seg">
          {LEVELS.map(([v, label]) => (
            <label key={v}>
              <input type="radio" name="celebrate" aria-label={label} checked={level === v} onChange={() => save.mutate(v)} />
              {label}
            </label>
          ))}
        </span>
      </div>
      {/* a teen's mascots are Full; Small (the teen default) has none, so no new field is needed */}
      {mode === 'teen' && <Switch label="Mascots" on={level === 'full'} disabled={level === 'off'} onChange={(v) => save.mutate(v ? 'full' : 'small')} />}
      <Switch
        label="Sounds"
        on={sound}
        onChange={(v) => {
          setSound(v)
          setSnd(v)
        }}
      />
      {freezes != null && <p className="me-fun-note">{`🧊 ${freezes} ${freezes === 1 ? 'freeze' : 'freezes'} saved`}</p>}
    </section>
  )
}
