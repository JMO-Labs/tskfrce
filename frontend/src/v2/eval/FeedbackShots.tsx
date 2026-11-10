import { useEffect, useRef, useState } from 'react'
import { Icon } from '@/v2/parent/Icon'

export type Shot = { blob: Blob; url: string }

const MAX = 3
const MAX_BYTES = 3 * 1024 * 1024

/** JPEG of the page as it looks now (Decision 15). Imported lazily so SSR never loads it. */
export async function captureScreen(): Promise<Blob> {
  const { toJpeg } = await import('html-to-image')
  const dataUrl = await toJpeg(document.body, { quality: 0.7, pixelRatio: 1 })
  return fetch(dataUrl).then((r) => r.blob())
}

interface Props {
  shots: Shot[]
  onChange: (shots: Shot[]) => void
  onCapture: () => Promise<Blob>
}

export function FeedbackShots({ shots, onChange, onCapture }: Props) {
  const [error, setError] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const latest = useRef(shots)
  useEffect(() => {
    latest.current = shots
  }, [shots])
  const full = shots.length >= MAX

  useEffect(() => () => latest.current.forEach((s) => URL.revokeObjectURL(s.url)), [])

  const add = (blob: Blob) => {
    setError('')
    onChange([...latest.current, { blob, url: URL.createObjectURL(blob) }])
  }
  const capture = () =>
    onCapture().then(add, () => setError("Couldn't capture the screen. Add a picture instead."))
  const pick = (file?: File) => {
    if (!file) return
    if (file.size > MAX_BYTES) setError('That picture is too big. Pick one under 3 MB.')
    else add(file)
  }
  const remove = (i: number) => {
    URL.revokeObjectURL(shots[i].url)
    onChange(shots.filter((_, j) => j !== i))
  }

  return (
    <div className="pk-field">
      <span className="pk-label">Screenshots (optional)</span>
      <div className="pk-actions">
        <button type="button" className="p-btn" onClick={capture} disabled={full}>
          <Icon name="photo_camera" />
          Capture this screen
        </button>
        <button type="button" className="p-btn" onClick={() => input.current?.click()} disabled={full}>
          <Icon name="add_photo_alternate" />
          Add a picture
        </button>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-label="Add a picture"
          hidden
          disabled={full}
          onChange={(e) => {
            pick(e.currentTarget.files?.[0])
            e.currentTarget.value = ''
          }}
        />
      </div>
      {shots.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {shots.map((s, i) => (
            <div key={s.url} style={{ position: 'relative' }}>
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              <img
                src={s.url}
                alt={`Screenshot ${i + 1}`}
                style={{ width: 96, height: 72, objectFit: 'cover', borderRadius: 10, border: '1px solid var(--p-line)', display: 'block' }}
              />
              <button
                type="button"
                className="pk-ib"
                aria-label={`Remove screenshot ${i + 1}`}
                title="Remove"
                onClick={() => remove(i)}
                style={{ position: 'absolute', top: 2, right: 2, width: 26, height: 26, background: 'var(--p-card)' }}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
      <span className="pk-hint">Screenshots may show names. Remove any you don&apos;t want to send.</span>
      {error && (
        <span className="pk-error" role="alert">
          {error}
        </span>
      )}
    </div>
  )
}
