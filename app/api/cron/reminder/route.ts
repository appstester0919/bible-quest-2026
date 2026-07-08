/**
 * Vercel Cron — Daily reading reminder push notification
 * Runs at 21:00 HKT (13:00 UTC) daily.
 *
 * Setup in vercel.json:
 * { "crons": [{ "path": "/api/cron/reminder", "schedule": "0 13 * * *" }] }
 *
 * Security: verify CRON_SECRET header from Vercel.
 */

import { NextRequest, NextResponse } from 'next/server'
import webpush from 'web-push'
import { createClient } from '@/lib/supabase/server'

// VAPID keys — generate with: npx web-push generate-vapid-keys
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY ?? ''
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY ?? ''
const VAPID_SUBJECT = process.env.VAPID_SUBJECT ?? 'mailto:admin@bible-quest.app'

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
}

export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this header)
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()

  // Find users who haven't completed today's reading
  const today = new Date().toISOString().split('T')[0]

  // Get reminder times for users who have subscriptions
  const { data: usersToRemind } = await supabase
    .from('user_stats')
    .select(`
      user_id,
      profiles!user_id (
        display_name,
        reminder_time
      ),
      push_subscriptions (
        endpoint,
        p256dh,
        auth
      )
    `)
    .neq('last_completed_date', today)

  const results = { sent: 0, failed: 0, noSubscription: 0 }

  for (const record of usersToRemind ?? []) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const user = record as any
    const subscriptions = user.push_subscriptions as Array<{ endpoint: string; p256dh: string; auth: string }> | null

    if (!subscriptions || subscriptions.length === 0) {
      results.noSubscription++
      continue
    }

    const displayName = user.profiles?.display_name ?? '你'

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth },
          },
          JSON.stringify({
            title: '📖 讀經時間到了！',
            body: `今日仲未完成讀經呀 ${displayName}，快啲去讀啦！`,
            url: '/dashboard',
          })
        )
        results.sent++
      } catch {
        results.failed++
      }
    }
  }

  return NextResponse.json({
    success: true,
    date: today,
    results,
    timestamp: new Date().toISOString(),
  })
}
