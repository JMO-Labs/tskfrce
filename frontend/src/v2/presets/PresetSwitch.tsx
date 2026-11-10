import { useState } from 'react'

import { toastFail, toastOk } from '@/v2/notify'
import { fmtValue, keyLabel, STYLE_LABEL } from './format'
import { StyleSeg } from './StyleSeg'
import type { PresetBody, PresetChange, Style } from './types'
import { useApplyPreset, usePresets, usePreview } from './usePresets'
import s from './presets.module.css'

const count = (v: unknown) => (Array.isArray(v) ? v.length : Number(v))

function keptLabel(k: PresetChange): string {
  if (k.key === 'chores') {
    const extra = count(k.now) - count(k.next)
    if (extra > 0) return `${extra} chores you added`
  }
  const what = keyLabel(k.key).toLowerCase()
  return k.who ? `${k.who}'s ${what}` : what
}

/** Change the saved style later; nothing is requested until a different style is picked. */
export function PresetSwitch({ kidId }: { kidId?: number }) {
  const cat = usePresets().data
  const [pick, setPick] = useState<Style | null>(null)
  const apply = useApplyPreset()
  const saved: Style = (kidId != null ? cat?.kids?.find((k) => k.id === kidId)?.style : null) ?? cat?.style ?? 'balanced'
  const shown = pick ?? saved
  const body: PresetBody = kidId != null ? { kids: { [String(kidId)]: shown } } : { style: shown }
  const changing = pick !== null && pick !== saved
  const prev = usePreview(body, changing).data
  const label = STYLE_LABEL[shown]
  const go = () =>
    apply.mutate(body, {
      onSuccess: () => { toastOk(`Switched to ${label}`); setPick(null) },
      onError: toastFail,
    })
  return (
    <div className="pn" style={{ gap: 8 }}>
      {kidId != null && <div className="p-sec-h">Style</div>}
      {kidId == null && <p className={s.note} style={{ margin: 0 }}>Sets defaults for chores, hours and extras. Each kid page has its own style switch too.</p>}
      <StyleSeg value={shown} onChange={(v) => setPick(v === saved ? null : v)} label={kidId != null ? 'Style' : 'Family style'} />
      {changing && prev && (
        <>
          <div className={s.prev}>
            <b>Switching to {label}</b>{' '}
            {prev.changes.length === 0 ? 'Nothing to change.' : `Changes ${prev.changes.length} settings.`}
            {prev.kept.length > 0 && ` Keeps your ${prev.kept.length} edits (${prev.kept.map(keptLabel).join(', ')}).`}
          </div>
          {prev.changes.length > 0 && (
            <details className={s.details}>
              <summary>See what changes</summary>
              <table className={s.table}>
                <thead><tr><th>Setting</th><th>Now</th><th>{label}</th></tr></thead>
                <tbody>
                  {prev.changes.map((c) => (
                    <tr key={`${c.kid_id}-${c.key}`}>
                      <td>{keyLabel(c.key)}{c.who ? ` (${c.who})` : ''}</td>
                      <td>{fmtValue(c.key, c.now)}</td>
                      <td>{fmtValue(c.key, c.next)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
          <button type="button" className="p-btn" data-variant="accent" style={{ width: '100%' }} disabled={apply.isPending} onClick={go}>
            Switch to {label}
          </button>
        </>
      )}
    </div>
  )
}
