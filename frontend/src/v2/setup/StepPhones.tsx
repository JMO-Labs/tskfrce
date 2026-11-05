import { Button } from '@mantine/core'
import { EnrollQr } from '../components/EnrollQr'
import { useEnrollCode } from '../hooks/useEnroll'
import { nameOf } from '../manage/choreMeta'
import type { Kid } from '../types'
import styles from './stepCards.module.css'

function PhoneRow({ kid }: { kid: Kid }) {
  const enroll = useEnrollCode()
  const name = nameOf(kid)
  const make = () => enroll.mutate(kid.id)
  return (
    <div className={styles.kidrow} style={{ flexWrap: 'wrap' }}>
      <span className={styles.av} aria-hidden="true">{kid.avatar || name.charAt(0).toUpperCase()}</span>
      <div className={styles.t2}>{name}</div>
      {!enroll.data && (
        <Button variant="default" loading={enroll.isPending} onClick={make} aria-label={`Show code for ${name}`}>
          Show code
        </Button>
      )}
      {enroll.error && <p role="alert" style={{ flexBasis: '100%', margin: 0 }}>Couldn&apos;t make a code. {enroll.error.message}</p>}
      {enroll.data && (
        <div style={{ flexBasis: '100%' }}>
          <EnrollQr kid={kid} code={enroll.data} busy={enroll.isPending} onNew={make} />
        </div>
      )}
    </div>
  )
}

/** Step 4 (optional): one tap per kid shows their phone sign-in code. */
export function StepPhones({ kids }: { kids: Kid[] }) {
  if (kids.length === 0) return <p>Add a kid first, or skip this step.</p>
  return (
    <div className={`${styles.card} ${styles.rows}`}>
      {kids.map((k) => <PhoneRow key={k.id} kid={k} />)}
    </div>
  )
}
