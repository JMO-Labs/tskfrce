/** Kid phone enrollment shapes (POST /kid/enroll, POST /kid/session). */
export type KidAlert = { server: string; topic: string }
export type KidIdentity = { id: number; full_name: string; avatar: string | null }
