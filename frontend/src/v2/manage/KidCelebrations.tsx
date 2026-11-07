import { useState } from 'react'
import { usePatchKid } from '@/v2/hooks/useKids'
import { Icon } from '@/v2/parent/Icon'
import { SegmentedControl } from '@/v2/parent/SegmentedControl'
import type { CelebrateLevel, Kid } from '@/v2/types'
import { toastFail } from '../notify'
import { CelebratePreview } from './CelebratePreview'

type Pick = CelebrateLevel | 'default'

/** A kid's celebration level. The server sends the effective level; "Mode default" PATCHes null. */
export function KidCelebrations({ kid }: { kid: Kid }) {
  const patch = usePatchKid()
  const [pick, setPick] = useState<Pick>(kid.celebrate ?? 'default')
  const choose = (v: Pick) => {
    const prev = pick
    setPick(v)
    patch.mutate({ id: kid.id, body: { celebrate: v === 'default' ? null : v } }, { onError: (e) => (setPick(prev), toastFail(e)) })
  }
  return (
    <section className="pk-panel pk-span" aria-label="Celebrations">
      <h3>
        <Icon name="celebration" size={18} />
        Celebrations
      </h3>
      <SegmentedControl
        label="Celebrations"
        value={pick}
        onChange={choose}
        options={[
          { value: 'full', label: 'Full' },
          { value: 'small', label: 'Small' },
          { value: 'off', label: 'Off' },
          { value: 'default', label: 'Mode default' },
        ]}
      />
      <span className="pk-hint">How loud the fun is when a chore is done. Mode default is Full, or Small for teens.</span>
      <div className="pk-actions">
        <CelebratePreview mode={kid.age_group} level={pick === 'default' ? (kid.age_group === 'teen' ? 'small' : 'full') : pick} />
      </div>
    </section>
  )
}
