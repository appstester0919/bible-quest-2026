/**
 * Vercel Cron — Midnight HKT streak management
 * Runs at 17:00 UTC (~01:00 HKT) to process previous day's completions.
 *
 * vercel.json: { "path": "/api/cron/streak", "schedule": "0 17 * * *" }
 */

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

const CRON_SECRET = process.env.CRON_SECRET ?? ''

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = await createClient()

  // Calculate yesterday's date in HKT (UTC+8)
  const yesterday = new Date(Date.now() - 8 * 60 * 60 * 1000)
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]

  const results = { streakFrozen: 0, streakBroken: 0, alreadyComplete: 0, error: 0 }

  // Get all active users who haven't completed yesterday
  const { data: usersWithMissedDay } = await supabase
    .from('user_stats')
    .select('user_id, current_streak, longest_streak, streak_freezes_available')
    .not('last_completed_date', 'eq', yesterdayStr)
    .gt('current_streak', 0)

  for (const record of usersWithMissedDay ?? []) {
    try {
      const freezesAvailable = record.streak_freezes_available ?? 0

      if (freezesAvailable > 0) {
        // Use a streak freeze
        await supabase
          .from('user_stats')
          .update({
            streak_freezes_available: freezesAvailable - 1,
            // last_completed_date stays as-is — streak preserved
          })
          .eq('user_id', record.user_id)
        results.streakFrozen++
      } else {
        // No freeze — break streak
        await supabase
          .from('user_stats')
          .update({
            current_streak: 0,
            longest_streak: record.longest_streak, // keep longest intact
          })
          .eq('user_id', record.user_id)
        results.streakBroken++
      }
    } catch {
      results.error++
    }
  }

  // Count users who DID complete yesterday (for logging)
  const { count: completedCount } = await supabase
    .from('user_stats')
    .select('*', { count: 'exact', head: true })
    .eq('last_completed_date', yesterdayStr)

  return NextResponse.json({
    success: true,
    processedDate: yesterdayStr,
    completedYesterday: completedCount ?? 0,
    results,
    timestamp: new Date().toISOString(),
  })
}
