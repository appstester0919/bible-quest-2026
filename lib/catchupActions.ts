'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { readingDate, daysBetween } from '@/lib/readingDate'
import type { AnchorPosition, AnchorPositions } from './readingProgress'
import {
  reanchoredEnrollment,
  FINISHED_BOOK_INDEX,
  FINISHED_BOOK_INDEX_LEGACY,
} from '@/lib/readingProgress'

/**
 * Final chapter of each testament's last book: the in-range spelling of
 * 「finished」. Canonical counts verified against public/bible-data.json —
 * 啟示錄 has 22 chapters, 瑪拉基 has 4.
 */
const LAST_NT_CHAPTER = 22
const LAST_OT_CHAPTER = 4

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
  | {
      ok: true
      from: string
      to: string
      anchor_date: string
      from_ref: string
    }
  | { ok: false; error: string }

/** 0-based index of 馬太福音 — the first NT book. */
const NT_FIRST_BOOK_INDEX = 39

/**
 * A client-supplied start position, checked again on the server. Canonical
 * index is 0–65 (創=0 … 啟=65) and a chapter is a plain positive integer;
 * anything else is a corrupt or hostile payload and is rejected, not clamped.
 */
function isValidAnchorPosition(pos: AnchorPosition | null): boolean {
  if (!pos) return false
  return (
    Number.isInteger(pos.book_index) &&
    pos.book_index >= 0 &&
    pos.book_index <= 65 &&
    Number.isInteger(pos.chapter) &&
    pos.chapter >= 1 &&
    pos.chapter <= 150
  )
}

/**
 * Restart the plan FROM TODAY at the chapters a chosen day was supposed to read.
 *
 * anchorDate selects the CHAPTER position (that day's first chapter);
 * started_at is rewritten to today. Rewriting started_at to the anchor day
 * instead is the bug this replaces: it moved the reading position but left the
 * elapsed span intact, so the reader stayed exactly as far behind — the one
 * outcome this button does not exist to produce.
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
 * A parallel plan's day holds chapters from BOTH testaments, so `positions`
 * carries both. Re-anchoring on such a day used to take only the first ref —
 * the NT chapter — which reset NT to the plan's opening chapters and left OT
 * untouched, so 「由最近嘅斷位接返」 served the earliest gap instead of the
 * chosen one. Both are validated and both are written.
 *
 * The missed days are left exactly as they were. They stay visible as a real
 * gap in the calendar and streak — the user chose to move on, not to claim
 * they read what they didn't.
 */
export async function reanchorPlan(
  enrollmentId: string,
  anchorDate: string,
  positions: AnchorPositions,
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

  // The anchor DAY names which chapters to restart from; the RESTART DATE is
  // always today. Those are two different things and conflating them is what
  // made this button useless: writing the anchor day into started_at left the
  // reader exactly as many days behind as before (273 in the real test account),
  // which is the precise thing the button exists to end. Restarting from a gap
  // means 「start reading at this chapter TODAY」, not 「pretend today is that
  // day」. So the date written is today, and anchorDate is used only to pick the
  // position the caller already resolved.
  if (daysBetween(currentStart, anchorDate) < 0) {
    return { ok: false, error: '新的起點不能早於現有計劃的開始日' }
  }
  if (daysBetween(anchorDate, today) < 0) {
    return { ok: false, error: '新的起點不能是將來的日子' }
  }
  if (anchorDate === currentStart && anchorDate === today) {
    return { ok: false, error: '新的起點與現有計劃相同' }
  }

  // Validate the client-supplied start position. Canonical index is 0–65
  // (創=0 … 啟=65) and a chapter is a plain positive integer; anything else is
  // a corrupt or hostile payload and is rejected rather than clamped.
  if (
    !isValidAnchorPosition(positions.primary) ||
    (positions.secondary !== null &&
      !isValidAnchorPosition(positions.secondary))
  ) {
    return { ok: false, error: '新的起點位置無效' }
  }

  // The shape of the rewrite is decided by ONE shared helper, the same one the
  // confirm dialog previews with. Doing it separately here is what let the
  // dialog promise 哥林多前 7 while the plan still began at 詩篇 111: the
  // preview and the write had drifted apart, and under 'ot_then_nt' the
  // reading ORDER — not just the start columns — decides where reading
  // begins.
  const rebuilt = reanchoredEnrollment(enrollment as never, positions)
  const patch: Record<string, unknown> = {
    // TODAY, not the anchor day — see the note above. This is the line that
    // actually resets the backlog; without it the button is a no-op in the only
    // way the reader can observe.
    started_at: `${today}T00:00:00.000Z`,
    start_book_index: rebuilt.start_book_index,
    start_chapter: rebuilt.start_chapter,
  }
  // reading_order is a real part of the rewrite: restarting inside the
  // secondary testament has to swap which testament is primary, or the new
  // start position is never consulted.
  if (rebuilt.reading_order != null) {
    patch.reading_order = rebuilt.reading_order
  }
  if (rebuilt.ot_start_book_index != null) {
    patch.ot_start_book_index = rebuilt.ot_start_book_index
  }
  if (rebuilt.ot_start_chapter != null) {
    patch.ot_start_chapter = rebuilt.ot_start_chapter
  }
  if (rebuilt.nt_start_book_index != null) {
    patch.nt_start_book_index = rebuilt.nt_start_book_index
  }
  if (rebuilt.nt_start_chapter != null) {
    patch.nt_start_chapter = rebuilt.nt_start_chapter
  }

  const { error } = await supabase
    .from('user_plan_enrollments')
    .update(patch)
    .eq('id', enrollmentId)
    .eq('user_id', user.id)

  // A finished testament is written as a sentinel book index (66, past 啟示錄
  // 65). Databases still carrying the migrations 011/012 CHECK constraints
  // reject it with 23514 and abort the entire UPDATE — the reader pressed the
  // button and got an error instead of the restart. When that is the failure,
  // retry once expressing 「finished」 the way that fits the old range: the
  // testament's last book at its last chapter. The generator reads that as
  // finished too, so the restart still lands on the requested gap.
  let failed = error
  if (
    failed &&
    failed.code === '23514' &&
    (patch.nt_start_book_index === FINISHED_BOOK_INDEX ||
      patch.ot_start_book_index === FINISHED_BOOK_INDEX ||
      patch.start_book_index === FINISHED_BOOK_INDEX)
  ) {
    const legacy = { ...patch }
    if (legacy.nt_start_book_index === FINISHED_BOOK_INDEX) {
      legacy.nt_start_book_index = FINISHED_BOOK_INDEX_LEGACY.nt
      legacy.nt_start_chapter = LAST_NT_CHAPTER
    }
    if (legacy.ot_start_book_index === FINISHED_BOOK_INDEX) {
      legacy.ot_start_book_index = FINISHED_BOOK_INDEX_LEGACY.ot
      legacy.ot_start_chapter = LAST_OT_CHAPTER
    }
    if (legacy.start_book_index === FINISHED_BOOK_INDEX) {
      const singleIsNT = rebuilt.scope === 'nt'
      legacy.start_book_index = singleIsNT
        ? FINISHED_BOOK_INDEX_LEGACY.nt
        : FINISHED_BOOK_INDEX_LEGACY.ot
      legacy.start_chapter = singleIsNT ? LAST_NT_CHAPTER : LAST_OT_CHAPTER
    }
    const retry = await supabase
      .from('user_plan_enrollments')
      .update(legacy)
      .eq('id', enrollmentId)
      .eq('user_id', user.id)
    if (!retry.error) failed = null
    else failed = retry.error
  }
  if (failed) return { ok: false, error: failed.message }

  revalidatePath('/dashboard')
  revalidatePath('/calendar')
  revalidatePath('/read')
  return {
    ok: true,
    from: currentStart,
    to: today,
    anchor_date: anchorDate,
    from_ref: positions.secondary
      ? `${positions.primary.book_index}:${positions.primary.chapter}+${positions.secondary.book_index}:${positions.secondary.chapter}`
      : `${positions.primary.book_index}:${positions.primary.chapter}`,
  }
}
