import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { Drawer, Rating, useComputedColorScheme } from '@mantine/core'
import { useMediaQuery } from '@mantine/hooks'
import { api } from '@/v2/api'
import { toastFail, toastOk } from '@/v2/notify'
import { Icon } from '@/v2/parent/Icon'
import { SegmentedControl } from '@/v2/parent/SegmentedControl'
import { recentErrors } from './errors'
import { closeFeedback, openFeedback, useFeedbackOpen } from './feedbackStore'
import { captureScreen, FeedbackShots, type Shot } from './FeedbackShots'
import { useFormAbandon } from './useFormAbandon'
import { routePattern } from './useScreenViews'

type Kind = 'feature' | 'bug' | 'other'
const KINDS: { value: Kind; label: string }[] = [
  { value: 'feature', label: 'Feature idea' },
  { value: 'bug', label: 'Bug' },
  { value: 'other', label: 'Other' },
]
const MAX_TEXT = 2000

// Mantine's light-mode stars (gray-3 empty, accent full) vanish on the white sheet; dark keeps Mantine's look.
const star = (fill: string, stroke: string) => (
  <svg viewBox="0 0 24 24" width={28} height={28} strokeWidth={1.5} strokeLinejoin="round" style={{ display: 'block', fill, stroke }}>
    <path d="M12 17.75l-6.172 3.245l1.179 -6.873l-5 -4.867l6.9 -1l3.086 -6.253l3.086 6.253l6.9 1l-5 4.867l1.179 6.873z" />
  </svg>
)
const LIGHT_STARS = { emptySymbol: star('var(--p-soft)', 'var(--p-sub)'), fullSymbol: star('var(--p-meter)', 'var(--p-meter)') }

/** Parent feedback over the current page, so "Capture this screen" captures that page (Decision 12). */
export function FeedbackDrawer() {
  const opened = useFeedbackOpen()
  const router = useRouter()
  const small = useMediaQuery('(max-width: 767px)')
  const light = useComputedColorScheme('light', { getInitialValueInEffect: true }) === 'light'
  const [type, setType] = useState<Kind>('feature')
  const [stars, setStars] = useState(0)
  const [text, setText] = useState('')
  const [shots, setShots] = useState<Shot[]>([])
  const [route, setRoute] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const saved = useFormAbandon('feedback', text.trim() !== '')

  useEffect(() => {
    if (opened) setRoute(routePattern(router.pathname))
  }, [opened, router.pathname])

  const reset = () => {
    shots.forEach((s) => URL.revokeObjectURL(s.url))
    setType('feature')
    setStars(0)
    setText('')
    setShots([])
    setError('')
  }
  const cancel = () => {
    reset()
    closeFeedback()
  }

  const capture = async () => {
    closeFeedback()
    await new Promise((r) => setTimeout(r, 400))
    try {
      return await captureScreen()
    } finally {
      openFeedback()
    }
  }

  const send = async () => {
    if (!text.trim()) return setError('Write a short note first.')
    const form = new FormData()
    form.append('type', type)
    if (stars) form.append('stars', String(stars))
    form.append('text', text.trim())
    form.append('route', route)
    if (type === 'bug') form.append('errors', recentErrors().join(','))
    shots.forEach((s, i) => form.append('shots', s.blob, `shot-${i + 1}.jpg`))
    setBusy(true)
    try {
      await api('/eval/feedback', { method: 'POST', body: form })
      toastOk('Sent')
      saved()
      reset()
      closeFeedback()
    } catch (e) {
      toastFail(e)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Drawer
      opened={opened}
      onClose={cancel}
      position="right"
      size={small ? '100%' : 420}
      title="Send feedback"
      keepMounted // the form survives the brief close while the screen is captured
      closeButtonProps={{ 'aria-label': 'Close' }}
      zIndex={350}
      classNames={{ content: 'pk-sheet', header: 'pk-sheet-head', title: 'pk-sheet-title', body: 'pk-sheet-body' }}
    >
      <div className="pk-form">
        <div className="pk-field">
          <span className="pk-label">What kind of feedback?</span>
          <div className="pk-seg">
            <SegmentedControl label="Feedback type" options={KINDS} value={type} onChange={setType} />
          </div>
        </div>
        <div className="pk-field" role="group" aria-labelledby="fb-stars">
          <span className="pk-label" id="fb-stars">
            How&apos;s it going? (optional)
          </span>
          <Rating value={stars} onChange={setStars} size="lg" color="var(--p-acc)" {...(light ? LIGHT_STARS : {})} />
        </div>
        <div className="pk-field">
          <label className="pk-label" htmlFor="fb-text">
            What&apos;s on your mind?
          </label>
          <textarea
            id="fb-text"
            className="pk-input"
            rows={5}
            required
            maxLength={MAX_TEXT}
            value={text}
            onChange={(e) => {
              setText(e.currentTarget.value)
              setError('')
            }}
            style={{ resize: 'vertical' }}
          />
          <span className="pk-hint" style={{ textAlign: 'right' }}>
            {text.length.toLocaleString('en-US')} / 2,000
          </span>
          {error && (
            <span className="pk-error" role="alert">
              {error}
            </span>
          )}
        </div>
        <FeedbackShots shots={shots} onChange={setShots} onCapture={capture} />
        <div className="pk-foot pk-sheet-foot">
          <button type="button" className="p-btn" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="p-btn" data-variant="accent" onClick={send} disabled={busy} aria-busy={busy}>
            <Icon name="send" />
            Send
          </button>
        </div>
      </div>
    </Drawer>
  )
}
