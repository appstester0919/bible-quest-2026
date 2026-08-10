/**
 * GET /api/push/debug
 *
 * Diagnostic endpoint for the push pipeline. Returns the state of every
 * active push subscription so we can answer "why didn't reminder X fire?"
 * without guesswork.
 *
 * Auth: requires the same CRON_RELAY_TOKEN env var (set on Vercel). This
 * routes internal-team/cron traffic, not end-user traffic.
 *
 * Query params:
 *   ?user_id=<uuid>  — only return that user's rows
 *   ?all=true        — return all users (default: only subscriptions that
 *                      have a non-NULL last_notified_at OR are active+enabled)
 *
 * Response: { ok, count, rows: [...], now_utc, now_hkt }
 */
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
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
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  // ─── Service-role Supabase client ─────────────────────────────────────────
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

  // ─── Build query ──────────────────────────────────────────────────────────
  const userId = req.nextUrl.searchParams.get('user_id')
  const showAll = req.nextUrl.searchParams.get('all') === 'true'

  let q = supabaseAdmin
    .from('web_push_subscriptions')
    .select(
      'id, user_id, endpoint, active, enabled_reminder, reminder_hour, reminder_minute, timezone, last_notified_at, completed_at, created_at, updated_at',
    )
    .order('updated_at', { ascending: false })
    .limit(50)
  if (!showAll) {
    q = q.eq('active', true).eq('enabled_reminder', true)
  }
  if (userId) {
    q = q.eq('user_id', userId)
  }

  const { data: rows, error } = await q
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  // Compute HKT and current-bucket for the SQL reminder match logic
  const now = new Date()
  const nowHkt = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
  const currentHourHkt = nowHkt.getHours()
  const currentBucket = Math.floor(nowHkt.getMinutes() / 15)

  return NextResponse.json({
    ok: true,
    count: rows?.length ?? 0,
    now_utc: now.toISOString(),
    now_hkt: nowHkt.toISOString(),
    current_hkt_hour: currentHourHkt,
    current_hkt_minute_bucket: currentBucket,
    rows: rows ?? [],
  })
}
