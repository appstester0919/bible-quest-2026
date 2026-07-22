/**
 * Bible Quest push-cron worker.
 *
 * Entry points:
 *   1. Cron trigger every 15 min (configured in wrangler.toml [triggers])
 *      — queries Supabase RPC `process_due_reminders`, sends pushes to each
 *        matching subscription, marks users as notified in
 *        push_subscriptions.last_notified_at.
 *   2. HTTP GET /healthz — uptime check
 *
 * Subscription management is handled client-side via Supabase RLS-protected
 * writes to `web_push_subscriptions`. This Worker only reads from that table.
 *
 * Secrets (set via `wrangler secret put`):
 *   SUPABASE_SERVICE_ROLE_KEY   — Supabase service role, bypasses RLS
 *   VAPID_PRIVATE_KEY           — 32-byte P-256 scalar, base64url-encoded
 *   VAPID_SUBJECT               — mailto:laikaho0919@gmail.com
 *
 * Vars (in wrangler.toml [vars]):
 *   SUPABASE_URL, VAPID_PUBLIC_KEY
 */

import { sendNotification } from './web-push.js'

// ─── Config ──────────────────────────────────────────────────────────────────
const PUSH_PARALLEL = 10       // concurrency cap for cron send loop
const PUSH_TTL = 86400         // 24h
const ICON_DEFAULT = '/icons/icon-192.png'
const BADGE_DEFAULT = '/icons/badge-72.png'

// Reminder content — keyed by reminder type. Extend here for streak / custom.
const REMINDER_CONTENT = {
  daily: {
    title: '今日讀經時間',
    body: '今日嘅讀經已準備好喇，繼續保持 streak！',
    url: '/today',
    icon: ICON_DEFAULT,
  },
}

// ─── Supabase REST helpers ────────────────────────────────────────────────────
function sbHeaders(env, extra = {}) {
  return {
    'apikey': env.SUPABASE_SERVICE_ROLE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
    ...extra,
  }
}

async function sbFetch(path, { method = 'GET', body, headers, env } = {}) {
  const url = `${env.SUPABASE_URL}/rest/v1${path}`
  const resp = await fetch(url, {
    method,
    headers: sbHeaders(env, headers),
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!resp.ok) {
    const text = await resp.text()
    throw new Error(`Supabase ${method} ${path} failed: ${resp.status} ${text}`)
  }
  const ct = resp.headers.get('content-type') || ''
  if (ct.includes('application/json')) return resp.json()
  return null
}

// ─── Concurrency-limited parallel map ────────────────────────────────────────
// Runs `fn` over `items` with at most `limit` concurrent invocations.
// Returns an array of results indexed by the original item index.
async function parallelMap(items, limit, fn) {
  const results = new Array(items.length)
  let idx = 0
  async function worker() {
    while (idx < items.length) {
      const i = idx++
      results[i] = await fn(items[i], i)
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

// ─── Cron handler ────────────────────────────────────────────────────────────
async function handleCron(env) {
  let due
  try {
    due = await sbFetch('/rpc/process_due_reminders', { method: 'POST', body: {}, env })
  } catch (err) {
    console.error('[cron] process_due_reminders RPC failed:', err.message)
    return { sent: 0, expired: 0, errors: 1 }
  }

  if (!Array.isArray(due) || due.length === 0) {
    console.log('[cron] no due reminders')
    return { sent: 0, expired: 0, errors: 0 }
  }

  console.log(`[cron] processing ${due.length} (user, device) pairs`)

  // Build payload once per reminder_type. Each (user, device) row gets the
  // same payload — different tags so OS-level notification grouping works
  // per user.
  const content = REMINDER_CONTENT.daily
  const basePayload = JSON.stringify({
    title: content.title,
    body: content.body,
    url: content.url,
    icon: content.icon,
    badge: BADGE_DEFAULT,
    tag: `bq-daily-${content.url}`,
  })

  let sent = 0, expired = 0, errors = 0
  await parallelMap(due, PUSH_PARALLEL, async (item) => {
    try {
      const result = await sendNotification({
        endpoint: item.endpoint,
        p256dh: item.p256dh,
        auth: item.auth,
        vapidPrivateKey: env.VAPID_PRIVATE_KEY,
        vapidSubject: env.VAPID_SUBJECT,
        payload: basePayload,
        ttl: PUSH_TTL,
      })
      if (result.ok) {
        sent++
      } else if (result.expired) {
        expired++
        try {
          await sbFetch('/rpc/deactivate_web_push_subscription', {
            method: 'POST',
            body: { p_user_id: item.user_id, p_endpoint: item.endpoint },
            env,
          })
        } catch (deactErr) {
          console.warn(`[cron] deactivation failed for ${item.endpoint}: ${deactErr.message}`)
        }
      } else {
        errors++
        console.error(`[cron] push failed for user ${item.user_id}: ${result.status} ${result.body}`)
      }
    } catch (e) {
      errors++
      console.error(`[cron] push threw for user ${item.user_id}:`, e.message)
    }
  })

  // The RPC already marks `last_notified_at` for all matched users atomically,
  // so no separate `mark_reminder_sent` step is needed.
  console.log(`[cron] done — sent=${sent} expired=${expired} errors=${errors}`)
  return { sent, expired, errors }
}

// ─── HTTP handlers ───────────────────────────────────────────────────────────
async function handleRequest(request, env) {
  const url = new URL(request.url)

  if (request.method === 'GET' && url.pathname === '/healthz') {
    return new Response('ok', { status: 200, headers: { 'Content-Type': 'text/plain' } })
  }

  return new Response('not found', { status: 404 })
}

// ─── Worker entrypoint ───────────────────────────────────────────────────────
export default {
  // Cron trigger — see wrangler.toml [triggers] for schedule
  async scheduled(_event, env, ctx) {
    ctx.waitUntil(handleCron(env))
  },

  // HTTP fetch
  async fetch(request, env) {
    try {
      return await handleRequest(request, env)
    } catch (e) {
      console.error('[fetch] error:', e.message)
      return new Response('internal error', { status: 500 })
    }
  },
}