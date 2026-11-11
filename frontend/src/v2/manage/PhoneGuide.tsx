import { useState } from 'react'
import { Modal } from '@mantine/core'
import { HELP_URL } from '@/v2/components/AccountMenu'
import { markGuideSeen, stepsDone, toggleStep } from './phoneGuideStore'

const GUIDES = [
  {
    title: 'Android (Google Family Link)',
    steps: [
      { id: 'android-data', text: 'In Family Link, lock or restrict mobile data for this phone, so it cannot go online outside home Wi-Fi.' },
      { id: 'android-switch-data', text: 'Samsung: Settings > Connections > Wi-Fi > Intelligent Wi-Fi > turn off "Switch to mobile data". It sends apps over mobile data while Wi-Fi still shows connected. Keep mobile data locked in Family Link so it cannot be turned back on.' },
      { id: 'android-mac', text: 'On the phone: home Wi-Fi > Privacy > choose "Use device MAC", so the phone keeps the same address.' },
    ],
  },
  {
    title: 'iPhone (Screen Time)',
    steps: [
      { id: 'ios-data', text: 'In Screen Time > Content & Privacy > Cellular Data Changes, choose "Don\'t Allow".' },
      { id: 'ios-mac', text: 'On the phone: home Wi-Fi > turn "Private Wi-Fi Address" off. Then lock Wi-Fi changes with Screen Time.' },
    ],
  },
]

/** The guide's section on this topic (resolving against HELP_URL keeps the same site). */
const SECTION_URL = new URL('06-troubleshooting.html?from=app#if-a-blocked-phone-still-gets-online', HELP_URL).href

interface Props { deviceId: number; opened: boolean; onClose: () => void }

/** Short guide for closing the two ways a blocked phone gets around the box: mobile data and a random Wi-Fi address. */
export function PhoneGuide({ deviceId, opened, onClose }: Props) {
  const [done, setDone] = useState(() => stepsDone(deviceId))
  const tick = (id: string) => { toggleStep(deviceId, id); setDone(stepsDone(deviceId)) }
  const close = () => { markGuideSeen(deviceId); onClose() }
  return (
    <Modal opened={opened} onClose={close} title="Keep this phone on the box">
      <p>The box can only block what goes through home Wi-Fi. A few settings on the phone close the gaps.</p>
      {GUIDES.map((g) => (
        <section key={g.title}>
          <h4>{g.title}</h4>
          {g.steps.map((s) => (
            <label key={s.id} style={{ display: 'flex', gap: 8, margin: '8px 0' }}>
              <input type="checkbox" checked={done.includes(s.id)} onChange={() => tick(s.id)} />
              <span>{s.text}</span>
            </label>
          ))}
        </section>
      ))}
      <p>
        More in the Help guide: <a href={SECTION_URL} target="_blank" rel="noopener noreferrer">If a blocked phone still gets online</a>.
      </p>
      <button type="button" className="p-btn" onClick={close}>Close</button>
    </Modal>
  )
}
