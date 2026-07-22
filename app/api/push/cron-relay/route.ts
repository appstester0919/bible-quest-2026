/**
 * POST /api/push/cron-relay
 *
 * Cron-relay endpoint. Polled every 15 minutes by GitHub Actions
 * (.github/workflows/cron-push.yml) instead of by a Cloudflare Worker
 * scheduled trigger. The original Cloudflare Worker approach was abandoned
 * because the Worker runtime (unenv) does not implement
 * `crypto.createECDH`, and our self-rolled RFC 8291 encryption produced
 * ciphertext that Chrome's Service Worker could not decrypt despite
 * matching RFC text — FCM accepted the pushes (HTTP 201) but they were
 * silently dropped at the SW layer.
 *
 * This route uses the same `web-push` npm package as the manual
 * /api/push/send route, so the encryption behavior is identical and proven
 * to deliver. The split is now:
 *
 *   ┌─────────────────────────────┐    ┌──────────────────────────────┐
 *   │  GitHub Actions (cron 15m)  │ ── │  Vercel /api/push/cron-relay │
 *   │  - cheap scheduling         │    │  - service-role RPC          │
 *   │  - GH UI shows run logs     │ ── │  - web-push lib (same as     │
 *   │  - runs on ubuntu-latest    │    │    /api/push/send)           │
 *   │  - sends POST + bearer      │    │  - logs stdout to Vercel     │
 *   └─────────────────────────────┘    └──────────────────────────────┘
 *
 * Auth: requires the `CRON_RELAY_TOKEN` env var on Vercel. The GH
 * workflow passes it as `Authorization: Bearer <token>`.
 *
 * Body (optional):
 *   { "limit"?: number }  — cap due-row batch size (default 200).
 *
 * Returns: { ok, attempted, sent, expired, errors, due_count, results }
 */
import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── Configure web-push with VAPID keys (idempotent; cheap) ─────────────────
function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:laikaho0919@gmail.com'
  if (!publicKey || !privateKey) {
    throw new Error(
      'VAPID keys missing. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY on Vercel.',
    )
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
}

// Daily reminder payload — same as /api/push/send so we have one source of truth
// for the user-visible copy. (Push handler in public/sw.js expects {title, body,
// icon, badge, url?, tag?}.)
const REMINDER_PAYLOAD = JSON.stringify({
  title: '今日讀經時間',
  body: '今日嘅讀經已準備好喇，繼續保持 streak！',
  url: '/dashboard',
  icon: '/icons/icon-192.png',
  badge: '/icons/icon-192.png',
  tag: 'bq-daily-dashboard',
})

export async function POST(req: NextRequest) {
  const t0 = Date.now()

  // ─── Auth ─────────────────────────────────────────────────────────────────
  const expected = process.env.CRON_RELAY_TOKEN
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: 'CRON_RELAY_TOKEN env var not set on server' },
      { status: 500 },
    )
  }
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (token !== expected) {
    return NextResponse.json(
      { ok: false, error: 'unauthorized' },
      { status: 401 },
    )
  }

  // Optional { limit } in body
  let limit = 200
  try {
    const body = await req.json()
    if (typeof body.limit === 'number' && body.limit > 0 && body.limit < 1000) {
      limit = body.limit
    }
  } catch {
    // empty body is fine
  }

  // ─── Service-role Supabase client (bypasses RLS; can read all subs) ───────
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) {
    return NextResponse.json(
      { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY or URL not set on server' },
      { status: 500 },
    )
  }
  const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  // ─── Query due reminders (RPC auto-marks last_notified_at) ────────────────
  let due: Array<{
    user_id: string
    subscription_id: string
    endpoint: string
    p256dh: string
    auth: string
  }> = []
  try {
    const { data, error } = await supabaseAdmin.rpc('process_due_reminders', {
      p_now: new Date().toISOString(),
    })
    if (error) {
      console.error('[cron-relay] process_due_reminders RPC failed:', error.message)
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }
    due = (data || []).slice(0, limit)
    console.log(
      `[cron-relay] rpc returned ${(data || []).length} rows; processing first ${due.length}`,
    )
  } catch (e: any) {
    console.error('[cron-relay] rpc threw:', e?.message ?? String(e))
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 },
    )
  }

  if (due.length === 0) {
    console.log('[cron-relay] no due reminders (this 15-min window is empty)')
    return NextResponse.json({
      ok: true,
      attempted: 0,
      sent: 0,
      expired: 0,
      errors: 0,
      due_count: 0,
      duration_ms: Date.now() - t0,
      results: [],
    })
  }

  // ─── Send pushes with web-push lib (same code path as /api/push/send) ──────
  try {
    configureWebPush()
  } catch (e: any) {
    console.error('[cron-relay] configureWebPush failed:', e?.message ?? String(e))
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 },
    )
  }

  const results = await Promise.all(
    due.map(async (sub) => {
      try {
        const res = await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          REMINDER_PAYLOAD,
          { TTL: 60 * 60 * 24 },
        )
        console.log(
          `[cron-relay] ok sub=${sub.subscription_id.slice(0, 8)} status=${res.statusCode} endpoint_tail=${sub.endpoint.slice(-30)}`,
        )
        return {
          subscription_id: sub.subscription_id,
          user_id: sub.user_id,
          ok: true,
          status: res.statusCode,
        }
      } catch (e: any) {
        const statusCode = e?.statusCode ?? 0
        const body = e?.body ?? ''
        const expired = statusCode === 404 || statusCode === 410
        console.error(
          `[cron-relay] failed sub=${sub.subscription_id.slice(0, 8)} status=${statusCode} expired=${expired} body=${String(body).slice(0, 200)} endpoint_tail=${sub.endpoint.slice(-30)}`,
        )

        // Deactivate dead subscriptions so they don't show up in future due lists.
        if (expired) {
          try {
            await supabaseAdmin.rpc('deactivate_web_push_subscription', {
              p_user_id: sub.user_id,
              p_endpoint: sub.endpoint,
            })
          } catch (deactErr: any) {
            console.warn(
              `[cron-relay] deactivate failed for ${sub.endpoint}: ${deactErr?.message ?? String(deactErr)}`,
            )
          }
        }
        return {
          subscription_id: sub.subscription_id,
          user_id: sub.user_id,
          ok: false,
          status: statusCode,
          expired,
          error: e?.message ?? String(e),
        }
      }
    }),
  )

  const sent = results.filter((r) => r.ok).length
  const expired = results.filter((r) => r.expired).length
  const errors = results.filter((r) => !r.ok && !r.expired).length

  const summary = {
    ok: true,
    attempted: due.length,
    sent,
    expired,
    errors,
    due_count: due.length,
    duration_ms: Date.now() - t0,
    results,
  }
  console.log(
    `[cron-relay] done sent=${sent} expired=${expired} errors=${errors} duration=${summary.duration_ms}ms`,
  )
  return NextResponse.json(summary)
}

export async function GET() {
  return NextResponse.json({
    hint: 'POST with Authorization: Bearer <CRON_RELAY_TOKEN>',
  })
}
