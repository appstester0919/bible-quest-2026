'use server'

import { createClient } from '@/lib/supabase/server'

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
  const hktDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
  const dateLocal = dateLocalOverride || hktDate.toISOString().split('T')[0]

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

  // Calculate current streak: count consecutive days ending at today or yesterday
  const todayHK = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
  const todayStr = todayHK.toISOString().split('T')[0]
  const yesterdayDate = new Date(todayHK.getTime() - 86400000)
  const yesterdayStr = yesterdayDate.toISOString().split('T')[0]

  let streak = 0
  if (uniqueDates.length > 0) {
    const lastDate = uniqueDates[uniqueDates.length - 1]
    // Streak is active only if last completion was today or yesterday
    if (lastDate === todayStr || lastDate === yesterdayStr) {
      streak = 1
      // Count backwards from the last date
      for (let i = uniqueDates.length - 2; i >= 0; i--) {
        const currDate = new Date(uniqueDates[i + 1])
        const prevDate = new Date(uniqueDates[i])
        const diffDays = Math.round((currDate.getTime() - prevDate.getTime()) / 86400000)
        if (diffDays === 1) streak++
        else break
      }
    }
    // If lastDate is older than yesterday, streak = 0 (broken chain)
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
  // Get all remaining sessions for this user (ordered by date)
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

  // Calculate streak
  const today = new Date()
  const todayHK = new Date(today.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
  const todayStr = todayHK.toISOString().split('T')[0]
  const yesterdayStr = new Date(todayHK.getTime() - 86400000).toISOString().split('T')[0]

  let streak = 0
  if (uniqueDates.length > 0) {
    const lastDate = uniqueDates[uniqueDates.length - 1]
    if (lastDate === todayStr || lastDate === yesterdayStr) {
      // Streak is active
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

  console.log('[unmarkDayComplete] recalculated:', { uniqueDates, streak, totalXp, level })

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
  return { success: true }
}
