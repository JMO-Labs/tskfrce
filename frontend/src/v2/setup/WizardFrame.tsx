import type { ReactNode } from 'react'
import { Fragment, useState } from 'react'
import { Button } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { useLook } from '../parent/useLook'
import styles from './wizard.module.css'

const STEPS = [
  { num: 1, title: 'Welcome' },
  { num: 2, title: 'Family' },
  { num: 3, title: 'Kids' },
  { num: 4, title: "Kids' phones", short: 'Phones', opt: true },
  { num: 5, title: 'Chores' },
  { num: 6, title: 'Devices' },
  { num: 7, title: 'Hours' },
  { num: 8, title: 'Optional extras', short: 'Extras', opt: true },
]

interface Props {
  step: number // 1-based
  children: ReactNode
  title?: string
  subtitle?: string
  onBack?: () => void
  onNext: () => void
  nextLabel?: string
  onSkip?: () => void
  onStepClick?: (step: number) => void
  busy?: boolean
  /** small count shown in the button row, left of Next (e.g. "4 picked") */
  note?: string
  /** the finished screen: accent icon tile above the title, and no Back/Next row (its own buttons lead on) */
  done?: boolean
}

export function WizardFrame({
  step, children, title, subtitle, onBack, onNext, nextLabel = 'Next', onSkip, onStepClick, busy, done, note
}: Props) {
  useLook('parent')
  const phone = useMediaQuery('(max-width: 767px)') // phone: dots and ticks, plus the current label only
  const [maxStepReached, setMaxStepReached] = useState(step)

  if (step > maxStepReached) setMaxStepReached(step) // adjust during render, not in an effect

  return (
    <div className={styles.page}>
      {/* top bar: wordmark and the 8 steps (mockup declutter-v2 .wiz) */}
      <header className={styles.wiz}>
        <div className={styles.wm}>
          <i>@</i>
          <span>t@sk4ce setup</span>
        </div>
        <div className={styles.steps} role="group" aria-label={step > STEPS.length ? 'All steps done' : `Step ${step} of ${STEPS.length}: ${STEPS[step - 1].title}`}>
          {STEPS.map((s, i) => {
            const isDone = i + 1 < step
            const isActive = i + 1 === step
            const canOpen = i + 1 <= Math.min(maxStepReached, step + 1) // the page only goes back or one ahead
            return (
              <Fragment key={s.num}>
                {i > 0 && <span className={styles.ln} aria-hidden="true" />}
                <div
                  data-step={s.num}
                  className={`${styles.st} ${isDone ? styles.done : ''} ${isActive ? styles.on : ''}`}
                  onClick={() => canOpen && onStepClick?.(i + 1)}
                  onKeyDown={(e) => {
                    if (canOpen && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      onStepClick?.(i + 1)
                    }
                  }}
                  role={canOpen ? 'button' : undefined}
                  tabIndex={canOpen ? 0 : -1}
                  aria-current={isActive ? 'step' : undefined}
                  aria-label={phone && !isActive ? `Step ${s.num}: ${s.title}` : undefined}
                >
                  <span className={styles.dot}>{isDone ? <span className="ms" aria-hidden="true">check</span> : s.num}</span>
                  {(!phone || isActive) && <div>{s.short ?? s.title}</div>}
                </div>
              </Fragment>
            )
          })}
        </div>
      </header>

      <main className={styles.wizard}>
      <form
        className={styles.main}
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          if (!busy) onNext()
        }}
      >
        <div className={styles.body}>
          <div className={styles.wrap}>
            {title && (
              <>
                {step <= STEPS.length && <div className={styles.eyebrow}>Step {step} of {STEPS.length}{STEPS[step - 1]?.opt ? ' · optional' : ''}</div>}
                {done && (
                  <div className={styles.tile} aria-hidden="true">
                    <span className="ms">celebration</span>
                  </div>
                )}
                <h1>{title}</h1>
                {subtitle && <div className={styles.s}>{subtitle}</div>}
              </>
            )}
            {children}
          </div>
        </div>
        {!done && (
          <div className={styles.foot}>
            <div className={styles.footIn}>
              {onBack ? (
                <Button variant="default" onClick={onBack} leftSection={<span className="ms" aria-hidden="true">arrow_back</span>}>
                  Back
                </Button>
              ) : null}
              <span className={styles.grow} />
              {note && <span className={styles.picked}>{note}</span>}
              {onSkip && (
                <Button variant="subtle" className={styles.skip} onClick={onSkip}>
                  Skip
                </Button>
              )}
              <Button type="submit" variant="filled" loading={busy} rightSection={<span className="ms" aria-hidden="true">{nextLabel === 'Finish' ? 'check' : 'arrow_forward'}</span>}>
                {nextLabel}
              </Button>
            </div>
          </div>
        )}
      </form>
      </main>
    </div>
  )
}
