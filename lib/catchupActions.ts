'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { readingDate, daysBetween } from '@/lib/readingDate'

// ============================================================================
// Catch-up actions.
//
// A plan that has silently slipped is the most common reason a reading plan
// gets abandoned. Only ONE thing here ever writes to the database: the plan's
// anchor date.
//
// Deliberately NOT done here:
//
//  - No synthetic reading_sessions rows. Marking a day "done" without a
//    chapter would inflate total_chapters_read and the streak with chapters
//    nobody read, and 'CATCHUP' placeholder refs would pollute every per-chapter
//    aggregate. The small-behind case therefore does not write at all — it
//    just deep-links the reader to the chapters they missed.
//  - No edits to existing sessions. A re-anchor is a statement about the
//    FUTURE of the plan, not a rewrite of what was read.
// ============================================================================

export type ReanchorResult =
  { ok: true; from: string; to: string } | { ok: false; error: string }

/**
 * Re-point the plan to a chosen day so the schedule recomputes from there.
 *
 * The plan is a pure function of (started_at, scope, chapters_per_day,
 * reading_order, start position). Setting started_at to the anchor date makes
 * that day's chapters become today's, and every later day follows at the
 * reader's usual daily pace.
 *
 * The missed days are left exactly as they were. They stay visible as a real
 * gap in the calendar and streak — the user chose to move on, not to claim
 * they read what they didn't.
 */
export async function reanchorPlan(
  enrollmentId: string,
  anchorDate: string,
): Promise<ReanchorResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: enrollment, error: enrollErr } = await supabase
    .from('user_plan_enrollments')
    .select('id, started_at, status')
    .eq('id', enrollmentId)
    .eq('user_id', user.id) // never re-point somebody else's plan
    .single()
  if (enrollErr || !enrollment) {
    return { ok: false, error: '找不到你的讀經計劃' }
  }

  const today = readingDate()
  const currentStart = String(enrollment.started_at).split('T')[0]

  // The anchor must be a real elapsed day of THIS plan: on or after the
  // current start (never move backwards) and strictly before today, because
  // today's chapters are still due and re-anchoring onto them would skip them.
  if (daysBetween(currentStart, anchorDate) < 0) {
    return { ok: false, error: '新的起點不能早於現有計劃的開始日' }
  }
  if (daysBetween(anchorDate, today) < 1) {
    return { ok: false, error: '新的起點必須是已經過去的日子' }
  }
  if (anchorDate === currentStart) {
    return { ok: false, error: '新的起點與現有計劃相同' }
  }

  // started_at is consumed as a DATE everywhere (the plan generator and every
  // date_local comparison), so store a clean midnight UTC. Any time-of-day on
  // the old value is not meaningful and would reintroduce an implicit cutoff.
  const { error } = await supabase
    .from('user_plan_enrollments')
    .update({ started_at: `${anchorDate}T00:00:00.000Z` })
    .eq('id', enrollmentId)
    .eq('user_id', user.id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/dashboard')
  revalidatePath('/calendar')
  revalidatePath('/read')
  return { ok: true, from: currentStart, to: anchorDate }
}
