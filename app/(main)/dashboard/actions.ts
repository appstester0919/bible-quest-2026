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
  
  // Get current date in Asia/Hong_Kong timezone
  const now = new Date()
  const hktDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
  const dateLocal = hktDate.toISOString().split('T')[0]
  
  const { error } = await supabase.from('reading_sessions').insert({
    user_id: user.id,
    enrollment_id: enrollmentId,
    chapter_ref: chapterRef,
    xp_earned: xpEarned,
    date_local: dateLocal,
  })
  
  if (error) {
    throw new Error(error.message)
  }
  
  return { success: true }
}
