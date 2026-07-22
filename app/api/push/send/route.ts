/**
 * POST /api/push/send
 *
 * Manually triggers a push notification to the authenticated user's active
 * subscriptions. Same payload as the cron-triggered daily reminder.
 *
 * Why this exists alongside the Cloudflare Worker /trigger-push endpoint:
 *   - Workers.dev is occasionally blocked by mobile carriers / privacy VPNs
 *     in some regions. This route runs on the same origin as the PWA, so
 *     the browser's fetch() always succeeds.
 *   - The cron (15-minute reminders) still lives in the Cloudflare Worker
 *     since Vercel cron requires a paid plan.
 *
 * Body (optional):
 *   { "subscription_id"?: string }   — push to one specific device
 *
 * Auth: requires a valid Supabase auth Bearer JWT in the Authorization
 * header. Returns the per-subscription FCM results.
 */
import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── Configure web-push with our VAPID keys (only used at request time) ────
function configureWebPush() {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY
  const privateKey = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT || 'mailto:laikaho0919@gmail.com'
  if (!publicKey || !privateKey) {
    throw new Error(
      'VAPID keys missing. Set NEXT_PUBLIC_VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY.',
    )
  }
  webpush.setVapidDetails(subject, publicKey, privateKey)
}

const REMINDER_PAYLOAD = JSON.stringify({
  title: '今日讀經時間',
  body: '今日嘅讀經已準備好喇，繼續保持 streak！',
  url: '/dashboard',
  icon: '/icons/icon-192.png',
  badge: '/icons/icon-192.png',
})

export async function POST(req: NextRequest) {
  // ─── Auth ─────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  if (!jwt) {
    return NextResponse.json({ error: 'missing Authorization bearer' }, { status: 401 })
  }

  // Use anon-key client but pass the user's JWT in the Authorization header
  // so PostgREST evaluates RLS policies (auth.uid() = user_id) and the user
  // can only see their own subscriptions. This works without needing the
  // Supabase service-role key on the Vercel server.
  const supabaseUser = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    },
  )

  // ─── Parse optional body ──────────────────────────────────────────────────
  let body: { subscription_id?: string } = {}
  try {
    body = await req.json()
  } catch {
    // empty body is fine
  }

  // ─── Load active subscriptions for this user ──────────────────────────────
  let q = supabaseUser
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('active', true)
  if (body.subscription_id) q = q.eq('id', body.subscription_id)
  const { data: subs, error: subErr } = await q
  if (subErr) {
    return NextResponse.json({ error: 'failed to load subs', detail: subErr.message }, { status: 500 })
  }
  if (!subs || subs.length === 0) {
    return NextResponse.json(
      { error: 'no active subscriptions for this user', subscription_id: body.subscription_id ?? null },
      { status: 404 },
    )
  }

  // ─── Send push to each subscription in parallel ───────────────────────────
  try {
    configureWebPush()
  } catch (e) {
    console.error('[push/send] configureWebPush failed:', (e as Error).message)
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  const results = await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          REMINDER_PAYLOAD,
          { TTL: 60 * 60 * 24 },
        )
        console.log('[push/send] ok for', sub.id)
        return { subscription_id: sub.id, ok: true, status: 201 }
      } catch (e: any) {
        const statusCode = e?.statusCode ?? 0
        const body = e?.body ?? ''
        const headers = e?.headers ?? {}
        console.error('[push/send] failed for', sub.id, 'status=', statusCode, 'body=', String(body).slice(0, 500), 'endpoint_tail=', sub.endpoint.slice(-30))
        return {
          subscription_id: sub.id,
          ok: false,
          status: statusCode,
          expired: statusCode === 404 || statusCode === 410,
          error: e?.message ?? String(e),
          body: String(body).slice(0, 300),
        }
      }
    }),
  )

  return NextResponse.json({ attempted: subs.length, results })
}

export async function GET() {
  return NextResponse.json({ hint: 'POST with Authorization: Bearer <supabase_jwt>' })
}