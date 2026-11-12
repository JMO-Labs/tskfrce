import Link from 'next/link'
import { useEffect, useRef, type ReactNode } from 'react'
import { Icon } from '../parent/Icon'
import { InfoPop } from '../parent/InfoPop'
import type { Focus } from '../parent/useFocusParam'
import type { TodayKid } from '../types'
import { KidDay, LockPill } from './KidDay'
import { KidFacts } from './KidFacts'
import { KidAv } from '@/v2/KidAv'

/**
 * Kid card on Today: avatar (details pop-over) and a row button that focuses the kid.
 * `children` is the focused body, shown only while this kid is the open `kid` focus.
 */
export function KidCard({ kid, focus, children }: { kid: TodayKid; focus: Focus; children?: ReactNode }) {
  const id = String(kid.id)
  const open = focus.isOpen(id)
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => { if (open) body.current?.focus({ preventScroll: true }) }, [open]) // opening moves focus into the body
  const name = kid.name ?? 'Kid'
  const waitingN = kid.needs_you_count ?? 0
  return (
    <div className="pt-kcard" data-open={open ? '' : undefined}>
      <div className="pt-kmain">
        <InfoPop
          label={`${name} details`}
          width={260}
          target={
            <button type="button" className="pt-kavbtn" aria-label={`${name} details`}>
              <KidAv id={kid.id} name={kid.name} className="pt-kav" />
            </button>
          }
        >
          <KidFacts kid={kid} />
          <p className="pt-kearned">Earned today: {kid.earned ?? 0}</p>
          <Link href={`/kids?section=kids&item=${kid.id}`} className="pt-klink">
            Open {name}&apos;s page
            <Icon name="chevron_right" size={16} />
          </Link>
        </InfoPop>
        <button
          type="button"
          className="pt-krow"
          aria-expanded={open}
          aria-controls={open ? `kbody-${id}` : undefined}
          data-focus-head={id}
          onClick={() => focus.toggle(id)}
        >
          <span className="pt-khead">
            <span className="pt-kname">
              <span className="p-kn">{name}</span>
              {waitingN > 0 && <span className="p-chip" data-tone="lav">{waitingN} waiting</span>}
            </span>
            <LockPill kid={kid} />
            <Icon name="chevron_right" size={18} className="pt-kchev" />
          </span>
          <KidDay kid={kid} />
        </button>
      </div>
      {open && children && (
        <div id={`kbody-${id}`} role="region" aria-label={`${name}'s day`} tabIndex={-1} className="pt-kbody" ref={body}>
          {children}
        </div>
      )}
    </div>
  )
}
