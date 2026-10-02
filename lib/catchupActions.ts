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
  | { ok: true; from: string; to: string; from_ref: string }
  | { ok: false; error: string }

/** 0-based index of 馬太福音 — the first NT book. */
const NT_FIRST_BOOK_INDEX = 39

/**
 * Re-point the plan to a chosen day so the schedule recomputes from there,
 * starting at the chapter that day was supposed to read.
 *
 * BOTH parts matter, and missing the second one was a real bug:
 *
 *  1. `started_at` moves to the anchor date, so that day's chapters become
 *     today's and every later day follows at the reader's usual pace.
 *  2. The start POSITION (`*_start_book_index` / `*_start_chapter`) moves to
 *     the anchor day's first chapter. Moving only the date left the position
 *     at the reader's original pick, so re-anchoring to 5/9 still began at
 *     詩篇 51 — the dashboard promised 哥林多前 7 and served 詩篇 51.
 *
 * The position is computed on the client (which already holds the 4.2 MB
 * bible index) and passed in; it is re-validated here because a client-supplied
 * book index must never be trusted to write straight through.
 *
 * The missed days are left exactly as they were. They stay visible as a real
 * gap in the calendar and streak — the user chose to move on, not to claim
 * they read what they didn't.
 */
export async function reanchorPlan(
  enrollmentId: string,
  anchorDate: string,
  startBookIndex: number,
  startChapter: number,
): Promise<ReanchorResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) throw new Error('Not authenticated')

  const { data: enrollment, error: enrollErr } = await supabase
    .from('user_plan_enrollments')
    .select('id, started_at, status, scope, reading_order')
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

  // Validate the client-supplied start position. Canonical index is 0–65
  // (創=0 … 啟=65) and a chapter is a plain positive integer; anything else is
  // a corrupt or hostile payload and is rejected rather than clamped.
  if (
    !Number.isInteger(startBookIndex) ||
    startBookIndex < 0 ||
    startBookIndex > 65 ||
    !Number.isInteger(startChapter) ||
    startChapter < 1 ||
    startChapter > 150
  ) {
    return { ok: false, error: '新的起點位置無效' }
  }

  // The plan generator reads a DIFFERENT column depending on scope and order,
  // so the position has to be written to every column the current enrollment
  // could consult. Writing the same (book, chapter) to all of them is safe:
  // only the one that matches the enrollment's own scope/order is ever read,
  // and leaving the others stale would resurrect the old bug the next time the
  // reader changes scope in settings.
  const isParallel = /^\d+-\d+$/.test(enrollment.reading_order ?? '')
  const isSequential =
    enrollment.reading_order === 'nt_then_ot' ||
    enrollment.reading_order === 'ot_then_nt'

  const patch: Record<string, unknown> = {
    started_at: `${anchorDate}T00:00:00.000Z`,
    start_book_index: startBookIndex,
    start_chapter: startChapter,
  }
  // Per-testament columns exist for nt_ot (migrations 010/013) and are ignored
  // for single-testament scopes, so always keep them in sync with the anchor.
  if (enrollment.scope === 'nt_ot' || isParallel || isSequential) {
    if (startBookIndex >= NT_FIRST_BOOK_INDEX) {
      patch.nt_start_book_index = startBookIndex
      patch.nt_start_chapter = startChapter
    } else {
      patch.ot_start_book_index = startBookIndex
      patch.ot_start_chapter = startChapter
    }
  }

  const { error } = await supabase
    .from('user_plan_enrollments')
    .update(patch)
    .eq('id', enrollmentId)
    .eq('user_id', user.id)
  if (error) return { ok: false, error: error.message }

  revalidatePath('/dashboard')
  revalidatePath('/calendar')
  revalidatePath('/read')
  return {
    ok: true,
    from: currentStart,
    to: anchorDate,
    from_ref: `${startBookIndex}:${startChapter}`,
  }
}
