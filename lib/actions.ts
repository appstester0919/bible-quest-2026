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

  return { success: true, sessionId: insertResult?.id }
}

/**
 * Recalculate user_stats after one or more chapters are inserted in a batch.
 * Call this ONCE after all markLessonComplete calls are done — NOT inside each one.
 */
export async function recalcUserStatsAfterCompletion(dateLocal: string): Promise<{
  success: boolean
  totalXp: number
  level: number
  currentStreak: number
  longestStreak: number
  error?: string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, totalXp: 0, level: 0, currentStreak: 0, longestStreak: 0, error: 'Not authenticated' }

  const { data: allSessions } = await supabase
    .from('reading_sessions')
    .select('date_local')
    .eq('user_id', user.id)
    .order('date_local', { ascending: true })

  const uniqueDates = [...new Set((allSessions ?? []).map(r => r.date_local))].sort()

  const todayStr = getHKTDateStr()
  const todayHKT = new Date(new Date().toLocaleString('en-CA', { timeZone: 'Asia/Hong_Kong' }))
  const yesterdayStr = getHKTDateStr(new Date(todayHKT.getTime() - 86400000))

  let streak = 0
  if (uniqueDates.length > 0) {
    let lastValidIdx = uniqueDates.length - 1
    for (let i = uniqueDates.length - 1; i >= 0; i--) {
      if (uniqueDates[i] <= todayStr) { lastValidIdx = i; break }
    }
    const lastDate = uniqueDates[lastValidIdx]
    if (lastDate === todayStr || lastDate === yesterdayStr) {
      streak = 1
      for (let i = lastValidIdx - 1; i >= 0; i--) {
        const diffDays = Math.round((new Date(uniqueDates[i + 1]).getTime() - new Date(uniqueDates[i]).getTime()) / 86400000)
        if (diffDays === 1) streak++
        else break
      }
    }
  }

  const totalXp = uniqueDates.length * 10
  const level = Math.floor(Math.sqrt(totalXp / 100)) + 1

  let longestStreak = streak
  let currentRun = 1
  for (let i = 1; i < uniqueDates.length; i++) {
    const diffDays = Math.round((new Date(uniqueDates[i]).getTime() - new Date(uniqueDates[i - 1]).getTime()) / 86400000)
    if (diffDays === 1) { currentRun++; longestStreak = Math.max(longestStreak, currentRun) }
    else currentRun = 1
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
    console.error('[recalcUserStatsAfterCompletion] stats update failed:', statsError)
    return { success: false, totalXp, level, currentStreak: streak, longestStreak, error: statsError.message }
  }

  console.log('[recalcUserStatsAfterCompletion] ok:', { totalXp, level, streak, longestStreak })
  return { success: true, totalXp, level, currentStreak: streak, longestStreak }
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

/**
 * Mark a plan enrollment as completed.
 * Called when user finishes all days in a plan.
 */
export async function markPlanComplete(enrollmentId: string): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }

  // Update enrollment status
  const { error: enrollError } = await supabase
    .from('user_plan_enrollments')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', enrollmentId)
    .eq('user_id', user.id)
    .eq('status', 'active')

  if (enrollError) {
    console.error('[markPlanComplete] enrollment update failed:', enrollError)
    return { success: false, error: enrollError.message }
  }

  // Increment completed_plans in user_stats
  const { data: stats } = await supabase
    .from('user_stats').select('completed_plans').eq('user_id', user.id).single()

  const newCount = (stats?.completed_plans ?? 0) + 1
  const { error: statsError } = await supabase
    .from('user_stats')
    .update({ completed_plans: newCount })
    .eq('user_id', user.id)

  if (statsError) {
    console.error('[markPlanComplete] stats update failed:', statsError)
  }

  return { success: true }
}
