// Prints a fresh Ed25519 keypair. Private key -> `wrangler secret put INTEGRATIONS_SIGNING_KEY`.
const { publicKey, privateKey } = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
const b64 = (b) => Buffer.from(b).toString('base64')
console.log(`PRIVATE_PKCS8_B64=${b64(await crypto.subtle.exportKey('pkcs8', privateKey))}`)
console.log(`PUBLIC_RAW_B64=${b64(await crypto.subtle.exportKey('raw', publicKey))}`)
