import { useEffect, useRef, useState } from 'react'
import { useDisclosure } from '@mantine/hooks'
import { GlyphPicker } from '@/v2/parent/GlyphPicker'
import { BADGE_GLYPHS } from '@/v2/parent/glyphs'
import { Icon } from '@/v2/parent/Icon'
import { InfoPop } from '@/v2/parent/InfoPop'
import { MoreMenu } from '@/v2/parent/MoreMenu'
import { SaveBar, useDiscardGuard } from '@/v2/parent/SaveBar'
import { OVERLAY } from '@/v2/parent/useFocusParam'
import { useDeleteBadge, useSaveBadge } from '@/v2/hooks/useCustomBadges'
import type { CustomBadge, Kid } from '@/v2/types'
import { BadgeAward } from './BadgeAward'
import { ConfirmDelete } from './ConfirmDelete'
import { tierLabel } from './TierPips'
import { useSingle } from './useSingle'
import { nameOf } from './choreMeta'
import { toastFail, toastOk } from '../notify'

interface Props {
  /** Omit to make a new badge. */
  badge?: CustomBadge
  kids: Kid[]
  tiers: Record<string, number>
  /** Select a badge (after creating it), or null to close the row. */
  onSelect: (id: number | null) => void
  /** Hands the list this editor's leave guard (null on unmount), so opening another row asks about unsaved edits. */
  onGuard: (g: ((go: () => void) => void) | null) => void
}

/** Body of an open badge row: name, description, icon pop-over, tiers, Award and "…", then the Save bar. */
export function BadgeDetail({ badge, kids, tiers, onSelect, onGuard }: Props) {
  const save = useSaveBadge()
  const saveOnce = useSingle(save)
  const del = useDeleteBadge()
  const delOnce = useSingle(del)
  const [name, setName] = useState(badge?.name ?? '')
  const [icon, setIcon] = useState(badge?.icon ?? '')
  const [description, setDescription] = useState(badge?.description ?? '')
  const [awarding, setAwarding] = useState(false)
  const [confirm, { open, close }] = useDisclosure(false)
  // after create or delete the editor leaves without asking: nothing is left to lose
  const [exit, setExit] = useState<{ id: number | null } | null>(null)
  useEffect(() => { if (exit) onSelect(exit.id) }, [exit]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = !exit && (badge
    ? name.trim() !== badge.name || icon !== badge.icon || description.trim() !== badge.description
    : !!(name.trim() || icon || description.trim()))
  const discard = () => { setName(badge?.name ?? ''); setIcon(badge?.icon ?? ''); setDescription(badge?.description ?? '') }
  const { guard, sheet } = useDiscardGuard(dirty, discard)
  useEffect(() => { onGuard(guard); return () => onGuard(null) }, [onGuard, guard])

  // Esc closes the row: ask first when there are edits (capture phase, so it runs before the list's own Esc handler)
  const esc = useRef({ dirty, guard, onSelect })
  useEffect(() => { esc.current = { dirty, guard, onSelect } })
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const { dirty: d, guard: g, onSelect: sel } = esc.current
      if (e.key !== 'Escape' || e.defaultPrevented || !d || document.querySelector(OVERLAY)) return
      e.preventDefault()
      g(() => sel(null))
    }
    document.addEventListener('keydown', on, true)
    return () => document.removeEventListener('keydown', on, true)
  }, [])

  const awardBtn = useRef<HTMLButtonElement>(null)
  const form = useRef<HTMLDivElement>(null)
  const wasAwarding = useRef(false)
  useEffect(() => {
    if (awarding) form.current?.querySelector<HTMLElement>('button')?.focus({ preventScroll: true })
    else if (wasAwarding.current) awardBtn.current?.focus({ preventScroll: true })
    wasAwarding.current = awarding
  }, [awarding])

  const submit = () =>
    saveOnce(
      { id: badge?.id, body: { name: name.trim(), icon: icon.trim(), description: description.trim() } },
      {
        onError: toastFail,
        onSuccess: (r) => {
          toastOk(badge ? 'Saved' : 'Added')
          if (!badge) setExit({ id: (r as { id: number }).id })
        },
      },
    )
  const tiersLine = kids.map((k) => `${nameOf(k)} ${tierLabel(tiers[String(k.id)] ?? 0) || '–'}`).join(' · ')
  const bad = !name.trim() || !icon.trim()

  return (
    <div className="bd-edit">
      <div className="bd-two">
        <label className="pk-field">
          <span className="pk-label">Name</span>
          <input className="pk-input" aria-label="Badge name" value={name} maxLength={60} onChange={(e) => setName(e.currentTarget.value)} />
        </label>
        <label className="pk-field">
          <span className="pk-label">Description</span>
          <input className="pk-input" value={description} maxLength={200} onChange={(e) => setDescription(e.currentTarget.value)} />
        </label>
      </div>
      <div className="bd-line">
        <span>Icon</span>
        <InfoPop label="Change icon" width={320} target={<button type="button" className="pk-tile bd-tile" aria-label="Change icon">{icon ? <Icon name={icon} size={20} /> : <Icon name="add" size={20} />}</button>}>
          {(close) => <GlyphPicker value={icon} onChange={(g) => { setIcon(g); close() }} choices={BADGE_GLYPHS} />}
        </InfoPop>
      </div>
      {badge && (
        <div className="bd-line">
          <span>Tiers so far</span>
          <span className="bd-tsf">{tiersLine}</span>
        </div>
      )}
      {badge && (
        <div className="bd-act">
          <button ref={awardBtn} type="button" className="p-btn" data-variant="accent" aria-expanded={awarding} aria-controls={awarding ? `award-${badge.id}` : undefined} onClick={() => setAwarding((a) => !a)}>
            <Icon name="emoji_events" size={18} />Award
          </button>
          <MoreMenu label={`More for ${badge.name}`} items={[{ label: 'Delete badge', icon: 'delete', tone: 'red', onClick: open }]} />
        </div>
      )}
      {badge && awarding && <BadgeAward id={`award-${badge.id}`} ref={form} badge={badge} kids={kids} tiers={tiers} />}
      {badge && (
        <ConfirmDelete
          opened={confirm}
          title={`Delete ${badge.name}?`}
          body="Kids who earned it lose it."
          onConfirm={() => delOnce(badge.id, { onError: toastFail, onSuccess: () => (toastOk('Deleted'), setExit({ id: null })) })}
          onClose={close}
        />
      )}
      <SaveBar
        dirty={dirty}
        saving={save.isPending}
        onSave={submit}
        onCancel={() => (badge ? discard() : setExit({ id: null }))}
        saveLabel={badge ? 'Save badge' : 'Add badge'}
        disabled={bad || save.isPending}
        note={dirty && !badge && !icon ? 'Pick an icon to save' : undefined}
      />
      {sheet}
    </div>
  )
}
