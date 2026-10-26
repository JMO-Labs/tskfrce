import { EvalNotice } from './EvalNotice'
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
    </>
  )
}
