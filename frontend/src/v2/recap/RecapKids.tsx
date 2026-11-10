import { useState } from 'react'
import { Icon } from '@/v2/parent/Icon'
import { avgDone, type RecapKid } from './recapTypes'
import { Sparkline } from './Sparkline'

const NOTE = 'Arrows compare with the average of the 4 weeks before. Screen time is minutes bought, not minutes watched.'
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`

/** "avg 10" with an arrow for above or below; nothing when equal arrows are skipped. */
function Cmp({ now, avg, unit = '' }: { now: number; avg: number | null; unit?: string }) {
  if (avg == null) return null
  return (
    <span className="rc-cmp">
      {now !== avg && <Icon name={now > avg ? 'arrow_upward' : 'arrow_downward'} />}
      {`avg ${avg}${unit}`}
    </span>
  )
}

function Detail({ k }: { k: RecapKid }) {
  const h = k.enough_history
  return (
    <div className="v2-detail">
      <div className="pk-kv">
        <span>On time</span>
        <b>
          {k.on_time_pct == null ? '–' : `${k.on_time_pct}%`}
          {h && k.on_time_pct != null && <Cmp now={k.on_time_pct} avg={k.on_time_avg} unit="%" />}
        </b>
      </div>
      <div className="pk-kv"><span>Points earned</span><b>{k.points_earned}</b></div>
      <div className="pk-kv"><span>Points spent</span><b>{k.points_spent}</b></div>
      <div className="pk-kv"><span>Screen time bought</span><b>{k.screen_minutes_bought} min</b></div>
      <div className="pk-kv"><span>Streak</span><b>{plural(k.streak, 'day')}</b></div>
    </div>
  )
}

/** This week: one line per kid; tap one to open its other numbers (one at a time). */
export function RecapKids({ kids, line }: { kids: RecapKid[]; line: string | null }) {
  const [open, setOpen] = useState<number | null>(null)
  const [note, setNote] = useState(false)
  return (
    <section className="pk-panel" aria-label="This week">
      <div className="v2-head">
        <h3>
          <Icon name="insights" size={18} />
          This week
        </h3>
        <button type="button" className="v2-info" aria-label="About these numbers" aria-expanded={note} aria-controls={note ? 'rc-note' : undefined} onClick={() => setNote(!note)}>
          <Icon name="info" size={16} />
        </button>
      </div>
      {note && (
        <p id="rc-note" className="rc-note">
          {NOTE}
        </p>
      )}
      <div className="v2-kids">
        {kids.map((k) => {
          const isOpen = open === k.id
          return (
            <div key={k.id}>
              <button type="button" className="v2-kid" aria-expanded={isOpen} aria-controls={isOpen ? `rk-${k.id}` : undefined} onClick={() => setOpen(isOpen ? null : k.id)}>
                <span className="pk-av" data-size="lg" aria-hidden="true">{k.name.charAt(0).toUpperCase()}</span>
                <span className="v2-kid-t">
                  <b>{k.name}</b>
                  <small>
                    {plural(k.done, 'chore')}
                    {k.enough_history && <Cmp now={k.done} avg={avgDone(k)} />}
                  </small>
                </span>
                {k.enough_history && (
                  <span className="v2-sp">
                    <Sparkline values={k.done_trend} />
                  </span>
                )}
                {k.flags.length ? (
                  <span className="p-chip" data-tone="amb"><Icon name="flag" size={12} />{k.flags.length} to look at</span>
                ) : (
                  <span className="p-chip" data-tone="acc"><Icon name="check" size={12} />All good</span>
                )}
                <Icon name={isOpen ? 'expand_less' : 'expand_more'} size={20} />
              </button>
              {!k.enough_history && <p className="v2-new">Trends start after 2 weeks.</p>}
              {isOpen && <div id={`rk-${k.id}`}><Detail k={k} /></div>}
            </div>
          )
        })}
      </div>
      {line && (
        <div className="v2-fam">
          <Icon name="auto_awesome" size={18} />
          {line}
        </div>
      )}
    </section>
  )
}
