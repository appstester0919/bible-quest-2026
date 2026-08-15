/**
 * POST /api/push/nudge
 *
 * Server-to-server push endpoint invoked by the `sendNudge` server action in
 * `lib/groupActions.ts`. For each enabled recipient, the action:
 *   1. Inserts a `group_nudges` row (push_delivered = false)
 *   2. POSTs here with { nudge_id, recipient_id, group_id, body }
 *
 * This route then:
 *   - Loads every active `web_push_subscriptions` row for the recipient
 *     (multi-device: a user may have phone + tablet)
 *   - Sends a web-push notification to each subscription with TTL = 1 day
 *   - On 404/410 (endpoint expired / unsubscribed) flips `active = false`
 *     via the `deactivate_web_push_subscription` RPC (same pattern as
 *     /api/push/cron-relay)
 *   - If at least one subscription delivered successfully, marks
 *     `group_nudges.push_delivered = true` for that nudge_id
 *
 * Auth: Bearer CRON_RELAY_TOKEN (same shared secret as /api/push/cron-relay).
 * Returns 401 if missing/wrong.
 *
 * Body:
 *   {
 *     nudge_id:      uuid,            // group_nudges.id (just inserted)
 *     recipient_id:  uuid,            // recipient profile
 *     group_id:      uuid | null,     // nullable cross-group recipient
 *     body:          string,          // pre-filled push body incl. [SENDER_NAME]
 *   }
 *
 * Response:
 *   { ok: true, delivered?: number, expired?: number }
 *   { ok: false, error?: string }
 */
import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─── Configure web-push with VAPID keys (per-request, idempotent, cheap) ────
// Done per request (not at module init) so missing VAPID env in local dev does
// not crash import — we surface the error as a 500 at request time instead.
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

interface NudgeRequestBody {
  nudge_id?: string
  recipient_id?: string
  group_id?: string | null
  body?: string
}

interface PushSubscriptionRow {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

export async function POST(req: NextRequest) {
  const t0 = Date.now()

  // ─── Auth ─────────────────────────────────────────────────────────────────
  // Check bearer first so a wrong/missing token always returns 401, regardless
  // of whether the token env var itself is configured. This matches the spec
  // ("return 401 if missing/wrong") and avoids leaking server-env state via
  // the response body on misconfiguration.
  const authHeader = req.headers.get('authorization') || ''
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : ''
  const expected = process.env.CRON_RELAY_TOKEN
  if (!expected || token !== expected) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  // ─── Parse + validate body ────────────────────────────────────────────────
  let parsed: NudgeRequestBody
  try {
    parsed = (await req.json()) as NudgeRequestBody
  } catch {
    return NextResponse.json(
      { ok: false, error: 'invalid JSON body' },
      { status: 400 },
    )
  }
  const { nudge_id, recipient_id, group_id, body } = parsed
  if (!nudge_id || !recipient_id || !body) {
    return NextResponse.json(
      { ok: false, error: 'missing required field (nudge_id, recipient_id, body)' },
      { status: 400 },
    )
  }

  // ─── Service-role Supabase client (bypasses RLS — cron-relay pattern) ─────
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

  // ─── Load active push subscriptions for recipient (multi-device) ──────────
  const { data: subs, error: subErr } = await supabaseAdmin
    .from('web_push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', recipient_id)
    .eq('active', true)
  if (subErr) {
    console.error('[push/nudge] load subs failed:', subErr.message)
    return NextResponse.json(
      { ok: false, error: 'failed to load subscriptions' },
      { status: 500 },
    )
  }
  if (!subs || subs.length === 0) {
    // Not an error — recipient just has no devices subscribed yet. Mark as
    // delivered=false but return 200 so the calling action stops retrying.
    console.log(
      `[push/nudge] no active subs for recipient=${recipient_id.slice(0, 8)} nudge=${nudge_id.slice(0, 8)}`,
    )
    return NextResponse.json({ ok: true, delivered: 0, expired: 0 })
  }

  // ─── Configure web-push (VAPID) ───────────────────────────────────────────
  try {
    configureWebPush()
  } catch (e: any) {
    console.error('[push/nudge] configureWebPush failed:', e?.message ?? String(e))
    return NextResponse.json(
      { ok: false, error: e?.message ?? String(e) },
      { status: 500 },
    )
  }

  // ─── Push payload — static title, dynamic body, per-nudge dedupe tag ──────
  // NOTE: public/sw.js currently IGNORES the incoming `tag` and instead
  // generates `bible-quest-${Date.now()}` so each push creates a fresh
  // notification (avoids silent dedupe on Android). The tag field is sent
  // anyway so the SW can be updated later to honor it without breaking
  // existing payload contracts.
  const payload = JSON.stringify({
    title: '📖 DuoBible',
    body,
    url: '/dashboard',
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    tag: `nudge-${nudge_id}`,
    data: {
      url: '/dashboard',
      type: 'nudge',
      nudge_id,
      recipient_id,
      group_id: group_id ?? null,
    },
  })

  // ─── Send to each subscription in parallel ────────────────────────────────
  const results = await Promise.all(
    (subs as PushSubscriptionRow[]).map(async (sub) => {
      try {
        const res = await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          payload,
          { TTL: 60 * 60 * 24 }, // 1 day — same as /api/push/send
        )
        console.log(
          `[push/nudge] ok sub=${sub.id.slice(0, 8)} recipient=${recipient_id.slice(0, 8)} status=${res.statusCode} endpoint_tail=${sub.endpoint.slice(-30)}`,
        )
        return { subscription_id: sub.id, ok: true, status: res.statusCode }
      } catch (e: any) {
        const statusCode = e?.statusCode ?? 0
        const errBody = e?.body ?? ''
        const expired = statusCode === 404 || statusCode === 410
        console.error(
          `[push/nudge] failed sub=${sub.id.slice(0, 8)} status=${statusCode} expired=${expired} body=${String(errBody).slice(0, 200)} endpoint_tail=${sub.endpoint.slice(-30)}`,
        )

        // Deactivate dead subscriptions so they don't appear in future loads.
        if (expired) {
          try {
            await supabaseAdmin.rpc('deactivate_web_push_subscription', {
              p_user_id: recipient_id,
              p_endpoint: sub.endpoint,
            })
          } catch (deactErr: any) {
            console.warn(
              `[push/nudge] deactivate failed for ${sub.endpoint.slice(-30)}: ${deactErr?.message ?? String(deactErr)}`,
            )
          }
        }
        return {
          subscription_id: sub.id,
          ok: false,
          status: statusCode,
          expired,
          error: e?.message ?? String(e),
        }
      }
    }),
  )

  const delivered = results.filter((r) => r.ok).length
  const expired = results.filter((r) => r.expired).length

  // ─── Mark nudge as delivered if at least one sub succeeded ────────────────
  if (delivered > 0) {
    const { error: updErr } = await supabaseAdmin
      .from('group_nudges')
      .update({ push_delivered: true })
      .eq('id', nudge_id)
    if (updErr) {
      // Pushes already went out — log but don't fail the request, since the
      // calling action reads the response and may re-trigger side effects.
      console.warn(
        `[push/nudge] mark delivered=true failed nudge=${nudge_id.slice(0, 8)}: ${updErr.message}`,
      )
    }
  }

  console.log(
    `[push/nudge] done nudge=${nudge_id.slice(0, 8)} recipient=${recipient_id.slice(0, 8)} delivered=${delivered} expired=${expired} duration=${Date.now() - t0}ms`,
  )

  return NextResponse.json({
    ok: true,
    delivered,
    expired,
  })
}

export async function GET() {
  return NextResponse.json({
    hint: 'POST with Authorization: Bearer <CRON_RELAY_TOKEN> and JSON {nudge_id, recipient_id, group_id, body}',
  })
}