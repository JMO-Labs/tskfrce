import { VisuallyHidden } from '@mantine/core'
import { Icon } from '@/v2/parent/Icon'
import type { KidChore } from '../../types'
import { KidChip, PointsChip } from '../KidChip'
import { kidChips } from '../kidChips'

export const glyph = (c: KidChore) => c.type?.glyph || 'checklist'

/** Big chore tile (10 .tile): glyph, name, points + top status chip, step bar, → button. */
export function ChoreTile({ c, now, tz, x2, onOpen }: { c: KidChore; now: number; tz?: string; x2?: number; onOpen: () => void }) {
  const dim = c.state === 'done' || c.state === 'needs_you'
  const chip = kidChips(c, now, tz)[0]
  const steps = c.subtasks ?? []
  const done = steps.filter((s) => s.done).length
  return (
    <button type="button" className="k-tile" data-dim={dim || undefined} data-celebrate-id={c.id} onClick={onOpen}>
      {/* named by its visible text (WCAG 2.5.3), "Open …" for screen readers */}
      <VisuallyHidden component="span">Open </VisuallyHidden>
      <span className="k-ticon">
        <Icon name={dim ? 'check' : glyph(c)} />
      </span>
      <span className="k-tbody">
        <span className="k-tname">{c.title}</span>
        <span className="k-tmeta">
          <PointsChip points={c.points} now={x2} />
          {chip && <KidChip chip={chip} />}
        </span>
        {steps.length > 0 && (
          <span className="k-mini">
            <i style={{ width: `${(done / steps.length) * 100}%` }} />
          </span>
        )}
      </span>
      {!dim && (
        <span className="k-go">
          <Icon name="arrow_forward" />
        </span>
      )}
    </button>
  )
}
