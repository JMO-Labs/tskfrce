import { useRouter } from 'next/router'
import { Button } from '@mantine/core'
import styles from './wizard.module.css'
import { wallTime } from '../manage/choreMeta'
import { InstallHint } from '../components/InstallHint'

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

/** "3 kids, 4 chores, 4 devices, 2 schedules." (mockup 07 finish subtitle) */
export const finishSummary = (kids: number, chores: number, devices: number, schedules: number) =>
  `${n(kids, 'kid', 'kids')}, ${n(chores, 'chore', 'chores')}, ${n(devices, 'device', 'devices')}, ${n(schedules, 'schedule', 'schedules')}.`

const REMOTE_DOC = 'https://github.com/JMO-Labs/tskfrce/blob/main/docs/remote-access.md'

/** The two ways out of the wizard; the summary and tile live in the frame (done). */
export function StepFinish({ resetTime }: { resetTime?: string }) {
  const router = useRouter()
  return (
    <>
    <p style={{ marginTop: 14 }}>
      Hours start now. Chores, and the chore lock, start tomorrow{resetTime ? ` at ${wallTime(resetTime)}` : ''}.
    </p>
    <InstallHint who="parent" />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: 14 }}>
      <Button variant="filled" leftSection={<span className="ms" aria-hidden="true">home</span>} onClick={() => router.push('/')}>Go to Today</Button>
      <Button
        variant="default"
        leftSection={<span className="ms" aria-hidden="true">notifications</span>}
        onClick={() => router.push('/settings?section=notifications')}
      >
        Set up notifications
      </Button>
    </div>
    <p className={styles.tip}>
      Want to approve chores away from home? Set up Tailscale. Takes 5 minutes.{' '}
      <a href={REMOTE_DOC} target="_blank" rel="noreferrer">Later</a>
    </p>
    </>
  )
}
