'use server'

import { createClient } from '@/lib/supabase/server'
import { readingDate } from '@/lib/readingDate'

export async function markLessonComplete(
  enrollmentId: string,
  chapterRef: string,
  xpEarned: number,
) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    throw new Error('Not authenticated')
  }

  // Reading date, NOT wall-clock date. Uses the shared 05:00 HKT cutoff so a
  // session finished around 02:00–04:00 records as the previous day, matching
  // how a night-owl reader counts their own days.
  //
  // This replaces an earlier HKT→UTC round-trip:
  //   new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
  //     .toISOString().split('T')[0]
  // which converted to HKT and then straight back to UTC, silently rolling
  // the date back 8 hours (an implicit 08:00 cutoff). Meanwhile the read page
  // looked the session up with no cutoff at all, so a lesson completed at 02:00
  // was WRITTEN as the previous day but READ as the current one — the page
  // searched for a date_local that could never exist and showed a finished
  // lesson as unfinished.
  const dateLocal = readingDate()

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
