import { ROWS, STYLE_LABEL } from './format'
import type { PresetCatalog, PresetKid, Style } from './types'
import s from './presets.module.css'

interface Props {
  catalog: PresetCatalog
  /** kids to show; a null style follows `style` */
  kids: PresetKid[]
  /** family style; defaults to the saved one, then Balanced */
  style?: Style
}

export function LimitsTable({ catalog, kids, style }: Props) {
  const family: Style = style ?? catalog.style ?? 'balanced'
  const cols = kids.map((k) => ({ k, st: k.style ?? family }))
  const fam = catalog.family[family]
  const parts = [
    fam?.goals === undefined ? '' : `goals ${fam.goals ? 'on' : 'off'}`,
    fam?.banked === undefined ? '' : `banked time ${fam.banked ? 'on' : 'off'}`,
    fam?.penalties === undefined ? '' : `penalties ${fam.penalties ? 'on' : 'off'}`,
  ].filter(Boolean)
  return (
    <details className={s.details}>
      <summary>See what this sets</summary>
      <table className={s.table}>
        <thead>
          <tr>
            <th />
            {cols.map(({ k, st }) => (
              <th key={k.id}>{`${k.name} · ${STYLE_LABEL[st]}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROWS.map((r) => (
            <tr key={r.label}>
              <td>{r.label}</td>
              {cols.map(({ k, st }) => (
                <td key={k.id}>{r.value(catalog.plans[k.age_group][st])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {parts.length > 0 && <div className={s.note}>{`Family-wide: ${parts.join(', ')} (follows the family pick)`}</div>}
    </details>
  )
}
