import { useRef } from 'react'
import { CelebrationLayer } from '@/v2/kid/celebrate/CelebrationLayer'
import { useCelebrate } from '@/v2/kid/celebrate/useCelebrate'
import type { KidAge } from '@/v2/kid/modes/types'
import { Icon } from '@/v2/parent/Icon'

/** "Preview a celebration": plays one random celebration on this screen. Nothing is sent to the server. */
export function CelebratePreview({ mode }: { mode: KidAge }) {
  const n = useRef(0)
  const cel = useCelebrate({ level: 'full', mode, kidLevel: 3 })
  return (
    <>
      <button type="button" className="p-btn" onClick={() => cel.fire({ kind: 'submit', key: `preview-${++n.current}`, title: 'Make bed', points: 20, big: n.current % 3 === 0 })}>
        <Icon name="celebration" size={17} />
        Preview a celebration
      </button>
      <CelebrationLayer cel={cel} />
    </>
  )
}
