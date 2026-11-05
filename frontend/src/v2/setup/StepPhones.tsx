import { useState } from 'react'
import { Button } from '@mantine/core'
import { EnrollQr } from '../components/EnrollQr'
import { useEnrollCode } from '../hooks/useEnroll'
import { nameOf } from '../manage/choreMeta'
import { Icon } from '../parent/Icon'
import type { Kid } from '../types'
import type { EnrollCode } from '../types/enroll'
import styles from './stepCards.module.css'

function PhoneRow({ kid }: { kid: Kid }) {
  const enroll = useEnrollCode()
  const [code, setCode] = useState<EnrollCode>() // kept across "New code" so the QR doesn't jump
  const name = nameOf(kid)
  const make = () => enroll.mutate(kid.id, { onSuccess: setCode })
  return (
    <div className={styles.kidrow} style={{ flexWrap: 'wrap', rowGap: 12 }}>
      <span className={styles.av} aria-hidden="true">{kid.avatar || name.charAt(0).toUpperCase()}</span>
      <div className={styles.t2}>{name}</div>
      {!code && (
        <Button variant="default" loading={enroll.isPending} onClick={make} aria-label={`Show code for ${name}`}>
          Show code
        </Button>
      )}
      {enroll.error && <p role="alert" style={{ flexBasis: '100%', margin: 0 }}>Couldn&apos;t make a code. {enroll.error.message}</p>}
      {code && (
        <div style={{ flexBasis: '100%' }}>
          <EnrollQr kid={kid} code={code} busy={enroll.isPending} onNew={make} />
        </div>
      )}
    </div>
  )
}

/** Step 4 (optional): one tap per kid shows their phone sign-in code. */
export function StepPhones({ kids }: { kids: Kid[] }) {
  if (kids.length === 0)
    return (
      <div className={styles.tip}>
        <Icon name="info" size={20} />
        <div>Add a kid first, or skip this step.</div>
      </div>
    )
  return (
    <div className={`${styles.card} ${styles.rows}`}>
      {kids.map((k) => <PhoneRow key={k.id} kid={k} />)}
    </div>
  )
}
