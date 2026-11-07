import { useEffect, useRef, useState } from 'react'
import { Modal, Switch } from '@mantine/core'
import { usePatchKid } from '@/v2/hooks/useKids'
import { useToday } from '@/v2/hooks/useToday'
import { Chip } from '@/v2/parent/Chip'
import { Icon } from '@/v2/parent/Icon'
import { SegmentedControl } from '@/v2/parent/SegmentedControl'
import type { Kid } from '@/v2/types'
import { LEVEL_TEXT, LEVELS } from '@/v2/trustTypes'
import { toastFail } from '../notify'
import { SelfApprovedList } from './SelfApprovedList'
import { nameOf } from './choreMeta'

/** One "Trust mode" card: switch, level and progress, and what approved itself this week. */
export function TrustSection({ kid }: { kid: Kid }) {
  const patch = usePatchKid()
  const day = useToday().data?.day
  const [picking, setPicking] = useState<number | null>(null)
  const on = !!kid.trust_mode
  const level = kid.trust_level ?? 0
  const goal = kid.trust_goal
  const name = nameOf(kid)
  const save = (body: { trust_mode?: boolean; trust_level?: 0 | 1 | 2 }, done?: () => void) =>
    patch.mutate({ id: kid.id, body }, { onSuccess: done, onError: toastFail })
  const close = () => setPicking(null)
  const p = picking ?? level // the sheet stays mounted so Mantine can hand focus back to Change
  const ref = useRef<HTMLElement>(null)
  // the recap links here with #trust; the kid page loads first, so scroll once this card exists
  useEffect(() => {
    if (window.location.hash === '#trust') ref.current?.scrollIntoView({ block: 'start' })
  }, [])

  return (
    <section id="trust" ref={ref} className="pk-panel pk-span" aria-label="Trust mode">
      <div className="v2-head">
        <h3>
          <Icon name="verified_user" size={18} />
          Trust mode
        </h3>
        <Switch
          className="v2-sw"
          aria-label="Trust mode"
          aria-busy={patch.isPending}
          checked={on}
          onChange={(e) => !patch.isPending && save({ trust_mode: e.currentTarget.checked })}
        />
      </div>
      {on ? (
        <div className="v2-level">
          <Chip tone="acc" icon="verified">
            {LEVELS[level]}
          </Chip>
          {goal != null && (
            <>
              <div className="pt-bar">
                <i style={{ width: `${Math.min(100, ((kid.trust_clean ?? 0) / goal) * 100)}%` }} />
              </div>
              <span className="v2-next">{`${kid.trust_clean ?? 0} of ${goal} to ${LEVELS[level + 1]}`}</span>
            </>
          )}
          <button type="button" className="p-btn" onClick={() => setPicking(level)}>
            Change
          </button>
        </div>
      ) : (
        <p className="v2-p">{`Off: you approve every chore. Turn on to let chores approve themselves as ${name} earns it.`}</p>
      )}
      <SelfApprovedList kid={kid} today={day ?? ''} />
      <Modal opened={picking !== null} onClose={close} title="Trust level" centered>
        <div className="pt-hh-sheet v2-sheet">
          <SegmentedControl
            label="Trust level"
            value={String(p)}
            onChange={(v) => setPicking(Number(v))}
            options={LEVELS.map((l, i) => ({ value: String(i), label: l }))}
          />
          <p className="v2-p">{LEVEL_TEXT[p]}</p>
          <div className="pk-actions v2-end">
            <button type="button" className="p-btn" onClick={close}>
              Cancel
            </button>
            <button
              type="button"
              className="p-btn"
              data-variant="accent"
              disabled={patch.isPending}
              onClick={() => (p === level ? close() : save({ trust_level: p as 0 | 1 | 2 }, close))}
            >
              Save
            </button>
          </div>
        </div>
      </Modal>
    </section>
  )
}
