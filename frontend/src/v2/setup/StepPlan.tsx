import { Button } from '@mantine/core'
import { clock, minutes, STYLE_LABEL } from '../presets/format'
import { planFor } from './setupJobs'
import type { PresetCatalog, PresetKid, Style } from '../presets/types'
import { usePresets } from '../presets/usePresets'
import styles from './stepCards.module.css'

interface Props {
  /** a null style follows `style` */
  kids: PresetKid[]
  style: Style
  onTweak: (catalog: PresetCatalog) => void
}

/** Setup step 5 (mockup presets-v2): what the pick sets for each kid. Looks good is the frame's Next. */
export function StepPlan({ kids, style, onTweak }: Props) {
  const catalog = usePresets().data
  if (kids.length === 0) return <p>{`No kids yet. Your family settings follow ${STYLE_LABEL[style]}.`}</p>
  return (
    <>
      {catalog &&
        kids.map((k) => {
          const p = planFor(catalog, k, style)
          return (
            <div key={k.id} style={{ marginBottom: 12 }}>
              <div className={styles.kidrow} style={{ padding: '0 0 6px' }}>
                <span className={styles.av} aria-hidden="true">{k.name[0]}</span>
                <div className={styles.t2}>{`${k.name} · ${STYLE_LABEL[k.style ?? style]}`}</div>
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
      <Button variant="default" fullWidth disabled={!catalog} onClick={() => catalog && onTweak(catalog)}>Tweak</Button>
    </>
  )
}
