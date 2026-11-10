/** Kid phone enrollment shapes (POST /kid/enroll, POST /kid/session). */
export type KidAlert = { server: string; topic: string }
export type KidIdentity = { id: number; full_name: string; avatar: string | null }
/** POST /kids/{id}/enroll: a one-time sign-in code for a kid's phone. */
export type EnrollCode = { url: string; qr_svg: string; expires_at: string }
/** GET /kids/{id}/phones: one signed-in phone (times are UTC "…Z"). */
export type KidPhone = { id: number; label: string; created_at: string; last_seen_at: string }
/** POST /kid/enroll: sign-in for a scanned phone. `handoff` is the typed code for the iPhone home-screen app. */
export type KidEnrolled = { access_token: string; device_token: string; kid: KidIdentity; alert: KidAlert | null; handoff?: string }
