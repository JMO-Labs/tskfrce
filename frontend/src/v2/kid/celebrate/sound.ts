/** Celebration sound: a device-local toggle, off by default (spec Settled 8). No sound assets ship yet, so playing is a no-op. */
const KEY = 't4c-celebrate-sound'

export function soundOn() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setSound(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1')
    else localStorage.removeItem(KEY)
  } catch {
    /* private mode */
  }
}

// ponytail: stub until sound assets exist; wire an <audio> here when they do
export function playSound() {}
