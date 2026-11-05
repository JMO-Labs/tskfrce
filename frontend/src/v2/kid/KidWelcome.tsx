import { InstallHint } from '../components/InstallHint'
import type { KidAlert } from '../types/enroll'
import { alertLink } from './kidDevice'

const STORES = [
  ['App Store', 'https://apps.apple.com/app/ntfy/id1625396347'],
  ['Google Play', 'https://play.google.com/store/apps/details?id=io.heckel.ntfy'],
]

/** First screen after scanning a parent's code: welcome, home-screen help, alerts setup. */
export function KidWelcome({ name, avatar, alert, onStart }: { name: string; avatar: string | null; alert: KidAlert | null; onStart: () => void }) {
  return (
    <>
      <span aria-hidden className="k-welcome-av">
        {avatar || '🙂'}
      </span>
      <h1 className="k-disp">You&apos;re in, {name}!</h1>
      <InstallHint who="kid" />
      {alert && (
        <section className="k-install" aria-label="Alerts">
          <h2>Get alerts on this phone</h2>
          <ol>
            <li>
              Get the free <b>ntfy</b> app:{' '}
              {STORES.map(([label, href], i) => (
                <span key={label}>
                  {i > 0 && ' · '}
                  <a href={href} target="_blank" rel="noreferrer">
                    {label}
                  </a>
                </span>
              ))}
            </li>
          </ol>
          <a className="r-btn" data-tone="plain" href={alertLink(alert)}>
            Add my alerts
          </a>
        </section>
      )}
      <button type="button" className="r-btn" onClick={onStart}>
        Start
      </button>
    </>
  )
}
