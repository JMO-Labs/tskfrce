import { useState } from 'react'
import Link from 'next/link'
import { HappyHourButton } from '@/v2/today/HappyHourButton'
import { Icon } from '@/v2/parent/Icon'
import { lookText, type Look } from './recapTypes'

const MAX = 3

/** Worth a look: one list for the whole family, most serious first, one action per row. */
export function RecapLooks({ looks }: { looks: Look[] }) {
  const [all, setAll] = useState(false)
  const shown = all ? looks : looks.slice(0, MAX)
  return (
    <section className="pk-panel" aria-label="Worth a look">
      <h3>
        <Icon name="flag" size={18} />
        Worth a look
        <span className="rw-aside">{looks.length}</span>
      </h3>
      <ul className="v2-looks">
        {shown.map((l) => {
          const t = lookText(l)
          return (
            <li key={`${l.kid.id}-${l.flag.kind}`} className="v2-look">
              <span className="p-needs-ic">
                <Icon name={t.icon} size={18} />
              </span>
              <span className="v2-look-t">
                <b>
                  <span className="v2-nm">{l.kid.name}:</span> {t.title.split(/(\d+-day)/).map((x, i) => (i % 2 ? <span key={i} className="v2-nm">{x}</span> : x))}
                </b>
                <small>{t.sub}</small>
              </span>
              {l.flag.action === 'happy_hour' ? (
                <HappyHourButton kidId={l.kid.id} label="Happy hour" accent />
              ) : (
                <Link className="p-btn" href={`/kids?section=kids&kid=${l.kid.id}${l.flag.action === 'trust' ? '#trust' : ''}`}>
                  Open
                </Link>
              )}
            </li>
          )
        })}
      </ul>
      {looks.length > MAX && !all && (
        <button type="button" className="p-btn" onClick={() => setAll(true)}>
          See all
        </button>
      )}
    </section>
  )
}
