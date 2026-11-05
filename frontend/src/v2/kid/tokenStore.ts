/** Kid session token storage. A leaf module (no imports) so api.ts and kidDevice.ts can share it. */
export const KID_TOKEN_KEY = 'task4ce-kid-token'
export const KID_ID_KEY = 'task4ce-kid-id'

export const writeToken = (t: string | null, kidId?: number) => {
  try {
    if (t) {
      localStorage.setItem(KID_TOKEN_KEY, t)
      if (kidId) localStorage.setItem(KID_ID_KEY, String(kidId))
    } else {
      localStorage.removeItem(KID_TOKEN_KEY)
      localStorage.removeItem(KID_ID_KEY)
    }
  } catch {
    /* storage blocked: the session just won't survive a reload */
  }
}
