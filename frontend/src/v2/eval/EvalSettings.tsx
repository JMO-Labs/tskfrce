import { Icon } from '@/v2/parent/Icon'
import { EvalNotice } from './EvalNotice'
import { openFeedback } from './feedbackStore'
import { useEvalStatus } from './useEvalStatus'

export function EvalSettings() {
  const { data: status, loading } = useEvalStatus()
  if (loading) return null
  if (!status.stats) return <p className="m-help" style={{ fontSize: 14 }}>Usage stats are off on this box.</p>
  return (
    <>
      <EvalNotice />
      {status.household && (
        <p className="m-help" style={{ fontFamily: 'monospace', marginTop: 12 }}>Household ID: {status.household}</p>
      )}
      {status.feedback && (
        <button type="button" className="p-btn" onClick={openFeedback} style={{ marginTop: 12, alignSelf: 'flex-start', width: 'fit-content' }}>
          <Icon name="rate_review" />
          Send feedback
        </button>
      )}
    </>
  )
}
