import { Icon } from '../parent/Icon'
import { AGE_LABEL } from '../manage/ageGroups'
import type { Kid } from '../types'
import styles from './stepCards.module.css'

interface Props {
  kids: Kid[]
  trust: number[]
  bedtime: boolean
  goals: boolean
  onTrust: (ids: number[]) => void
  onBedtime: (on: boolean) => void
  onGoals: (on: boolean) => void
  penalties: boolean
  onPenalties: (on: boolean) => void
}

const Sw = ({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) => (
  <span className="pk-switch ph-sw-row">
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick} />
  </span>
)

/** Step 8: trust, bedtime and penalties opt-ins (off) and the Goals switch (on). The bedtime time stays in family settings until it is on. */
export function StepExtras({ kids, trust, bedtime, goals, onTrust, onBedtime, onGoals, penalties, onPenalties }: Props) {
  const flip = (id: number) => onTrust(trust.includes(id) ? trust.filter((x) => x !== id) : [...trust, id])
  return (
    <>
      {kids.length > 0 && (
        <div className={styles.card}>
          <h3><Icon name="verified" size={18} />Trust mode</h3>
          <p style={{ fontSize: 14 }}>Chores approve themselves as a kid earns it, with random spot checks.</p>
          {kids.map((k) => {
            const name = k.full_name || k.username
            return (
              <div key={k.id} className={styles.kidrow}>
                <span className={styles.av} aria-hidden="true">{name[0]}</span>
                <div className={styles.t2}>
                  {name}
                  <small>{AGE_LABEL[k.age_group]}</small>
                </div>
                <Sw on={trust.includes(k.id)} label={`Trust mode for ${name}`} onClick={() => flip(k.id)} />
              </div>
            )
          })}
        </div>
      )}
      <div className={styles.card}>
        <div className={styles.kidrow} style={{ padding: 0 }}>
          <div className={styles.t2}>
            <h3 style={{ margin: '0 0 4px' }}><Icon name="bedtime" size={18} />Bedtime auto-approve</h3>
            <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--p-sub)' }}>At 9:00 PM, chores still waiting for your OK approve themselves.</span>
          </div>
          <Sw on={bedtime} label="Bedtime auto-approve" onClick={() => onBedtime(!bedtime)} />
        </div>
      </div>
      <div className={styles.card}>
        <div className={styles.kidrow} style={{ padding: 0 }}>
          <div className={styles.t2}>
            <h3 style={{ margin: '0 0 4px' }}><Icon name="flag" size={18} />Goals</h3>
            <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--p-sub)' }}>Kids can save points toward something big. You set the price.</span>
          </div>
          <Sw on={goals} label="Goals" onClick={() => onGoals(!goals)} />
        </div>
      </div>
      <div className={styles.card}>
        <div className={styles.kidrow} style={{ padding: 0 }}>
          <div className={styles.t2}>
            <h3 style={{ margin: '0 0 4px' }}><Icon name="gavel" size={18} />Penalties</h3>
            <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--p-sub)' }}>Take something away, say why, and let them earn part back.</span>
          </div>
          <Sw on={penalties} label="Penalties" onClick={() => onPenalties(!penalties)} />
        </div>
      </div>
    </>
  )
}
