import { useState } from 'react'
import { usePatchKid } from '@/v2/hooks/useKids'
import { InfoPop } from '@/v2/parent/InfoPop'
import { SegmentedControl } from '@/v2/parent/SegmentedControl'
import type { CelebrateLevel, Kid } from '@/v2/types'
import { toastFail } from '../notify'
import { CelebratePreview } from './CelebratePreview'

type Pick = CelebrateLevel | 'default'

/** A kid's celebration level (Settings row body). The server sends the effective level; "Mode default" PATCHes null. */
export function KidCelebrations({ kid }: { kid: Kid }) {
  const patch = usePatchKid()
  const [pick, setPick] = useState<Pick>(kid.celebrate ?? 'default')
  const choose = (v: Pick) => {
    const prev = pick
    setPick(v)
    patch.mutate({ id: kid.id, body: { celebrate: v === 'default' ? null : v } }, { onError: (e) => (setPick(prev), toastFail(e)) })
  }
  return (
    <div className="kd-cel">
      <div className="p-sec-h kd-sech">
        Celebrations
        <InfoPop label="About celebrations">How loud the fun is when a chore is done. Mode default is Full, or Small for teens.</InfoPop>
      </div>
      <div className="kd-cel-row">
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
        <CelebratePreview mode={kid.age_group} level={pick === 'default' ? (kid.age_group === 'teen' ? 'small' : 'full') : pick} />
      </div>
    </div>
  )
}
