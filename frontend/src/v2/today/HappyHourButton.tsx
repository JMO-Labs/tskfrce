import { useEffect, useState } from 'react'
import { Modal } from '@mantine/core'
import { useFamily } from '@/v2/hooks/useFamily'
import { useHappyHours, useStartHappyHour, useStopHappyHour } from '@/v2/hooks/useHappyHour'
import { useKids } from '@/v2/hooks/useKids'
import { Chip } from '@/v2/parent/Chip'
import { Icon } from '@/v2/parent/Icon'
import type { HappyHour, Kid } from '@/v2/types'
import { SegmentedControl } from '@/v2/parent/SegmentedControl'
import { toastFail, toastOk } from '../notify'

const LENGTHS = [30, 60, 90] as const
const MULTS = [15, 20, 30] as const
export const multText = (x10: number) => `×${x10 / 10}`

/** Minutes left, rounded up; re-read every 15 s so the running state counts down. */
export function useMinutesLeft(endsAt: string | undefined) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(t)
  }, [])
  return endsAt ? Math.max(1, Math.ceil((new Date(endsAt).getTime() - now) / 60000)) : 0
}

/** Who a Happy Hour covers: kid names or "everyone". */
export const hhWho = (h: HappyHour, kids: Kid[]) =>
  h.kid_ids ? h.kid_ids.map((id) => kids.find((k) => k.id === id)).map((k) => k?.full_name ?? k?.username ?? 'a kid').join(', ') : 'everyone'

/**
 * "Start Happy Hour": opens a quick sheet (length, multiplier, kids) whose Start uses the family defaults.
 * With `kidId`, only Happy Hours covering that kid show as running (with a Stop each).
 * `allKids`: the sheet starts on "All kids" (Today) instead of just `kidId`.
 */
export function HappyHourButton({ kidId, allKids = false, label = 'Start Happy Hour', accent = false }: { kidId?: number; allKids?: boolean; label?: string; accent?: boolean }) {
  const hh = useHappyHours().data
  const kids = useKids().data ?? []
  const running = (hh?.active ?? []).filter((h) => kidId == null || !h.kid_ids || h.kid_ids.includes(kidId))
  const stop = useStopHappyHour()
  const [open, setOpen] = useState(false)
  const who = (h: HappyHour) => hhWho(h, kids)
  const stopIt = (h: HappyHour) => {
    if (!h.kid_ids && kidId != null && !window.confirm('This Happy Hour is for everyone. Stop it for all kids?')) return
    stop.mutate(h.id, { onSuccess: () => toastOk('Happy Hour stopped'), onError: toastFail })
  }
  return (
    <>
      {running.map((h) => (
        <RunningHH key={h.id} h={h} who={who(h)} busy={stop.isPending} onStop={() => stopIt(h)} />
      ))}
      {!running.length && (
        <button type="button" className="p-btn" data-variant={accent ? 'accent' : undefined} onClick={() => setOpen(true)}>
          <Icon name="bolt" size={17} />
          {label}
        </button>
      )}
      <HappyHourSheet opened={open} onClose={() => setOpen(false)} kidId={kidId} allKids={allKids} />
    </>
  )
}

function RunningHH({ h, who, busy, onStop }: { h: HappyHour; who: string; busy: boolean; onStop: () => void }) {
  const left = useMinutesLeft(h.ends_at)
  return (
    <>
      <Chip tone="acc" icon="bolt">
        Happy Hour {multText(h.mult_x10)} · <span role="status">{left} min left</span> · {who}
      </Chip>
      <button type="button" className="p-btn" disabled={busy} aria-label={`Stop Happy Hour for ${who}`} onClick={onStop}>
        <Icon name="stop_circle" size={17} />
        Stop
      </button>
    </>
  )
}

/** The quick-start sheet (length, multiplier, kids). `allKids` starts it on "All kids" instead of just `kidId`. */
export function HappyHourSheet({ opened, onClose, kidId, allKids = false }: { opened: boolean; onClose: () => void; kidId?: number; allKids?: boolean }) {
  return opened ? <StartSheet kidId={allKids ? undefined : kidId} onClose={onClose} /> : null
}

function StartSheet({ kidId, onClose }: { kidId?: number; onClose: () => void }) {
  const fam = useFamily().data
  const kids = useKids().data ?? []
  const start = useStartHappyHour()
  const [len, setLen] = useState<number | null>(null)
  const [mult, setMult] = useState<number | null>(null)
  const [picked, setPicked] = useState<number[]>(kidId == null ? [] : [kidId]) // none = every kid
  const minutes = (len ?? fam?.hh_default_minutes ?? 60) as (typeof LENGTHS)[number]
  const mult_x10 = (mult ?? fam?.hh_default_mult_x10 ?? 20) as (typeof MULTS)[number]
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  const go = () =>
    start.mutate(
      { minutes, mult_x10, ...(picked.length && { kid_ids: picked }) },
      { onSuccess: () => (toastOk('Happy Hour started'), onClose()), onError: toastFail },
    )
  return (
    <Modal opened onClose={onClose} title="Start Happy Hour" centered>
      <div className="pt-hh-sheet">
        <span className="pk-label">Length</span>
        <SegmentedControl label="Length" value={String(minutes)} onChange={(v) => setLen(Number(v))} options={LENGTHS.map((m) => ({ value: String(m), label: `${m} min` }))} />
        <span className="pk-label">Multiplier</span>
        <SegmentedControl label="Multiplier" value={String(mult_x10)} onChange={(v) => setMult(Number(v))} options={MULTS.map((m) => ({ value: String(m), label: multText(m) }))} />
        <span className="pk-label">Kids</span>
        <div className="pk-tags" role="group" aria-label="Kids">
          <button type="button" className="p-btn" aria-pressed={picked.length === 0} onClick={() => setPicked([])}>
            All kids
          </button>
          {kids.map((k) => (
            <button key={k.id} type="button" className="p-btn" aria-pressed={picked.includes(k.id)} onClick={() => toggle(k.id)}>
              {k.full_name ?? k.username}
            </button>
          ))}
        </div>
        <span className="pk-hint">Chores they finish in this time earn {multText(mult_x10)} base points.</span>
        <div className="pk-actions">
          <button type="button" className="p-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="p-btn" data-variant="accent" disabled={start.isPending} aria-busy={start.isPending} onClick={go}>
            <Icon name="bolt" size={17} />
            Start
          </button>
        </div>
      </div>
    </Modal>
  )
}
