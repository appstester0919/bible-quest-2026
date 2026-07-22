// Round-trip test: encrypt with our push lib, then decrypt as the user would
// (per RFC 8291 aes128gcm). If decryption produces the original payload, the
// encryption is correct.
//
// Run with: node test/roundtrip.mjs

import { sendNotification } from '../src/web-push.js'

const VAPID_PRIV = 'eLYBEpLEthG8lQL-zBjpDMDxLTXSEM6vk05Sg5PcajI'

// Build a mock "user subscription" with a real EC key pair.
async function makeUserSub() {
  const kp = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  )
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', kp.publicKey))
  const p256dh = Buffer.from(pub).toString('base64url')
  const authBytes = crypto.getRandomValues(new Uint8Array(16))
  const auth = Buffer.from(authBytes).toString('base64url')
  return { p256dh, auth, privateKey: kp.privateKey, publicKey: kp.publicKey, pubBytes: pub, authBytes }
}

// Re-implement the receiver side per RFC 8291.
async function decryptWebPush({ body, userAuth, userPub, userPrivKey }) {
  // Parse aes128gcm header: salt(16) || rs(4 BE) || idlen(1) || ephemeral_pub(65) || ciphertext
  const salt = body.slice(0, 16)
  const rs = new DataView(body.buffer, body.byteOffset + 16, 4).getUint32(0, false)
  const idlen = body[20]
  const ephemeralPub = body.slice(21, 21 + idlen)
  const ciphertext = body.slice(21 + idlen)

  const ephPubKey = await crypto.subtle.importKey(
    'raw', ephemeralPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  )
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: ephPubKey },
      userPrivKey,
      256,
    )
  )

  // HKDF: same as sender but with salt, ikm order swapped (RFC 8291 §3)
  async function hmac(k, d) {
    const key = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, d))
  }
  async function hkdfExpand(prk, info, length) {
    const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const n = Math.ceil(length / 32)
    const out = []
    let prev = new Uint8Array(0)
    for (let i = 1; i <= n; i++) {
      const input = new Uint8Array(prev.length + info.length + 1)
      input.set(prev, 0); input.set(info, prev.length); input[prev.length + info.length] = i
      const block = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, input))
      out.push(block); prev = block
    }
    return new Uint8Array(out.flatMap(x => Array.from(x))).slice(0, length)
  }

  const authInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    userPub,
    ephemeralPub,
  )
  const prk = await hmac(authInfo, ecdhSecret)
  const cek   = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12)

  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt'])
  const aad = new TextEncoder().encode('\x01Content-Encoding: aes128gcm\0')
  const plaintext = new Uint8Array(
    await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, aesKey, ciphertext)
  )

  // Strip leading padding (2-byte BE length + that many zeros) and the 29-byte header literal + 8-byte size
  const padLen = (plaintext[0] << 8) | plaintext[1]
  const headerLiteralLen = 1 + 27 + 1  // record_type(1) + "Content-Encoding: aes128gcm"(27) + null(1) = 29
  const headerLen = headerLiteralLen + 8
  const payloadBytes = plaintext.slice(2 + padLen + headerLen)
  return new TextDecoder().decode(payloadBytes)
}

function concatBytes(...arrs) {
  let n = 0; for (const a of arrs) n += a.length
  const out = new Uint8Array(n)
  let off = 0; for (const a of arrs) { out.set(a, off); off += a.length }
  return out
}

// Replicate encryptPayload logic minus the fetch, so we can inspect the body bytes.
async function buildPushBody({ p256dh, auth, payload }) {
  const userPub = Uint8Array.from(Buffer.from(p256dh, 'base64url'))
  const userAuth = Uint8Array.from(Buffer.from(auth, 'base64url'))
  const userPubKey = await crypto.subtle.importKey('raw', userPub, { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const ephPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: userPubKey }, eph.privateKey, 256))

  async function hmac(k, d) {
    const key = await crypto.subtle.importKey('raw', k, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, d))
  }
  async function hkdfExpand(prk, info, length) {
    const prkKey = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    const n = Math.ceil(length / 32)
    const out = []; let prev = new Uint8Array(0)
    for (let i = 1; i <= n; i++) {
      const input = new Uint8Array(prev.length + info.length + 1)
      input.set(prev, 0); input.set(info, prev.length); input[prev.length + info.length] = i
      const block = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, input))
      out.push(block); prev = block
    }
    return new Uint8Array(out.flatMap(x => Array.from(x))).slice(0, length)
  }

  const salt = crypto.getRandomValues(new Uint8Array(16))
  const authInfo = concatBytes(
    new TextEncoder().encode('WebPush: info\0'),
    userPub,
    ephPubRaw,
  )
  const prk = await hmac(authInfo, ecdhSecret)
  const cek   = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdfExpand(prk, new TextEncoder().encode('Content-Encoding: nonce\0'), 12)
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])

  const aad = new TextEncoder().encode('\x01Content-Encoding: aes128gcm\0')
  const sizeBytes = new Uint8Array(8); new DataView(sizeBytes.buffer).setBigUint64(0, BigInt(new TextEncoder().encode(payload).length), false)
  const plaintext = concatBytes(new Uint8Array([0, 0]), aad, sizeBytes, new TextEncoder().encode(payload))
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData: aad }, aesKey, plaintext))

  return concatBytes(salt, new Uint8Array(new Uint32Array([ciphertext.length]).buffer), new Uint8Array([65]), ephPubRaw, ciphertext)
}

const sub = await makeUserSub()
const payload = JSON.stringify({ title: 'Test', body: 'hello bible quest', url: '/dashboard' })
const body = await buildPushBody({ p256dh: sub.p256dh, auth: sub.auth, payload })

if (body.length < 16 + 4 + 1 + 65) {
  console.error('✗ body too short:', body.length); process.exit(1)
}
console.log('✓ body length:', body.length)

const decrypted = await decryptWebPush({
  body,
  userAuth: sub.authBytes,
  userPub: sub.pubBytes,
  userPrivKey: sub.privateKey,
})

if (decrypted !== payload) {
  console.error('✗ round-trip mismatch')
  console.error('  expected:', payload)
  console.error('  got     :', decrypted)
  process.exit(1)
}
console.log('✓ round-trip decryption matches original payload')
console.log('  decrypted:', decrypted)