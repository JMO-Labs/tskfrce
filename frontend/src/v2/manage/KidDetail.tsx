import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { useRouter } from 'next/router'
import { viewAs } from '@/v2/kid/viewAs'
import { useDeleteKid } from '@/v2/hooks/useKids'
import { useToday } from '@/v2/hooks/useToday'
import { DetailHeader } from '@/v2/parent/DetailHeader'
import { Icon } from '@/v2/parent/Icon'
import { InfoPop } from '@/v2/parent/InfoPop'
import { useDiscardGuard } from '@/v2/parent/SaveBar'
import { FocusArea } from '@/v2/parent/SummaryRow'
import { useFocusParam, type Focus } from '@/v2/parent/useFocusParam'
import type { Kid } from '@/v2/types'
import { ConfirmDelete } from './ConfirmDelete'
import { ChoresRow, DevicesRow, SettingsRow, TrustRow } from './KidRows'
import { PointsForm } from './PointsForm'
import { PointsPop } from './PointsPop'
import { initial, nameOf } from './choreMeta'
import { useSingle } from './useSingle'
import { toastFail } from '../notify'

/** After an inline form closes: focus `id`, unless focus already went somewhere sensible. */
const refocus = (id: string) =>
  requestAnimationFrame(() => {
    const a = document.activeElement
    if (!a || a === document.body) document.getElementById(id)?.focus()
  })

const ROWS = ['trust', 'devices', 'chores', 'settings']
/** Lets the page ask "leave with unsaved edits?" before it switches kid. */
export type LeaveGuard = (go: () => void) => void

/** Kid page: header (points, Level, Edit, …) and four summary rows. Edit turns Settings > Profile into inputs. */
export function KidDetail({ kid, onDeleted, guardRef }: { kid: Kid; onDeleted: () => void; guardRef?: MutableRefObject<LeaveGuard | null> }) {
  const router = useRouter()
  const rows = useFocusParam('open', { clears: ['edit', 'pin'], valid: (id) => ROWS.includes(id) })
  const edit = useFocusParam('edit') // '1' = Profile as inputs (second level)
  const editing = edit.open === '1' && rows.open === 'settings'
  const [dirty, setDirty] = useState(false)
  const { guard, release, sheet } = useDiscardGuard(dirty)
  const [points, setPoints] = useState<'bonus' | 'deduct' | null>(null)
  const [removing, setRemoving] = useState(false)
  const del = useSingle(useDeleteKid())
  const t = useToday().data?.kids.find((k) => k.id === kid.id)
  const name = nameOf(kid)

  useEffect(() => {
    if (!guardRef) return
    guardRef.current = guard
    return () => { guardRef.current = null }
  }, [guardRef, guard])

  // an old PIN link's pin=1 goes away with edit, or the next Edit would focus the PIN again
  const pinSet = router.query.pin !== undefined
  useEffect(() => {
    if (editing || !pinSet) return
    const { pin: _pin, ...rest } = router.query
    void router.replace({ pathname: router.pathname, query: rest }, undefined, { shallow: true, scroll: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, pinSet])

  // leaving edit lands on Edit again, never on <body>
  const wasEditing = useRef(editing)
  useEffect(() => {
    if (wasEditing.current && !editing && rows.open === 'settings') refocus('kid-act-edit')
    wasEditing.current = editing
  }, [editing, rows.open])

  // Esc with unsaved edits asks first (captured before the focus hooks close a level)
  useEffect(() => {
    if (!dirty) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[role="dialog"], .mantine-Popover-dropdown, .mantine-Menu-dropdown')) return
      e.preventDefault()
      guard(edit.close)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dirty, guard, edit.close])

  // closing or switching a row, or opening another, asks first while the form has changes
  const gated: Focus = { ...rows, toggle: (id) => guard(() => rows.toggle(id)), close: () => guard(rows.close), openTo: (id, o) => guard(() => rows.openTo(id, o)) }

  const chips = (
    <>
      {t?.points !== undefined && (
        <InfoPop
          label="Points history"
          width={280}
          target={
            <button type="button" className="kd-pill" data-tone="acc">
              <Icon name="stars" size={16} />
              {`${t.points} pts`}
            </button>
          }
        >
          <PointsPop kidId={kid.id} />
        </InfoPop>
      )}
      {t?.progress && (
        <span className="kd-pill">
          <Icon name="trending_up" size={16} />
          {`Level ${t.progress.level}`}
        </span>
      )}
    </>
  )

  return (
    <div className="pk-detail kd-page">
      <DetailHeader
        media={
          <span className="pk-av" data-size="xl" aria-hidden="true">
            {initial(name)}
          </span>
        }
        title={name}
        chips={chips}
        main={
          <button type="button" id="kid-act-edit" className="p-btn" hidden={editing} onClick={() => rows.openTo('settings', { extra: { edit: '1' } })}>
            <Icon name="edit" size={16} />
            Edit
          </button>
        }
        menuId="kid-act-more"
        menu={[
          { label: 'Bonus', icon: 'add_circle', takesFocus: true, onClick: () => setPoints('bonus') },
          { label: 'Deduct', icon: 'remove_circle', takesFocus: true, onClick: () => setPoints('deduct') },
          { label: 'View as kid', icon: 'visibility', href: viewAs(kid.id, router.asPath) },
          { label: `Remove ${name}`, icon: 'close', tone: 'red', divider: true, onClick: () => setRemoving(true) },
        ]}
      />
      {points && (
        <PointsForm
          key={points}
          kid={kid}
          kind={points}
          onClose={() => {
            setPoints(null)
            refocus('kid-act-more')
          }}
        />
      )}
      <FocusArea focus={rows} label={`${name}'s page`}>
        <TrustRow kid={kid} focus={gated} />
        <DevicesRow kid={kid} focus={gated} />
        <ChoresRow kid={kid} focus={gated} />
        <SettingsRow
          kid={kid}
          focus={gated}
          editing={editing}
          focusPin={router.query.pin === '1'}
          onDirty={setDirty}
          onSaved={edit.close}
          onCancel={() => guard(edit.close)}
        />
      </FocusArea>
      <ConfirmDelete
        opened={removing}
        title={`Remove ${name}?`}
        body={`Removing ${name} deletes their chores and frees their devices.`}
        confirmLabel="Remove"
        onConfirm={() => del(kid.id, { onSuccess: () => { release(); onDeleted() }, onError: toastFail })}
        onClose={() => setRemoving(false)}
      />
      {sheet}
    </div>
  )
}
