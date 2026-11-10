import { useEffect, useRef, useState } from 'react'
import { useCreateKid, usePatchKid, type KidBody } from '@/v2/hooks/useKids'
import { Icon } from '@/v2/parent/Icon'
import { SaveBar } from '@/v2/parent/SaveBar'
import type { AgeGroup, Kid } from '@/v2/types'
import { EmojiPicker } from '@/v2/components/EmojiPicker'
import { AGES } from './ageGroups'
import { useSingle } from './useSingle'
import { toastFail, toastOk } from '../notify'

/** PIN input: digits only, exactly 4. `bad` blocks saving. */
function usePin() {
  const [pin, setPin] = useState('')
  const [letters, setLetters] = useState(false)
  return {
    pin,
    bad: pin !== '' && pin.length !== 4,
    letters,
    reset: () => { setPin(''); setLetters(false) },
    props: {
      type: 'password' as const,
      value: pin,
      inputMode: 'numeric' as const,
      maxLength: 4,
      onBlur: () => setLetters(false),
      onChange: (e: { currentTarget: { value: string } }) => {
        const v = e.currentTarget.value
        setLetters((l) => /\D/.test(v) || (l && v !== '' && v.length < 4))
        setPin(v.replace(/\D/g, ''))
      },
    },
  }
}
const pinError = (p: ReturnType<typeof usePin>) =>
  (p.bad || p.letters) && <span className="pk-error" role="alert">{p.letters ? 'A PIN is digits only, exactly 4.' : 'Use exactly 4 digits.'}</span>

const AgeSelect = ({ value, onChange }: { value: AgeGroup; onChange: (a: AgeGroup) => void }) => (
  <select className="pk-input kd-in" aria-label="Age group" value={value} onChange={(e) => onChange(e.currentTarget.value as AgeGroup)}>
    {AGES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
  </select>
)

/** Add a kid (the `item=new` flow). Editing an existing kid is KidProfileForm, in place on the kid page. */
export function KidEditor({ onCreated }: { onCreated?: (id: number) => void }) {
  const create = useCreateKid()
  const createOnce = useSingle(create)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState('')
  const [age, setAge] = useState<AgeGroup>('kid')
  const pin = usePin()

  const save = () => {
    if (pin.bad) return
    const body: KidBody = { full_name: name.trim() }
    if (avatar) body.avatar = avatar
    if (age !== 'kid') body.age_group = age
    if (pin.pin) body.pin = pin.pin
    createOnce(body, {
      onError: toastFail,
      onSuccess: (res: unknown) => { toastOk('Added'); pin.reset(); onCreated?.((res as Kid).id) },
    })
  }

  return (
    <section className="pk-panel pk-span" aria-label="Add a kid">
      <h3 aria-level={2}>
        <Icon name="person_add" size={18} />
        Add a kid
      </h3>
      <div className="pk-form">
        <label className="pk-field">
          <span className="pk-label">Name</span>
          <input className="pk-input" value={name} maxLength={100} onChange={(e) => setName(e.currentTarget.value)} />
        </label>
        <EmojiPicker label="Avatar (an emoji)" value={avatar} onChange={setAvatar} />
        <div role="group" aria-labelledby="pk-age-l">
          <div className="pk-label" id="pk-age-l">Age group</div>
          <div className="pk-ages">
            {AGES.map((a) => (
              <button key={a.id} type="button" className="pk-age" aria-pressed={age === a.id} onClick={() => setAge(a.id)}>
                <b>{a.label}</b>
                <small>{a.blurb}</small>
              </button>
            ))}
          </div>
        </div>
        <label className="pk-field">
          <span className="pk-label">PIN (4 digits)</span>
          <input className="pk-input" aria-invalid={pin.bad || pin.letters} {...pin.props} />
          {pinError(pin)}
        </label>
        <div className="pk-actions">
          <button type="button" className="p-btn" data-variant="accent" onClick={save} disabled={!name.trim() || pin.bad || create.isPending} aria-busy={create.isPending}>
            <Icon name={create.isPending ? 'progress_activity' : 'check'} className={create.isPending ? 'pk-spin' : ''} />
            {create.isPending ? 'Saving…' : 'Add kid'}
          </button>
        </div>
      </div>
    </section>
  )
}

interface FormProps {
  kid: Kid
  /** focus the PIN field (deep link from the PIN nudge) */
  focusPin?: boolean
  onSaved: () => void
  /** the Save bar's Cancel; the caller decides whether leaving needs the Discard check */
  onCancel?: () => void
  /** reports whether there are unsaved changes (and false on unmount) */
  onDirty?: (dirty: boolean) => void
  /** read-only rows shown in the list after the PIN (e.g. Next reward) */
  tail?: React.ReactNode
}

const row = (label: string, field: React.ReactNode) => (
  <label className="kd-kv">
    <span>{label}</span>
    {field}
  </label>
)

/** The kid's Profile as inputs in place (same rows as the read-only list), with a Save bar. Only changed fields are sent. */
export function KidProfileForm({ kid, focusPin, onSaved, onCancel, onDirty, tail }: FormProps) {
  const patch = usePatchKid()
  const patchOnce = useSingle(patch)
  const [name, setName] = useState(kid.full_name ?? '')
  const [avatar, setAvatar] = useState(kid.avatar ?? '')
  const [age, setAge] = useState<AgeGroup>(kid.age_group ?? 'kid')
  const pin = usePin()
  const pinRef = useRef<HTMLInputElement>(null)
  const nameRef = useRef<HTMLInputElement>(null)

  const dirty = name.trim() !== (kid.full_name ?? '') || avatar !== (kid.avatar ?? '') || age !== (kid.age_group ?? 'kid') || pin.pin !== ''
  useEffect(() => { onDirty?.(dirty) }, [dirty, onDirty])
  useEffect(() => () => onDirty?.(false), [onDirty])
  // Edit can start with the row already open (nothing else moves focus then, and Edit hides): land on Name, or the PIN for the PIN nudge
  useEffect(() => {
    const f = requestAnimationFrame(() => {
      const a = document.activeElement
      if (focusPin) pinRef.current?.focus()
      else if (!(a instanceof HTMLInputElement || a instanceof HTMLSelectElement)) nameRef.current?.focus() // never pull focus out of a field already being typed in
    })
    return () => cancelAnimationFrame(f)
  }, [focusPin])

  const save = () => {
    if (pin.bad || !dirty) return
    const body: KidBody = {}
    if (name.trim() !== (kid.full_name ?? '')) body.full_name = name.trim()
    if (avatar !== (kid.avatar ?? '')) body.avatar = avatar
    if (age !== (kid.age_group ?? 'kid')) body.age_group = age
    if (pin.pin) body.pin = pin.pin
    patchOnce({ id: kid.id, body }, { onError: toastFail, onSuccess: () => { toastOk('Saved'); onSaved() } })
  }

  return (
    <>
      <div className="kd-list kd-kvs">
        {row('Name', <input ref={nameRef} className="pk-input kd-in" aria-label="Name" value={name} maxLength={100} onChange={(e) => setName(e.currentTarget.value)} />)}
        {row('Age group', <AgeSelect value={age} onChange={setAge} />)}
        {row(kid.has_pin ? 'New PIN (4 digits)' : 'PIN (4 digits)', <input ref={pinRef} className="pk-input kd-in" aria-invalid={pin.bad || pin.letters} {...pin.props} />)}
        {(pin.bad || pin.letters) && <div className="kd-kv">{pinError(pin)}</div>}
        {kid.has_pin && !pin.bad && (
          <div className="kd-kv">
            <span>A PIN is set</span>
            <button type="button" className="p-btn" onClick={() => patchOnce({ id: kid.id, body: { clear_pin: true } }, { onError: toastFail, onSuccess: () => toastOk('PIN removed') })}>
              Remove PIN
            </button>
          </div>
        )}
        {tail}
        <div className="kd-kv"><span>Avatar</span><EmojiPicker inline className="kd-pick" label="Avatar (an emoji)" value={avatar} onChange={setAvatar} /></div>
      </div>
      <SaveBar inline dirty saving={patch.isPending} disabled={!dirty || !name.trim() || pin.bad} onSave={save} onCancel={() => onCancel?.()} />
    </>
  )
}
