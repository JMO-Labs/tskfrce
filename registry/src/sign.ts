const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u))
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0))

/** Ed25519 envelope the box verifies in backend/app/integrations/trust.py. */
export async function signEnvelope(obj: unknown, pkcs8B64: string): Promise<{ payload: string; sig: string }> {
  const key = await crypto.subtle.importKey('pkcs8', unb64(pkcs8B64), 'Ed25519', false, ['sign'])
  const bytes = new TextEncoder().encode(JSON.stringify(obj))
  const sig = new Uint8Array(await crypto.subtle.sign('Ed25519', key, bytes))
  return { payload: b64(bytes), sig: b64(sig) }
}
