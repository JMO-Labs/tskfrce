import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useRouter } from 'next/router'
import { ConfirmDelete } from '@/v2/manage/ConfirmDelete'
import { Icon } from './Icon'

/** Sticky "Unsaved changes" bar for multi-field forms. Renders nothing until something changed. */
export function SaveBar({ dirty, saving, onSave, onCancel, saveLabel = 'Save', disabled, note }: {
  dirty: boolean; saving: boolean; onSave: () => void; onCancel: () => void; saveLabel?: string; disabled?: boolean; note?: ReactNode
}) {
  if (!dirty) return null
  return (
    <div className="p-savebar" role="region" aria-label="Unsaved changes">
      <span className="p-savebar-note">{note ?? 'Unsaved changes'}</span>
      <button type="button" className="p-btn" onClick={onCancel}>Cancel</button>
      <button type="button" className="p-btn" data-variant="accent" onClick={onSave} disabled={disabled} aria-busy={saving} data-loading={saving || undefined}>
        <Icon name="check" size={16} />{saveLabel}
      </button>
    </div>
  )
}

type PopHandler = () => boolean
const guards: PopHandler[] = [] // active dirty guards; the newest decides browser Back

/** Confirm before leaving a dirty form: in-app links (guard), tab close and browser Back. */
export function useDiscardGuard(dirty: boolean): { guard: (go: () => void) => void; sheet: ReactNode } {
  const router = useRouter()
  const [pending, setPending] = useState<(() => void) | null>(null)
  const guard = useCallback((go: () => void) => { if (dirty) setPending(() => go); else go() }, [dirty])
  const routerRef = useRef(router)
  const leaving = useRef(false) // Discard on the Back sheet: let the popstate through
  useEffect(() => { routerRef.current = router })

  useEffect(() => {
    if (!dirty) return
    const r = () => routerRef.current
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    const onBack: PopHandler = () => {
      if (leaving.current) return true
      // stay on the page: put the entry Back just popped back, then ask
      void r().push(r().asPath, undefined, { shallow: true, scroll: false })
      setPending(() => () => { leaving.current = true; r().back() })
      return false
    }
    window.addEventListener('beforeunload', warn)
    guards.push(onBack)
    r().beforePopState(onBack)
    return () => {
      window.removeEventListener('beforeunload', warn)
      guards.splice(guards.indexOf(onBack), 1)
      r().beforePopState(guards[guards.length - 1] ?? (() => true))
      leaving.current = false
    }
  }, [dirty])

  const sheet = (
    <ConfirmDelete opened={!!pending} title="Discard changes?" body="What you changed here won't be saved." confirmLabel="Discard"
      onConfirm={() => { pending?.() }} onClose={() => setPending(null)} />
  )
  return { guard, sheet }
}
