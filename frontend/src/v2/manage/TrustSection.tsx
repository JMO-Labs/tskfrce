import { useState } from 'react'
import { Modal, Switch } from '@mantine/core'
import { usePatchKid } from '@/v2/hooks/useKids'
import { useToday } from '@/v2/hooks/useToday'
import { Chip } from '@/v2/parent/Chip'
import { SegmentedControl } from '@/v2/parent/SegmentedControl'
import type { Kid } from '@/v2/types'
import { LEVEL_TEXT, LEVELS } from '@/v2/trustTypes'
import { toastFail } from '../notify'
import { SelfApprovedList } from './SelfApprovedList'
import { nameOf } from './choreMeta'

/** Trust row, calm line: the switch, the level chip and progress toward the next level. */
export function TrustLine({ kid }: { kid: Kid }) {
  const patch = usePatchKid()
  const level = kid.trust_level ?? 0
  const goal = kid.trust_goal
  const clean = kid.trust_clean ?? 0
  return (
    <>
      <Switch
        className="kd-sw"
        aria-label="Trust mode"
        aria-busy={patch.isPending}
        checked={!!kid.trust_mode}
        onChange={(e) => !patch.isPending && patch.mutate({ id: kid.id, body: { trust_mode: e.currentTarget.checked } }, { onError: toastFail })}
      />
      {kid.trust_mode ? (
        <>
          <Chip tone="acc" icon="check">
            {LEVELS[level]}
          </Chip>
          {goal != null && (
            <>
              <div className="pt-bar kd-bar">
                <i style={{ width: `${Math.min(100, (clean / goal) * 100)}%` }} />
              </div>
              <span className="kd-frac">{`${clean}/${goal}`}</span>
            </>
          )}
        </>
      ) : (
        <span className="kd-frac">You approve every chore</span>
      )}
    </>
  )
}

/** Trust row body: next level with Change, and what approved itself this week. */
export function TrustBody({ kid }: { kid: Kid }) {
  const patch = usePatchKid()
  const day = useToday().data?.day
  const [picking, setPicking] = useState<number | null>(null)
  const level = kid.trust_level ?? 0
  const save = (body: { trust_level: 0 | 1 | 2 }, done: () => void) => patch.mutate({ id: kid.id, body }, { onSuccess: done, onError: toastFail })
  const close = () => setPicking(null)
  const p = picking ?? level // the sheet stays mounted so Mantine can hand focus back to Change

  return (
    <>
      {kid.trust_mode ? (
        <div className="kd-next">
          <div className="kd-next-t">
            {kid.trust_goal != null ? `Next level: ${LEVELS[level + 1]}` : `Level: ${LEVELS[level]}`}
            <small>{kid.trust_goal != null ? 'Each chore approved on its own counts toward it.' : 'The top level. Chores approve themselves.'}</small>
          </div>
          <button type="button" className="p-btn" onClick={() => setPicking(level)}>
            Change
          </button>
        </div>
      ) : (
        <p className="v2-p">{`Off: you approve every chore. Turn on to let chores approve themselves as ${nameOf(kid)} earns it.`}</p>
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
    </>
  )
}
