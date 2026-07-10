'use server'

import { createClient } from '@/lib/supabase/server'

// ─── Date helpers (HKT-only, avoids .toISOString() UTC offset bug) ─────────────
function getHKTDateStr(date: Date = new Date()): string {
  // en-CA with HKT gives YYYY-MM-DD directly in Hong Kong time
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
}

export async function markLessonComplete(
  enrollmentId: string,
  chapterRef: string,
  xpEarned: number,
  dateLocalOverride?: string
): Promise<{ success: boolean; sessionId?: string; error?: string; errorDetails?: unknown }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const now = new Date()
  // FIX: use en-CA+HKT to get YYYY-MM-DD directly — no UTC offset issue
  const dateLocal = dateLocalOverride || getHKTDateStr(now)

  console.log('[markLessonComplete]', { user_id: user.id, enrollment_id: enrollmentId, chapter_ref: chapterRef, xp_earned: xpEarned, date_local: dateLocal })

  // Parse "創 1" or "太 2:1" → book_zh="創", chapter=1
  const parts = chapterRef.trim().split(/\s+/)
  const book_zh = parts[0] || '創'
  const chapterRaw = parts[1] || '1'
  const chapter = parseInt(chapterRaw.replace(/[^0-9]/g, ''), 10) || 1

  const { data: insertResult, error } = await supabase
    .from('reading_sessions')
    .insert({
      user_id: user.id,
      enrollment_id: enrollmentId,
      chapter_ref: chapterRef,
      xp_earned: xpEarned,
      date_local: dateLocal,
      day_number: 1,
      book_zh,
      chapter,
    })
    .select()
    .single()

  if (error) {
    console.error('[markLessonComplete] INSERT failed:', JSON.stringify(error))
    return { success: false, error: error.message, errorDetails: error }
  }

  console.log('[markLessonComplete] INSERT ok, sessionId:', insertResult?.id)

  // Get all unique dates for this user (sorted ascending)
  const { data: allSessions } = await supabase
    .from('reading_sessions')
    .select('date_local')
    .eq('user_id', user.id)
    .order('date_local', { ascending: true })

  const uniqueDates = [...new Set((allSessions ?? []).map(r => r.date_local))].sort()

  // Determine today / yesterday in HKT for streak calculation
  const todayStr = getHKTDateStr()
  const todayHKT = new Date(new Date().toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong' }))
  const yesterdayStr = getHKTDateStr(new Date(todayHKT.getTime() - 86400000))

  // Calculate current streak:
  // 1. Find the LAST date in uniqueDates that is ≤ today (skip future outliers like "tomorrow")
  // 2. If that date is today or yesterday, count backwards through consecutive dates
  // 3. If the last date is older than yesterday, streak = 0 (broken chain)
  let streak = 0
  if (uniqueDates.length > 0) {
    // Find the last date that is not in the future
    let lastValidIdx = uniqueDates.length - 1
    for (let i = uniqueDates.length - 1; i >= 0; i--) {
      if (uniqueDates[i] <= todayStr) {
        lastValidIdx = i
        break
      }
    }
    const lastDate = uniqueDates[lastValidIdx]
    if (lastDate === todayStr || lastDate === yesterdayStr) {
      streak = 1
      for (let i = lastValidIdx - 1; i >= 0; i--) {
        const curr = new Date(uniqueDates[i + 1])
        const prev = new Date(uniqueDates[i])
        const diffDays = Math.round((curr.getTime() - prev.getTime()) / 86400000)
        if (diffDays === 1) streak++
        else break
      }
    }
  }

  const totalXp = uniqueDates.length * 10
  const level = Math.floor(Math.sqrt(totalXp / 100)) + 1

  // Find longest streak across all time
  let longestStreak = streak
  let currentRun = 1
  for (let i = 1; i < uniqueDates.length; i++) {
    const currDate = new Date(uniqueDates[i])
    const prevDate = new Date(uniqueDates[i - 1])
    const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / 86400000)
    if (diffDays === 1) {
      currentRun++
      longestStreak = Math.max(longestStreak, currentRun)
    } else {
      currentRun = 1
    }
  }

  const { error: statsError } = await supabase
    .from('user_stats')
    .update({
      total_xp: totalXp,
      level,
      current_streak: streak,
      longest_streak: Math.max(longestStreak, streak),
      last_completed_date: uniqueDates.length > 0 ? uniqueDates[uniqueDates.length - 1] : null,
    })
    .eq('user_id', user.id)

  if (statsError) {
    console.error('[markLessonComplete] stats update failed:', JSON.stringify(statsError))
  } else {
    console.log('[markLessonComplete] user_stats updated:', {
      total_xp: totalXp, level, streak, longestStreak,
      uniqueDates, lastDate: uniqueDates[uniqueDates.length - 1],
      todayStr, yesterdayStr
    })
  }

  // Sync group check-ins (so all groups user is in show today's progress)
  try {
    const { data: memberships } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', user.id)
    if (memberships && memberships.length > 0) {
      const rows = memberships.map(m => ({
        group_id: m.group_id,
        user_id: user.id,
        date_local: dateLocal,
      }))
      // Upsert with conflict on (group_id, user_id, date_local) PRIMARY KEY
      await supabase
        .from('group_checkins')
        .upsert(rows, { onConflict: 'group_id,user_id,date_local' })
      console.log('[markLessonComplete] group_checkins upserted for', rows.length, 'groups')
    }
  } catch (grpErr) {
    console.error('[markLessonComplete] group_checkins sync failed:', JSON.stringify(grpErr))
    // non-fatal — user_stats and reading_sessions are primary; group check-in is secondary
  }

  return { success: true, sessionId: insertResult?.id }
}

/**
 * Undo a day's reading completion.
 * Deletes ALL reading_sessions for this enrollment on this date,
 * then recalculates user_stats from scratch (XP, streak, level).
 */
export async function unmarkDayComplete(
  enrollmentId: string,
  dateLocal: string
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  console.log('[unmarkDayComplete]', { enrollment_id: enrollmentId, date_local: dateLocal, user_id: user.id })

  // 1. Delete all sessions for this enrollment on this date
  const { error: deleteError } = await supabase
    .from('reading_sessions')
    .delete()
    .eq('enrollment_id', enrollmentId)
    .eq('date_local', dateLocal)

  if (deleteError) {
    console.error('[unmarkDayComplete] DELETE failed:', JSON.stringify(deleteError))
    return { success: false, error: deleteError.message }
  }

  console.log('[unmarkDayComplete] DELETE ok')

  // 2. Recalculate user_stats from remaining sessions
  const { data: remaining, error: fetchError } = await supabase
    .from('reading_sessions')
    .select('date_local, xp_earned')
    .eq('user_id', user.id)
    .order('date_local', { ascending: true })

  if (fetchError) {
    console.error('[unmarkDayComplete] fetch for recalc failed:', JSON.stringify(fetchError))
    return { success: false, error: fetchError.message }
  }

  // Collect unique completion dates in order
  const uniqueDates = [...new Set((remaining ?? []).map(r => r.date_local))].sort()

  // Calculate streak — FIX: use en-CA+HKT throughout
  const todayStr = getHKTDateStr()
  const todayHKT = new Date(new Date().toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong' }))
  const yesterdayStr = getHKTDateStr(new Date(todayHKT.getTime() - 86400000))

  let streak = 0
  if (uniqueDates.length > 0) {
    const lastDate = uniqueDates[uniqueDates.length - 1]
    if (lastDate === todayStr || lastDate === yesterdayStr) {
      streak = 1
      for (let i = uniqueDates.length - 2; i >= 0; i--) {
        const prev = new Date(uniqueDates[i + 1])
        const curr = new Date(uniqueDates[i])
        const diffDays = (prev.getTime() - curr.getTime()) / 86400000
        if (diffDays === 1) {
          streak++
        } else {
          break
        }
      }
    }
  }

  // XP = number of unique days completed * 10
  const totalXp = uniqueDates.length * 10
  const level = Math.floor(Math.sqrt(totalXp / 100)) + 1

  console.log('[unmarkDayComplete] recalculated:', { uniqueDates, streak, totalXp, level, todayStr, yesterdayStr })

  // Find longest streak
  let longestStreak = streak
  let currentRun = 1
  for (let i = 1; i < uniqueDates.length; i++) {
    const prev = new Date(uniqueDates[i - 1])
    const curr = new Date(uniqueDates[i])
    const diffDays = (curr.getTime() - prev.getTime()) / 86400000
    if (diffDays === 1) {
      currentRun++
      longestStreak = Math.max(longestStreak, currentRun)
    } else {
      currentRun = 1
    }
  }

  // Update user_stats
  const { error: updateError } = await supabase
    .from('user_stats')
    .update({
      total_xp: totalXp,
      level,
      current_streak: streak,
      longest_streak: Math.max(longestStreak, streak),
      last_completed_date: uniqueDates.length > 0 ? uniqueDates[uniqueDates.length - 1] : null,
    })
    .eq('user_id', user.id)

  if (updateError) {
    console.error('[unmarkDayComplete] stats update failed:', JSON.stringify(updateError))
    return { success: false, error: updateError.message }
  }

  console.log('[unmarkDayComplete] stats updated ok')

  // Also remove today's group check-ins (since user un-completed today's reading, all group check-ins for today are undone)
  try {
    const { error: grpErr } = await supabase
      .from('group_checkins')
      .delete()
      .eq('user_id', user.id)
      .eq('date_local', dateLocal)
    if (grpErr) {
      console.error('[unmarkDayComplete] group_checkins delete failed:', JSON.stringify(grpErr))
    } else {
      console.log('[unmarkDayComplete] group_checkins removed for date', dateLocal)
    }
  } catch (e) {
    console.error('[unmarkDayComplete] group cleanup error:', e)
  }

  return { success: true }
}
