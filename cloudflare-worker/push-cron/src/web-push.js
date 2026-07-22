/**
 * Minimal Web Push sender for Cloudflare Workers.
 *
 * Implements RFC 8291 (Encrypted Content-Encoding for Web Push, aes128gcm)
 * and RFC 8292 (VAPID auth) on top of the Web Crypto API. No npm deps.
 *
 * Usage:
 *   await sendNotification({
 *     endpoint, p256dh, auth,
 *     vapidPrivateKey: '<base64url 32-byte scalar>',
 *     vapidSubject: 'mailto:laikaho0919@gmail.com',
 *     payload: JSON.stringify({ title: 'Hi', body: 'there' }),
 *   })
 */

// ─── helpers ─────────────────────────────────────────────────────────────────
const encoder = new TextEncoder()

function base64UrlToBytes(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/')
  while (s.length % 4) s += '='
  return Uint8Array.from(atob(s), c => c.charCodeAt(0))
}

function bytesToBase64Url(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function concat(...arrays) {
  let total = 0
  for (const a of arrays) total += a.length
  const out = new Uint8Array(total)
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}

async function hmacSha256(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, dataBytes))
}

async function hkdfExtract(salt, ikm) {
  return hmacSha256(salt, ikm)
}

/**
 * HKDF-Expand per RFC 5869 §2.3. Takes a PRK (output of HKDF-Extract)
 * and expands it with `info` to `length` bytes.
 */
async function hkdfExpand(prk, info, length) {
  const prkKey = await crypto.subtle.importKey(
    'raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const n = Math.ceil(length / 32)
  const blocks = []
  let prev = new Uint8Array(0)
  for (let i = 1; i <= n; i++) {
    const input = concat(prev, info, new Uint8Array([i]))
    const out = new Uint8Array(await crypto.subtle.sign('HMAC', prkKey, input))
    blocks.push(out)
    prev = out
  }
  return concat(...blocks).slice(0, length)
}

// ─── VAPID private key → PKCS#8 DER for WebCrypto import ────────────────────
// Wraps a 32-byte P-256 scalar as a PKCS#8 PrivateKeyInfo so crypto.subtle.importKey('pkcs8', ...) works.
// This is the standard trick — algorithm identifier is id-ecPublicKey + prime256v1 (not the signature OID).
function wrapP256PrivateKeyPKCS8(scalar) {
  // ECPrivateKey = SEQUENCE { INTEGER 1, OCTET STRING <scalar>, [0] OID prime256v1 }
  const ecPrivateKeyInner = concat(
    new Uint8Array([0x02, 0x01, 0x01]),                                // INTEGER 1
    new Uint8Array([0x04, 0x20]), scalar,                              // OCTET STRING <scalar>
    new Uint8Array([0xA0, 0x0A, 0x06, 0x08,                           // [0] EXPLICIT { OID prime256v1 }
                    0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07]),
  )
  const ecPrivateKeyDer = encodeDERSequence(ecPrivateKeyInner)

  // AlgorithmIdentifier = SEQUENCE { OID id-ecPublicKey, OID prime256v1 }
  const algId = new Uint8Array([
    0x30, 0x13,
    0x06, 0x07, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x02, 0x01,              // OID id-ecPublicKey
    0x06, 0x08, 0x2A, 0x86, 0x48, 0xCE, 0x3D, 0x03, 0x01, 0x07,       // OID prime256v1
  ])

  const octet = concat(
    new Uint8Array([0x04]),
    encodeDERSequenceLength(ecPrivateKeyDer.length),
    ecPrivateKeyDer,
  )

  const privateKeyInfoInner = concat(
    new Uint8Array([0x02, 0x01, 0x00]),   // INTEGER version 0
    algId,
    octet,
  )
  return encodeDERSequence(privateKeyInfoInner)
}

function encodeDERSequence(content) {
  return concat(
    new Uint8Array([0x30]),
    encodeDERSequenceLength(content.length),
    content,
  )
}

function encodeDERSequenceLength(n) {
  if (n < 0x80) return new Uint8Array([n])
  const bytes = []
  let v = n
  while (v > 0) { bytes.unshift(v & 0xff); v >>= 8 }
  return new Uint8Array([0x80 | bytes.length, ...bytes])
}

async function importVapidPrivateKeyForSign(scalar) {
  return crypto.subtle.importKey(
    'pkcs8',
    wrapP256PrivateKeyPKCS8(scalar),
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign'],
  )
}

async function deriveVapidPublicKeyB64Url(scalar) {
  const ecKey = await importVapidPrivateKeyForSign(scalar)
  const spki = new Uint8Array(await crypto.subtle.exportKey('spki', ecKey))
  // Last 65 bytes of an EC SPKI = uncompressed public key (0x04 || X || Y)
  return bytesToBase64Url(spki.slice(spki.length - 65))
}

// ─── VAPID JWT (RFC 8292 §4) ─────────────────────────────────────────────────
async function buildVapidJwt({ scalar, subject, audience }) {
  const key = await importVapidPrivateKeyForSign(scalar)
  const header = { alg: 'ES256', typ: 'JWT' }
  const claims = {
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  }
  const enc = s => bytesToBase64Url(encoder.encode(s))
  const signingInput = `${enc(JSON.stringify(header))}.${enc(JSON.stringify(claims))}`
  const sig = new Uint8Array(
    await crypto.subtle.sign(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      encoder.encode(signingInput),
    )
  )
  return `${signingInput}.${bytesToBase64Url(sig)}`
}

// ─── Payload encryption (RFC 8291 / aes128gcm) ──────────────────────────────
async function encryptPayload({ p256dh, auth, payload }) {
  const userPub = base64UrlToBytes(p256dh)
  if (userPub.length !== 65 || userPub[0] !== 0x04) {
    throw new Error(`p256dh must be 65-byte uncompressed P-256 key (got ${userPub.length})`)
  }
  const userAuth = base64UrlToBytes(auth)
  const userPubKey = await crypto.subtle.importKey(
    'raw', userPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  )

  const ephemeral = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  )
  const ephemeralPubRaw = new Uint8Array(
    await crypto.subtle.exportKey('raw', ephemeral.publicKey)
  )
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: userPubKey },
      ephemeral.privateKey,
      256,
    )
  )

  const salt = crypto.getRandomValues(new Uint8Array(16))
  // RFC 8291 §3.1:
  //   auth_info = "WebPush: info\0" || ua_public || as_public
  //   PRK = HKDF-Extract(salt=auth_info, IKM=ECDH_shared_secret)
  //   cek   = HKDF-Expand(PRK, "Content-Encoding: aes128gcm\0", 16)
  //   nonce = HKDF-Expand(PRK, "Content-Encoding: nonce\0",       12)
  const authInfo = concat(
    encoder.encode('WebPush: info\0'),
    userPub,
    ephemeralPubRaw,
  )
  const prk = await hkdfExtract(authInfo, ecdhSecret)
  const cek   = await hkdfExpand(prk, encoder.encode('Content-Encoding: aes128gcm\0'), 16)
  const nonce = await hkdfExpand(prk, encoder.encode('Content-Encoding: nonce\0'),       12)

  const aesKey = await crypto.subtle.importKey(
    'raw', cek, { name: 'AES-GCM' }, false, ['encrypt']
  )

  // RFC 8188 / RFC 8291 §4: plaintext = <padding> || <header> || <content>
  //   padding = zero bytes, length encoded as 2-byte BE leading (we use 0)
  //   header  = record_type(1) || "Content-Encoding: aes128gcm\0" || size(8 BE)
  //   content = user payload
  // AAD for AES-GCM = the record_type + name literal (without size field)
  const aad = encoder.encode('\x01Content-Encoding: aes128gcm\0')
  const sizeBytes = new Uint8Array(8)
  new DataView(sizeBytes.buffer).setBigUint64(0, BigInt(encoder.encode(payload).length), false)
  const plaintext = concat(
    new Uint8Array([0x00, 0x00]),  // 2-byte BE zero = no padding
    aad,
    sizeBytes,
    encoder.encode(payload),
  )

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad },
      aesKey,
      plaintext,
    )
  )

  return { ciphertext, salt, dh: ephemeralPubRaw }
}

// ─── Public API ─────────────────────────────────────────────────────────────
export async function sendNotification({
  endpoint,
  p256dh,
  auth,
  vapidPrivateKey,
  vapidSubject,
  payload,
  ttl = 86400,
}) {
  const { ciphertext, salt, dh } = await encryptPayload({ p256dh, auth, payload })

  const url = new URL(endpoint)
  const audience = `${url.protocol}//${url.host}`

  const scalar = base64UrlToBytes(vapidPrivateKey)
  const [jwt, vapidPub] = await Promise.all([
    buildVapidJwt({ scalar, subject: vapidSubject, audience }),
    deriveVapidPublicKeyB64Url(scalar),
  ])

  // aes128gcm header layout: salt (16) || rs (4 BE) || idlen (1) || ephemeral pub (65) || ciphertext
  const headerBuf = concat(
    salt,
    new Uint8Array(new Uint32Array([ciphertext.length]).buffer),  // 4-byte BE
    new Uint8Array([65]),
    dh,
  )
  const body = concat(headerBuf, ciphertext)

  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `vapid t=${jwt}, k=${vapidPub}`,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'TTL': ttl.toString(),
    },
    body,
  })

  return {
    ok: resp.status === 200 || resp.status === 201,
    status: resp.status,
    body: await resp.text(),
    expired: resp.status === 404 || resp.status === 410,
  }
}