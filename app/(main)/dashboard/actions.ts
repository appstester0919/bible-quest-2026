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

  // ── Duplicate guard (mirrors markLessonComplete in lib/actions.ts) ─────────
  // A completion event is identified by
  // (user_id, enrollment_id, date_local, chapter_ref). If that exact 4-tuple
  // already exists, this is the SAME event being recorded twice — not a new
  // completion — so it must not be inserted again.
  //
  // enrollment_id is part of the key on purpose: the same user reading the
  // same chapter on the same day under a DIFFERENT plan enrollment is a
  // legitimate, distinct event (old plan finished, new plan started).
  //
  // The DB trigger trg_dedupe_reading_session (migration 0006) enforces the
  // same rule as a backstop, but it silently drops the row — which would make
  // PostgREST fail with PGRST116. Checking first keeps the action idempotent
  // and lets us return the existing session instead of an error.
  //
  // .limit(1) is load-bearing: historical duplicates are still in production
  // (migration 0007 has not run), and a bare .maybeSingle() on a >1-row result
  // returns error PGRST116 "multiple rows returned" instead of data — which
  // used to fail the whole completion for a reader retrying a chapter that was
  // double-written before the trigger shipped. Capping at one row makes the
  // query structurally incapable of hitting that error.
  const { data: existing, error: existingError } = await supabase
    .from('reading_sessions')
    .select('id')
    .eq('user_id', user.id)
    .eq('enrollment_id', enrollmentId)
    .eq('date_local', dateLocal)
    .eq('chapter_ref', chapterRef)
    .limit(1)
    .maybeSingle()

  if (existing?.id) {
    return { success: true, sessionId: existing.id, alreadyCompleted: true }
  }

  // Guard failed for some other reason — proceed to the insert rather than
  // failing the completion. The DB trigger is still the backstop, so a real
  // duplicate cannot land; the worst case here is one dropped row, not a lost
  // completion or an error thrown at the reader.
  if (existingError) {
    console.error(
      '[markLessonComplete] duplicate-guard SELECT failed, proceeding to insert:',
      JSON.stringify(existingError),
    )
  }

  const { data: inserted, error } = await supabase
    .from('reading_sessions')
    .insert({
      user_id: user.id,
      enrollment_id: enrollmentId,
      chapter_ref: chapterRef,
      xp_earned: xpEarned,
      date_local: dateLocal,
    })
    .select('id')
    .maybeSingle()

  if (error) {
    throw new Error(error.message)
  }

  // No row came back: trg_dedupe_reading_session dropped the insert as a
  // duplicate, so this completion was already recorded by a concurrent write.
  if (!inserted?.id) {
    return { success: true, alreadyCompleted: true }
  }

  return { success: true, sessionId: inserted.id }
}
