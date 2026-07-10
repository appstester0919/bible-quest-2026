'use server'

import { createClient } from '@/lib/supabase/server'

export async function markLessonComplete(
  enrollmentId: string,
  chapterRef: string,
  xpEarned: number
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Not authenticated')
  }

  const now = new Date()
  const hktDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
  const dateLocal = hktDate.toISOString().split('T')[0]

  console.log('[markLessonComplete] attempting insert', {
    user_id: user.id,
    enrollment_id: enrollmentId,
    chapter_ref: chapterRef,
    xp_earned: xpEarned,
    date_local: dateLocal,
  })

  const { data: insertResult, error } = await supabase
    .from('reading_sessions')
    .insert({
      user_id: user.id,
      enrollment_id: enrollmentId,
      chapter_ref: chapterRef,
      xp_earned: xpEarned,
      date_local: dateLocal,
    })
    .select()
    .single()

  if (error) {
    console.error('[markLessonComplete] INSERT failed:', error)
    throw new Error(error.message)
  }

  console.log('[markLessonComplete] INSERT succeeded, returned:', insertResult)

  // Verify: check user_stats row for this user
  const { data: stats, error: statsError } = await supabase
    .from('user_stats')
    .select('user_id, current_streak, total_xp, level')
    .eq('user_id', user.id)
    .maybeSingle()

  console.log('[markLessonComplete] user_stats after insert:', { stats, statsError })

  return { success: true, sessionId: insertResult?.id }
}
