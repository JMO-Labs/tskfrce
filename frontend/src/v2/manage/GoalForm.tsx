import { useState } from 'react'
import { EmojiPicker } from '@/v2/components/EmojiPicker'
import { useCreateGoal } from '@/v2/hooks/useGoals'
import { useKids } from '@/v2/hooks/useKids'
import { SegmentedControl } from '@/v2/parent/SegmentedControl'
import type { GoalKind, GoalSettings } from '@/v2/goalTypes'
import { toastFail, toastOk } from '../notify'

const BUILTIN: Record<'screen' | 'jail', string> = { screen: 'Extra screen time', jail: 'Get out of jail free' }

/** New goal: custom or built-in, for some kids or the whole family. */
export function GoalForm({ settings, onDone }: { settings: GoalSettings; onDone: () => void }) {
  const kids = useKids().data ?? []
  const create = useCreateGoal()
  const [kind, setKind] = useState<GoalKind>('custom')
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [price, setPrice] = useState('')
  const [who, setWho] = useState<number[]>([])
  const [family, setFamily] = useState(false)
  const custom = kind === 'custom'
  const options: { value: GoalKind; label: string }[] = [{ value: 'custom', label: 'Custom' }]
  if (settings.screen_on) options.push({ value: 'screen', label: BUILTIN.screen })
  if (settings.jail_on) options.push({ value: 'jail', label: BUILTIN.jail })
  const pick = (k: GoalKind) => {
    setKind(k)
    if (k !== 'custom') setFamily(false) // a family goal must be custom
  }
  const toggle = (id: number) => {
    setFamily(false)
    setWho((w) => (w.includes(id) ? w.filter((x) => x !== id) : [...w, id]))
  }
  const target = Number(price)
  const ok = (custom ? !!name.trim() && target > 0 : true) && (family || who.length > 0)
  const submit = () =>
    create.mutate(
      { name: custom ? name.trim() : BUILTIN[kind as 'screen' | 'jail'], emoji: custom ? emoji || null : null, target: custom ? target : undefined, kind, kid_ids: family ? [] : who, family },
      { onSuccess: () => { toastOk('Goal added'); onDone() }, onError: toastFail },
    )
  return (
    <div className="gl-form">
      {options.length > 1 && <SegmentedControl label="Goal type" value={kind} onChange={pick} options={options} />}
      {custom && (
        <>
          <div className="gl-name">
            <EmojiPicker label="Emoji" value={emoji} onChange={setEmoji} inline />
            <label className="pk-field">
              <span className="pk-label">Name</span>
              <input className="pk-input" value={name} maxLength={60} onChange={(e) => setName(e.currentTarget.value)} />
            </label>
          </div>
          <label className="pk-field">
            <span className="pk-label">Price</span>
            <input className="pk-input" type="number" min={1} inputMode="numeric" value={price} onChange={(e) => setPrice(e.currentTarget.value)} />
          </label>
        </>
      )}
      <span className="pk-label">Who</span>
      <div className="gl-who">
        {kids.map((k) => (
          <button key={k.id} type="button" className="pill" data-on={who.includes(k.id) || undefined} aria-pressed={who.includes(k.id)} onClick={() => toggle(k.id)}>
            {k.full_name || k.username}
          </button>
        ))}
        {custom && (
          <button type="button" className="pill" data-on={family || undefined} aria-pressed={family} onClick={() => { setFamily(!family); setWho([]) }}>
            Family
          </button>
        )}
      </div>
      <div className="gl-acts">
        <button type="button" className="p-btn" onClick={onDone}>Cancel</button>
        <button type="button" className="p-btn" data-variant="accent" disabled={!ok || create.isPending} onClick={submit}>Create goal</button>
      </div>
    </div>
  )
}
