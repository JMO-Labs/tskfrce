import { useState, useRef, useEffect } from 'react'
import { ActionButton } from './ActionButton'
import type { OverrideTarget } from '../hooks/useOverride'

export interface HomeworkButtonProps {
  target: OverrideTarget
  disabled?: boolean
  busy?: boolean
  onStart: (minutes: number) => void
}

const DURATIONS = [
  { label: '30 min', value: 30 },
  { label: '60 min', value: 60 },
  { label: '90 min', value: 90 },
  { label: '120 min', value: 120 },
]

export function HomeworkButton({ target, disabled = false, busy = false, onStart }: HomeworkButtonProps) {
  const [opened, setOpened] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpened(false)
      }
    }

    if (opened) {
      document.addEventListener('mousedown', handleClickOutside)
      return () => document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [opened])

  return (
    <div style={{ display: 'inline-block' }}>
      <div ref={containerRef} style={{ position: 'relative', display: 'inline-block' }}>
        <ActionButton
          icon="menu_book"
          label="Homework mode"
          disabled={disabled || busy}
          busy={busy}
          onClick={() => setOpened(!opened)}
        >
          Homework mode
        </ActionButton>
        {opened && (
          <div role="menu" style={{ position: 'absolute', top: '100%', right: 0, background: 'white', border: '1px solid #ccc', borderRadius: '4px', minWidth: '100px', zIndex: 1000 }}>
            {DURATIONS.map(({ label, value }) => (
              <button
                key={value}
                role="menuitem"
                type="button"
                style={{ display: 'block', width: '100%', padding: '8px 12px', textAlign: 'left', border: 'none', background: 'none', cursor: 'pointer' }}
                onClick={() => {
                  onStart(value)
                  setOpened(false)
                }}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      <p style={{ fontSize: '0.875em', color: '#666', margin: '4px 0 0 0', lineHeight: 1.4 }}>
        Homework sites stay on. It may take up to a minute to start.
      </p>
    </div>
  )
}
