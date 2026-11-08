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

/** Confirm before leaving a dirty form: in-app links (guard), tab close and browser Back. */
export function useDiscardGuard(dirty: boolean): { guard: (go: () => void) => void; sheet: ReactNode } {
  const router = useRouter()
  const [pending, setPending] = useState<(() => void) | null>(null)
  const guard = useCallback((go: () => void) => { if (dirty) setPending(() => go); else go() }, [dirty])
  const routerRef = useRef(router)
  routerRef.current = router // eslint-disable-line react-hooks/refs -- latest router for the Back handler

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    routerRef.current.beforePopState(() => {
      // stay on the page: put the entry Back just popped back, then ask
      const r = routerRef.current
      void r.push(r.asPath, undefined, { shallow: true, scroll: false })
      setPending(() => () => routerRef.current.back())
      return false
    })
    return () => { window.removeEventListener('beforeunload', warn); routerRef.current.beforePopState(() => true) }
  }, [dirty])

  const sheet = (
    <ConfirmDelete opened={!!pending} title="Discard changes?" body="What you changed here won't be saved." confirmLabel="Discard"
      onConfirm={() => { pending?.() }} onClose={() => setPending(null)} />
  )
  return { guard, sheet }
}
