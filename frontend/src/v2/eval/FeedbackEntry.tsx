import { Tooltip } from '@mantine/core'
import { Icon } from '@/v2/parent/Icon'
import { openFeedback } from './feedbackStore'
import { useEvalStatus } from './useEvalStatus'

export function FeedbackRailButton() {
  if (!useEvalStatus().data.feedback) return null
  return (
    <Tooltip label="Send feedback" position="right" withArrow openDelay={400} closeDelay={100}>
      <button type="button" className="p-rail-item" aria-label="Send feedback" onClick={openFeedback}>
        <Icon name="rate_review" />
      </button>
    </Tooltip>
  )
}

export function FeedbackMoreLink() {
  if (!useEvalStatus().data.feedback) return null
  return (
    <div className="p-more-section">
      <button type="button" className="p-more-link" onClick={openFeedback} style={{ borderRadius: 12, border: '1px solid var(--p-line)' }}>
        <span className="p-more-ic">
          <Icon name="rate_review" size={20} />
        </span>
        <span className="p-more-t">
          Send feedback
          <small>Ideas, bugs and screenshots</small>
        </span>
        <Icon name="chevron_right" size={20} />
      </button>
    </div>
  )
}
