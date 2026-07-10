'use server'

import { createClient } from '@/lib/supabase/server'

export async function markLessonComplete(
  enrollmentId: string,
  chapterRef: string,
  xpEarned: number
): Promise<{ success: boolean; sessionId?: string; error?: string; errorDetails?: unknown }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const now = new Date()
  const hktDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
  const dateLocal = hktDate.toISOString().split('T')[0]

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

  return { success: true, sessionId: insertResult?.id }
}
