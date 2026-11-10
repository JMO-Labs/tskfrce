import { useEffect, useState } from 'react'
import { Button } from '@mantine/core'
import { Icon } from '../parent/Icon'
import { installPrompt, onInstallPrompt } from '../pwa'
import { InfoBlock } from './InfoBlock'
import { installPlatform, type InstallPlatform } from './installPlatform'
import styles from '../setup/stepCards.module.css'

const TITLE = 'Put t@sk4ce on your home screen'

const env = () => ({
  ua: navigator.userAgent,
  touch: navigator.maxTouchPoints > 1,
  standalone: window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true,
  secure: window.isSecureContext,
})

/** Add-to-home-screen help for this phone. Kid look in the kid gate, parent look in setup. */
export function InstallHint({ who, handoff }: { who: 'kid' | 'parent'; handoff?: string | null }) {
  const [e, setE] = useState<ReturnType<typeof env> | null>(null) // browser-only: null while rendering on the server
  const [prompt, setPrompt] = useState(installPrompt)
  // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the browser after hydration
  useEffect(() => setE(env()), [])
  useEffect(() => onInstallPrompt(() => setPrompt(installPrompt())), [])
  if (!e) return null
  const p: InstallPlatform = installPlatform({ ...e, hasPrompt: !!prompt })
  if (p === 'installed') return null
  if (p === 'insecure')
    return who === 'kid' ? null : (
      <InfoBlock
        icon="home"
        text={
          <>
            You can add t@sk4ce to your home screen once your box has its secure address. Open it from the <b>Open my box</b> code on the sticker.
          </>
        }
      />
    )
  const kid = who === 'kid'
  const add = kid ? (
    <button type="button" className="r-btn" data-tone="plain" onClick={() => void prompt?.prompt()}>
      Add to home screen
    </button>
  ) : (
    <Button onClick={() => void prompt?.prompt()}>Add to home screen</Button>
  )
  const body =
    p === 'ios' && kid && handoff ? (
      <>
        <ol>
          <li>
            Tap Share <Icon name="ios_share" size={18} /> at the bottom of the screen.
          </li>
          <li>
            Tap <b>Add to Home Screen</b>, then <b>Add</b>.
          </li>
          <li>
            Open <b>t@sk4ce</b> from your home screen and type this code:
          </li>
        </ol>
        <p className="k-code" aria-label={`Code ${handoff.split('').join(' ')}`}>
          {handoff}
        </p>
        <p className="k-code-note">Works once, for 15 minutes.</p>
      </>
    ) : p === 'ios' ? (
      <ol>
        <li>
          Tap Share <Icon name="ios_share" size={18} /> at the bottom of the screen.
        </li>
        <li>
          Tap <b>Add to Home Screen</b>.
        </li>
        <li>
          Tap <b>Add</b>.
        </li>
      </ol>
    ) : p === 'prompt' ? (
      add
    ) : p === 'android' ? (
      <p>
        Tap the menu <Icon name="more_vert" size={18} />, then <b>Add to Home screen</b> or <b>Install app</b>.
      </p>
    ) : (
      <p>
        In your browser&apos;s menu, choose <b>Install</b> or <b>Add to Home screen</b>.
      </p>
    )
  return (
    <section className={kid ? 'k-install' : styles.card} aria-label="Add to home screen">
      {kid ? (
        <h2>{TITLE}</h2>
      ) : (
        <h3>
          <Icon name="install_mobile" />
          {TITLE}
        </h3>
      )}
      {body}
    </section>
  )
}
