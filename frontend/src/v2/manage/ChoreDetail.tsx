import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { useDisclosure } from '@mantine/hooks'
import type { AssignmentBody } from '@/v2/hooks/useChores'
import { useCopyChore, useDeleteChore, useSaveAssignment, useSaveChore } from '@/v2/hooks/useChores'
import { useFamily } from '@/v2/hooks/useFamily'
import { useChoreTypes } from '@/v2/hooks/useChoreTypes'
import { Icon } from '@/v2/parent/Icon'
import { SaveBar, useDiscardGuard } from '@/v2/parent/SaveBar'
import { FocusArea, SummaryRow } from '@/v2/parent/SummaryRow'
import { useFocusParam } from '@/v2/parent/useFocusParam'
import type { Assignment, Kid, LibChore } from '@/v2/types'
import type { PendingAssignment } from './AssignmentForm'
import { ChoreHead } from './ChoreHead'
import { BasicsBody, OptionsBody } from './ChoreRows'
import { ChoreSteps, StepsInfo, type Step } from './ChoreSteps'
import { ChoreTypePanel } from './ChoreTypePanel'
import { ConfirmDelete } from './ConfirmDelete'
import { useSingle } from './useSingle'
import { WhoWhen } from './WhoWhen'
import { choreHeadLine, intError, nameOf, optionsOn, otherType, schedules, stepsSummary, usedBy } from './choreMeta'
import { toastFail, toastOk } from '../notify'

interface Props {
  kids: Kid[]
  /** Omit to create a new chore. */
  chore?: LibChore
  /** Select a chore, or null to close the detail. */
  onSelect: (id: number | null) => void
  /** Hands the page this editor's leave guard (null on unmount), so switching chore asks about unsaved edits. */
  onGuard?: (g: ((go: () => void) => void) | null) => void
}

interface Draft { title: string; points: string; typeId?: number; steps: Step[]; next: string; photo: boolean; check: boolean; gives: boolean }
/** Unsaved edits per chore id ('new' for a chore not saved yet), kept while the editor is unmounted. */
const drafts = new Map<string, Draft>()
/** Forget all kept drafts (tests). */
export const clearChoreDrafts = () => drafts.clear()

const stepsOf = (c?: LibChore): Step[] =>
  c?.steps.map((s) => ({ title: s.title, due_time: s.due_time ?? null, after_previous: s.after_previous ?? false })) ?? []
const dueBody = (a: Assignment, due: string): AssignmentBody => ({
  kid_ids: a.kid_ids, mode: a.mode, on_date: a.on_date, due_time: due || null,
  repeat: { type: a.repeat.type, days: a.repeat.type === 'weekly' ? [...a.repeat.days].sort() : [] },
})
const sameSteps = (a: Step[], b: Step[]) => JSON.stringify(a) === JSON.stringify(b)

const ico = (name: string): ReactNode => <Icon name={name} size={18} />
const ROWS = ['basics', 'steps', 'who', 'opts']

/** Chore editor: header and four summary rows (Basics, Steps, Who & when, Options); Save bar after a change. */
export function ChoreDetail({ kids, chore, onSelect, onGuard }: Props) {
  const save = useSaveChore()
  const saveAssignment = useSaveAssignment()
  const [saving, setSaving] = useState(false)
  const busy = useRef(false)
  const del = useDeleteChore()
  const delOnce = useSingle(del)
  const copy = useCopyChore()
  const copyOnce = useSingle(copy)
  const [confirm, { open, close }] = useDisclosure(false)
  const types = useChoreTypes().data ?? []
  // 'new' = creating a type, a type id = editing it, null = panel closed
  const [panel, setPanel] = useState<'new' | number | null>(null)
  const key = String(chore?.id ?? 'new')
  const kept = drafts.get(key)
  const [restored] = useState(!!kept)
  const [title, setTitle] = useState(kept?.title ?? chore?.title ?? '')
  const [points, setPoints] = useState(kept?.points ?? String(chore?.points ?? 10))
  // picked type; unset = the chore's saved type (or Other for a new chore)
  const [picked, setPicked] = useState<number | undefined>(kept?.typeId)
  const [steps, setSteps] = useState<Step[]>(kept?.steps ?? stepsOf(chore))
  const [next, setNext] = useState(kept?.next ?? '')
  const [photo, setPhoto] = useState(kept?.photo ?? chore?.needs_photo ?? false)
  const [check, setCheck] = useState(kept?.check ?? chore?.always_check ?? false)
  const [gives, setGives] = useState(kept?.gives ?? chore?.gives_game ?? false)
  const gamesCustom = useFamily().data?.games_earn === 'custom'
  const pointsErr = intError(points, 0)
  // Who & when forms report their pending changes here so one Save sends everything
  const [pending, setPending] = useState<Record<string, PendingAssignment>>({})
  const report = useCallback(
    (k: string, p: PendingAssignment | null) =>
      setPending((cur) => {
        const { [k]: _old, ...rest } = cur
        return p ? { ...rest, [k]: p } : rest
      }),
    [],
  )
  const forms = Object.values(pending)
  const formsDirty = forms.some((f) => f.dirty)
  const formsBad = forms.some((f) => f.dirty && !f.ready)
  const [dueEdit, setDue] = useState<string>()
  const [gen, setGen] = useState(0) // remounts Who & when on Discard
  // After create, delete or Cancel of a new chore the editor leaves without asking: nothing is left to lose.
  const [exit, setExit] = useState<{ id: number | null } | null>(null)
  useEffect(() => { if (exit) onSelect(exit.id) }, [exit]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useFocusParam('open', { valid: (id) => ROWS.includes(id) })
  useEffect(() => { if (!chore) rows.openTo('basics', { replace: true }) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const savedDue = chore?.assignments.map((a) => a.due_time?.slice(0, 5)).filter((t): t is string => !!t).sort().pop() ?? ''
  const due = dueEdit ?? savedDue
  const dueTimes = new Set(chore?.assignments.map((a) => a.due_time?.slice(0, 5)).filter(Boolean))
  const typeId = picked ?? chore?.type_id ?? otherType(types)?.id
  const type = types.find((t) => t.id === typeId)

  const discard = () => {
    setTitle(chore?.title ?? '')
    setPoints(String(chore?.points ?? 10))
    setPicked(undefined)
    setSteps(stepsOf(chore))
    setDue(undefined)
    setGen((g) => g + 1)
    setPending({})
    setNext('')
    setPhoto(chore?.needs_photo ?? false)
    setCheck(chore?.always_check ?? false)
    setGives(chore?.gives_game ?? false)
  }

  // the first step has nothing above it to wait for
  const stepBody = steps
    .filter((s) => s.title.trim())
    .map((s, i) => ({ ...s, title: s.title.trim(), after_previous: i > 0 && s.after_previous }))
  const submit = async () => {
    if (busy.current) return
    busy.current = true
    setSaving(true)
    try {
      const c = await save.mutateAsync({
        id: chore?.id,
        body: { title: title.trim(), points: Number(points), needs_photo: photo, always_check: check, ...(gamesCustom || chore?.gives_game ? { gives_game: gives } : {}), type_id: typeId, steps: stepBody },
      })
      // Due by is the chore's own field: it overrides a closed form's stale copy, and reaches assignments no form changed
      const dirtyForms = forms.filter((f) => f.dirty)
      for (const f of dirtyForms) await saveAssignment.mutateAsync({ choreId: chore?.id ?? c.id, id: f.id, body: dueEdit === undefined ? f.body : { ...f.body, due_time: dueEdit || null } })
      if (dueEdit !== undefined) for (const a of chore?.assignments ?? []) if (!dirtyForms.some((f) => f.id === a.id) && (a.due_time?.slice(0, 5) ?? '') !== dueEdit) await saveAssignment.mutateAsync({ choreId: c.id, id: a.id, body: dueBody(a, dueEdit) })
      drafts.delete(key)
      setDue(undefined)
      setPending({}) // saved; an open form reports again if it changes
      toastOk(chore ? 'Saved' : 'Added. Now choose who does it')
      if (!chore) setExit({ id: c.id })
    } catch (e) {
      toastFail(e)
    } finally {
      busy.current = false
      setSaving(false)
    }
  }

  const dueDirty = dueEdit !== undefined && !!chore?.assignments.some((a) => (a.due_time?.slice(0, 5) ?? '') !== dueEdit)
  const dirty = !exit && (!!next.trim() || formsDirty || dueDirty || (chore
    ? title.trim() !== chore.title ||
      !!pointsErr || Number(points) !== chore.points ||
      photo !== chore.needs_photo ||
      check !== (chore.always_check ?? false) ||
      gives !== (chore.gives_game ?? false) ||
      (picked !== undefined && picked !== chore.type_id) ||
      !sameSteps(steps, stepsOf(chore))
    : !!(title.trim() || steps.length || picked !== undefined)))
  const { guard, sheet } = useDiscardGuard(dirty, () => drafts.delete(key), { inRecord: 'allow' }) // Discard drops the draft before leaving
  useEffect(() => {
    onGuard?.(guard)
    return () => onGuard?.(null)
  }, [onGuard, guard])

  // Switching tabs or chores unmounts this editor: keep what was typed so it isn't lost silently.
  useEffect(() => {
    if (dirty) drafts.set(key, { title, points, typeId: picked, steps, next, photo, check, gives })
    else drafts.delete(key)
  }, [dirty, key, gen, title, points, picked, steps, next, photo, check, gives])

  const duplicate = () =>
    guard(() => {
      discard() // Discard was chosen: start clean, so a failed copy leaves no skip-the-prompt flag behind
      copyOnce(chore!.id, {
        onError: toastFail,
        onSuccess: (c) => {
          toastOk('Copied')
          onSelect(c.id)
        },
      })
    })

  const byId = new Map(kids.map((k) => [k.id, k]))
  const names = (chore ? usedBy(chore) : []).flatMap((id) => (byId.has(id) ? [nameOf(byId.get(id)!)] : []))
  const doers = names.join(', ')
  const when = chore ? schedules(chore).join(' + ') : ''
  const pts = pointsErr ? 0 : Number(points)
  const cancel = () => (chore ? discard() : (drafts.delete(key), setExit({ id: null })))

  return (
    <div className="pk-detail ch-page">
      <ChoreHead
        title={title.trim() || 'New chore'}
        sub={choreHeadLine(type?.name, pts, when, doers)}
        type={type}
        onEditType={() => setPanel(typeId ?? null)}
        onDuplicate={chore && duplicate}
        onDelete={chore && open}
      />
      {chore && (
        <ConfirmDelete
          opened={confirm}
          title={`Delete ${chore.title}?`}
          body="Its history, photos and chat go too. Points already earned stay."
          onConfirm={() => delOnce(chore.id, { onError: toastFail, onSuccess: () => (toastOk('Deleted'), drafts.delete(key), setExit({ id: null })) })}
          onClose={close}
        />
      )}

      <FocusArea focus={rows} label="Chore">
        <SummaryRow id="basics" icon={ico('edit')} title="Basics" summary={[type?.name, `${pts} pts`].filter(Boolean).join(' · ')} focus={rows}>
          <BasicsBody
            title={title} onTitle={setTitle} points={points} pointsErr={pointsErr} onPoints={setPoints}
            types={types} typeId={typeId} onPick={setPicked} onEditType={() => setPanel(typeId ?? null)} onNewType={() => setPanel('new')}
          />
        </SummaryRow>
        <SummaryRow id="steps" icon={ico('checklist')} title="Steps" summary={stepsSummary(steps)} info={<StepsInfo count={steps.length} />} focus={rows}>
          <ChoreSteps steps={steps} onChange={setSteps} next={next} onNext={setNext} choreDue={due || null} />
        </SummaryRow>
        <SummaryRow id="who" icon={ico('group')} title="Who & when" summary={names.length ? `${doers} · ${when}` : 'Nobody yet'} focus={rows}>
          {chore ? (
            <WhoWhen key={gen} chore={chore} kids={kids} due={due} dueTouched={dueEdit !== undefined} report={report} kept={pending} />
          ) : (
            <p className="pk-hint">Save the chore first, then choose who does it and when.</p>
          )}
        </SummaryRow>
        <SummaryRow id="opts" icon={ico('tune')} title="Options" summary={`${optionsOn({ due, photo, check, gives: gamesCustom && gives })} on`} focus={rows}>
          <OptionsBody isNew={!chore} due={due} differs={dueEdit === undefined && dueTimes.size > 1} onDue={setDue} photo={photo} onPhoto={setPhoto} check={check} onCheck={setCheck} gamesCustom={gamesCustom} gives={gives} onGives={setGives} />
        </SummaryRow>
      </FocusArea>

      <ChoreTypePanel
        opened={panel !== null}
        type={typeof panel === 'number' ? types.find((t) => t.id === panel) : undefined}
        onClose={() => setPanel(null)}
        onSaved={(t) => setPicked(t.id)}
        onDeleted={() => setPicked(undefined)}
      />

      <SaveBar
        dirty={dirty}
        saving={saving}
        onSave={submit}
        onCancel={cancel}
        saveLabel="Save chore"
        disabled={!title.trim() || !!pointsErr || formsBad || saving}
        note={formsBad ? 'Finish Who & when to save' : restored ? 'Unsaved changes (restored)' : undefined}
      />
      {sheet}
    </div>
  )
}
