import { EvalNotice } from './EvalNotice'
import { useEvalStatus } from './useEvalStatus'

export function EvalSettings() {
  const status = useEvalStatus().data
  if (!status?.stats) return <p className="m-help" style={{ fontSize: 14 }}>Usage stats are off on this box.</p>
  return (
    <>
      <EvalNotice />
      {status.household && (
        <p className="m-help" style={{ fontFamily: 'monospace', marginTop: 12 }}>Household ID: {status.household}</p>
      )}
    </>
  )
}
