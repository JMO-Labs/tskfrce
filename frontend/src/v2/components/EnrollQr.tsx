import { Icon } from '../parent/Icon'
import { nameOf } from '../manage/choreMeta'
import type { Kid } from '../types'
import type { EnrollCode } from '../types/enroll'

/** A kid's one-time sign-in QR, with a "New code" button. */
export function EnrollQr({ kid, code, busy, onNew }: { kid: Kid; code: EnrollCode | undefined; busy: boolean; onNew: () => void }) {
  const name = nameOf(kid)
  return (
    <div style={{ padding: '0 0 12px' }}>
      {code && (
        // eslint-disable-next-line @next/next/no-img-element
        <img alt={`Sign-in code for ${name}`} className="pk-qr" style={{ marginTop: 0 }} width={168} height={168} src={`data:image/svg+xml;utf8,${encodeURIComponent(code.qr_svg)}`} />
      )}
      <p className="pk-hint">Scan with {name}&apos;s phone camera. Works once, for 24 hours.</p>
      <div className="pk-actions">
        <button type="button" className="p-btn" onClick={onNew} disabled={busy}>
          <Icon name="qr_code_2" />
          New code
        </button>
      </div>
    </div>
  )
}
