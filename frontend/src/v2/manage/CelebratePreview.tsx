import { useRef } from 'react'
import { CelebrationLayer } from '@/v2/kid/celebrate/CelebrationLayer'
import { useCelebrate } from '@/v2/kid/celebrate/useCelebrate'
import type { KidAge } from '@/v2/kid/modes/types'
import type { CelebrateLevel } from '@/v2/types'
import { Icon } from '@/v2/parent/Icon'

/** "Preview a celebration": plays one random celebration on this screen. Nothing is sent to the server. */
export function CelebratePreview({ mode, level, label = 'Preview a celebration' }: { mode: KidAge; level: CelebrateLevel; label?: string }) {
  const n = useRef(0)
  const cel = useCelebrate({ level, mode, kidLevel: 3 })
  return (
    <>
      <button type="button" className="p-btn" disabled={level === 'off'} onClick={() => cel.fire({ kind: 'submit', key: `preview-${++n.current}`, title: 'Make bed', points: 20, big: n.current % 3 === 0 })}>
        <Icon name="celebration" size={17} />
        {label}
      </button>
      <CelebrationLayer cel={cel} />
    </>
  )
}
