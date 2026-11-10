import { AGE_LABEL } from '../manage/ageGroups'
import { LimitsTable } from '../presets/LimitsTable'
import { StylePicker } from '../presets/StylePicker'
import { StyleSeg } from '../presets/StyleSeg'
import type { Style } from '../presets/types'
import { usePresets } from '../presets/usePresets'
import type { Kid } from '../types'
import { presetKids } from './setupJobs'
import styles from './stepCards.module.css'

interface Props {
  kids: Kid[]
  style: Style
  onStyle: (s: Style) => void
  /** per-kid styles when "Different for each kid" is on, else null */
  styles: Record<number, Style> | null
  onStyles: (s: Record<number, Style> | null) => void
}

/** Setup step 4 (mockup presets-v2): one family pick, optionally one per kid. */
export function StepStyle({ kids, style, onStyle, styles: perKid, onStyles }: Props) {
  const catalog = usePresets().data
  const listed = presetKids(kids, perKid, style)
  return (
    <>
      <StylePicker value={style} onChange={onStyle} />
      {kids.length >= 2 && (
        <div className={styles.card} style={{ padding: '8px 12px', marginTop: 4 }}>
          <div className={styles.kidrow} style={{ padding: 0 }}>
            <div className={styles.t2} id="setup-different">Different for each kid</div>
            <span className="pk-switch ph-sw-row">
              <button
                type="button"
                role="switch"
                aria-checked={perKid !== null}
                aria-labelledby="setup-different"
                onClick={() => onStyles(perKid ? null : Object.fromEntries(kids.map((k) => [k.id, style])))}
              />
            </span>
          </div>
          {perKid &&
            kids.map((k, i) => {
              const name = listed[i].name
              return (
                <div key={k.id} style={{ marginTop: 10 }}>
                  <div className={styles.kidrow} style={{ padding: '0 0 6px' }}>
                    <span className={styles.av} aria-hidden="true">{name[0]}</span>
                    <div className={styles.t2}>
                      {name}
                      <small>{AGE_LABEL[k.age_group]}</small>
                    </div>
                  </div>
                  <StyleSeg value={perKid[k.id] ?? style} label={`Style for ${name}`} onChange={(s) => onStyles({ ...perKid, [k.id]: s })} />
                </div>
              )
            })}
        </div>
      )}
      {catalog && <LimitsTable catalog={catalog} kids={listed} style={style} />}
    </>
  )
}
