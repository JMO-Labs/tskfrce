import { Button } from '@mantine/core'
import { clock, minutes, STYLE_LABEL } from '../presets/format'
import { planFor } from './setupJobs'
import type { PresetCatalog, PresetKid, Style } from '../presets/types'
import { usePresets } from '../presets/usePresets'
import ps from '../presets/presets.module.css'
import styles from './stepCards.module.css'

interface Props {
  /** a null style follows `style` */
  kids: PresetKid[]
  style: Style
  onTweak: (catalog: PresetCatalog) => void
  busy?: boolean
}

/** Setup step 5 (mockup presets-v2): what the pick sets for each kid. Looks good submits the wizard form. */
export function StepPlan({ kids, style, onTweak, busy }: Props) {
  const catalog = usePresets().data
  if (kids.length === 0) return <p>{`No kids yet. Your family settings follow ${STYLE_LABEL[style]}.`}</p>
  return (
    <>
      {catalog &&
        kids.map((k) => {
          const p = planFor(catalog, k, style)
          return (
            <div key={k.id} style={{ marginBottom: 12 }}>
              <div className={ps.kid}>
                <span className={ps.av} aria-hidden="true">{k.name[0]}</span>
                {`${k.name} · ${STYLE_LABEL[k.style ?? style]}`}
              </div>
              <div className={styles.card}>
                <div className={styles.li}>
                  <span>Chores</span>
                  <span>{p.chores.join(', ')}</span>
                </div>
                <div className={styles.li}>
                  <span>Screen time</span>
                  <span>{`${minutes(p.screen)} · bed ${clock(p.bedtime)}`}</span>
                </div>
              </div>
            </div>
          )
        })}
      <Button type="submit" variant="filled" fullWidth loading={busy} mt={14}>Looks good</Button>
      <Button variant="default" fullWidth mt={8} disabled={!catalog} onClick={() => catalog && onTweak(catalog)}>Tweak</Button>
    </>
  )
}
