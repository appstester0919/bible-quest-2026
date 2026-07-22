/**
 * sendNotification() — thin wrapper around the `web-push` npm library
 *
 * BUGFIX 2026-07-23:
 *   The previous self-rolled implementation (RFC 8291 / 8188 aes128gcm
 *   encryption done by hand using WebCrypto) produced ciphertext that FCM
 *   accepted (HTTP 201) but Chrome's Service Worker couldn't decrypt:
 *     — "WebPush: info\0" JS string literal encoded to 13 bytes instead of
 *       12 (literal `\0` is two chars, not byte 0x00)
 *     — authInfo buffer (143 B) used as HKDF salt instead of auth_secret (16 B)
 *     — AAD byte 0x01 built from "\x01" string literal → 4 chars instead of 1
 *   All three were fixed step-by-step over multiple deploys, but Chrome's
 *   SW was still unable to decrypt the messages. Source-level audit can
 *   catch some bugs but cannot byte-verify against Chrome's actual
 *   decryption implementation.
 *
 *   The pragmatic fix: delete the self-rolled code entirely and use the
 *   same `web-push` npm package that powers the Vercel /api/push/send
 *   route (which we've confirmed produces push messages that decrypt
 *   successfully on the user's Android PWA). The reference implementation
 *   becomes the single source of truth, and any future divergence between
 *   this worker and Vercel disappears by construction.
 *
 *   The `web-push` npm package depends on Node's `http` module to a degree,
 *   but the library only requires `crypto.createECDH`, `crypto.createHmac`,
 *   `Buffer.from`, and `Buffer.concat` — all of which wrangler's node-
 *   compat layer provides via the `nodejs_compat` compatibility flag.
 *   wrangler.toml sets `compatibility_flags = ["nodejs_compat"]`.
 */

import webpush from 'web-push'

let vapidConfigured = false

/**
 * Send a Web Push notification.
 *
 * @param {object} args
 * @param {string} args.endpoint           — FCM / Mozilla push endpoint URL
 * @param {string} args.p256dh             — base64url-encoded user P-256 public key
 * @param {string} args.auth               — base64url-encoded 16-byte auth_secret
 * @param {string} args.vapidPrivateKey    — base64url-encoded VAPID private key
 * @param {string} args.vapidPublicKey     — base64url-encoded VAPID public key
 * @param {string} args.vapidSubject       — mailto: or https: URL
 * @param {object} args.payload            — JSON-serializable object
 * @param {number} [args.ttl]              — seconds (default 86400)
 *
 * @returns {Promise<{ ok: boolean, status?: number, body?: string, expired?: boolean, error?: string }>}
 */
export async function sendNotification({
  endpoint,
  p256dh,
  auth,
  vapidPrivateKey,
  vapidPublicKey,
  vapidSubject,
  payload,
  ttl = 86400,
}) {
  // Lazy VAPID setup — running setVapidDetails is idempotent but only needs
  // to happen once per isolate. Re-running it on every push is cheap (it just
  // assigns to module-internal state) but we still gate it to avoid work.
  if (!vapidConfigured) {
    webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
    vapidConfigured = true
  }

  const subscription = {
    endpoint,
    keys: { p256dh, auth },
  }

  const body = JSON.stringify(payload)

  try {
    const result = await webpush.sendNotification(subscription, body, { TTL: ttl })
    return {
      ok: result.statusCode >= 200 && result.statusCode < 300,
      status: result.statusCode,
      body: result.body || '',
      expired: result.statusCode === 404 || result.statusCode === 410,
    }
  } catch (err) {
    // web-push throws on non-2xx responses; expose statusCode + body so the
    // caller can decide whether to deactivate (404/410) or just log (other).
    const status = err.statusCode || 0
    const body = err.body || ''
    // Log so we can see errors in `wrangler tail` / Workers logs.
    console.error('[sendNotification] error:', err && err.stack ? err.stack : String(err),
                  'status:', status, 'body:', body)
    return {
      ok: false,
      status,
      body,
      expired: status === 404 || status === 410,
      error: err && err.message ? err.message : String(err),
    }
  }
}
