'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { readingDate, addDays } from '@/lib/readingDate'
import { fetchAllReadingSessions } from '@/lib/readingSessionsScan'

// ─── Date helpers (HKT-only, avoids .toISOString() UTC offset bug) ─────────────
function getHKTDateStr(date: Date = new Date()): string {
  // Reading date with the shared 05:00 HKT cutoff — streak grouping and
  // "did I read today" must resolve to the SAME date markLessonComplete wrote,
  // otherwise the two disagree inside the 00:00–05:00 window.
  return readingDate(date)
}

// ─── Future-date guard (public launch: cannot mark future dates complete) ──────
// A YYYY-MM-DD string is "future" if it's strictly after today in HKT.
function isFutureDate(dateLocal: string): boolean {
  const today = getHKTDateStr()
  return dateLocal > today
}

export async function markLessonComplete(
  enrollmentId: string,
  chapterRef: string,
  xpEarned: number,
  dateLocalOverride?: string,
): Promise<{
  success: boolean
  sessionId?: string
  error?: string
  errorDetails?: unknown
  // True when the exact (user_id, enrollment_id, date_local, chapter_ref)
  // 4-tuple already existed and no new row was inserted — the completion is
  // idempotent and callers can treat it as "already done", not an error.
  alreadyCompleted?: boolean
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  const now = new Date()
  // FIX: use en-CA+HKT to get YYYY-MM-DD directly — no UTC offset issue
  const dateLocal = dateLocalOverride || getHKTDateStr(now)

  // Future-date guard (public launch): cannot mark a future day as complete
  if (dateLocalOverride && isFutureDate(dateLocal)) {
    return { success: false, error: 'cannot mark a future date as complete' }
  }

  console.log('[markLessonComplete]', {
    user_id: user.id,
    enrollment_id: enrollmentId,
    chapter_ref: chapterRef,
    xp_earned: xpEarned,
    date_local: dateLocal,
  })

  // Parse "創 1" or "太 2:1" → book_zh="創", chapter=1
  const parts = chapterRef.trim().split(/\s+/)
  const book_zh = parts[0] || '創'
  const chapterRaw = parts[1] || '1'
  const chapter = parseInt(chapterRaw.replace(/[^0-9]/g, ''), 10) || 1

  // ── Duplicate guard ────────────────────────────────────────────────────────
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
  // .single() fail with PGRST116. Checking first keeps the action idempotent
  // and lets us return the existing session instead of an error.
  //
  // .limit(1) is load-bearing: migration 0007 has not run, so historical
  // duplicates still exist in production (1121 4-tuples, one user alone has
  // 334). A bare .maybeSingle() on a >1-row result does NOT return data — it
  // returns error PGRST116 "multiple rows returned", which used to surface as
  // a hard failure when a reader re-completed a chapter that was double-
  // written before the trigger shipped. Capping at one row makes the query
  // structurally incapable of hitting that error.
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

  // .maybeSingle(), NOT .single(): the guard SELECT above and this INSERT are
  // not atomic, so a concurrent request (or a retry racing this one) can pass
  // the guard and then be dropped by trg_dedupe_reading_session. A dropped row
  // makes the INSERT return zero rows, and .single() turns that into error
  // PGRST116 — the reader would see a hard failure for a completion that was
  // in fact already recorded. .maybeSingle() returns null instead, which we
  // report as an idempotent no-op.
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
    .select('id')
    .maybeSingle()

  if (error) {
    // 23505 = unique violation on uniq_reading_session_event
    // (user_id, enrollment_id, date_local, chapter_ref). The guard SELECT
    // above and this INSERT are not atomic, so a concurrent request can
    // insert the same event in between and this INSERT is then rejected by
    // the unique index. That is NOT a failure — the completion IS recorded,
    // by the other request. Report it as an idempotent no-op, the same way
    // the trigger-dropped case below is reported.
    if (error.code === '23505') {
      return { success: true, alreadyCompleted: true }
    }
    console.error('[markLessonComplete] INSERT failed:', JSON.stringify(error))
    return { success: false, error: error.message, errorDetails: error }
  }

  // No row came back: the DB trigger dropped it as a duplicate, so this
  // completion was already recorded by a concurrent write.
  if (!insertResult?.id) {
    return { success: true, alreadyCompleted: true }
  }

  return { success: true, sessionId: insertResult.id }
}

/**
 * Recalculate user_stats after one or more chapters are inserted in a batch.
 * Call this ONCE after all markLessonComplete calls are done — NOT inside each one.
 */
export async function recalcUserStatsAfterCompletion(
  dateLocal: string,
): Promise<{
  success: boolean
  totalXp: number
  level: number
  currentStreak: number
  longestStreak: number
  error?: string
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user)
    return {
      success: false,
      totalXp: 0,
      level: 0,
      currentStreak: 0,
      longestStreak: 0,
      error: 'Not authenticated',
    }

  // Pull EVERY session row for this user, not just the first PostgREST page.
  //
  // This SELECT used to be bare, and PostgREST silently caps a bare SELECT at
  // its max-rows default (1000 in production) — no error, just fewer rows than
  // match. For the reader with 2266 sessions that meant totalXp = sum of only
  // the first 1000 rows (10,000 XP instead of 22,660), so their level and both
  // streaks were computed from truncated data. fetchAllReadingSessions() pages
  // with .range() below the cap until a short page proves the end, so totalXp
  // sums every row and uniqueDates contains every reading date — safe even if
  // session counts grow past any future cap.
  const { rows: allSessions } = await fetchAllReadingSessions<{
    date_local: string
    xp_earned: number
  }>(
    () =>
      supabase
        .from('reading_sessions')
        .select('date_local, xp_earned')
        .eq('user_id', user.id),
    'recalcUserStatsAfterCompletion',
  )

  const uniqueDates = [...new Set(allSessions.map((r) => r.date_local))].sort()

  const todayStr = getHKTDateStr()
  // Yesterday is derived from the same reading date, not from wall-clock
  // arithmetic — otherwise "yesterday" could be a day the user doesn't count.
  const yesterdayStr = addDays(todayStr, -1)

  let streak = 0
  if (uniqueDates.length > 0) {
    let lastValidIdx = uniqueDates.length - 1
    for (let i = uniqueDates.length - 1; i >= 0; i--) {
      if (uniqueDates[i] <= todayStr) {
        lastValidIdx = i
        break
      }
    }
    const lastDate = uniqueDates[lastValidIdx]
    if (lastDate === todayStr || lastDate === yesterdayStr) {
      streak = 1
      for (let i = lastValidIdx - 1; i >= 0; i--) {
        const diffDays = Math.round(
          (new Date(uniqueDates[i + 1]).getTime() -
            new Date(uniqueDates[i]).getTime()) /
            86400000,
        )
        if (diffDays === 1) streak++
        else break
      }
    }
  }

  // XP model: sum of xp_earned across ALL reading_sessions (full paged scan —
  // see the fetch above; a capped page would understate this sum).
  // Currently each chapter is worth 10 XP (set in calendar handleCompleteDay).
  // Level = floor(sqrt(total_xp / 100)) + 1 → 100/400/900/1600... for L2/L3/L4/L5
  const totalXp = allSessions.reduce((sum, s) => sum + (s.xp_earned || 0), 0)
  const level = Math.floor(Math.sqrt(totalXp / 100)) + 1

  let longestStreak = streak
  let currentRun = 1
  for (let i = 1; i < uniqueDates.length; i++) {
    const diffDays = Math.round(
      (new Date(uniqueDates[i]).getTime() -
        new Date(uniqueDates[i - 1]).getTime()) /
        86400000,
    )
    if (diffDays === 1) {
      currentRun++
      longestStreak = Math.max(longestStreak, currentRun)
    } else currentRun = 1
  }

  const { error: statsError } = await supabase
    .from('user_stats')
    .update({
      total_xp: totalXp,
      level,
      current_streak: streak,
      longest_streak: Math.max(longestStreak, streak),
      last_completed_date:
        uniqueDates.length > 0 ? uniqueDates[uniqueDates.length - 1] : null,
    })
    .eq('user_id', user.id)

  if (statsError) {
    console.error(
      '[recalcUserStatsAfterCompletion] stats update failed:',
      statsError,
    )
    return {
      success: false,
      totalXp,
      level,
      currentStreak: streak,
      longestStreak,
      error: statsError.message,
    }
  }

  console.log('[recalcUserStatsAfterCompletion] ok:', {
    totalXp,
    level,
    streak,
    longestStreak,
  })
  return { success: true, totalXp, level, currentStreak: streak, longestStreak }
}

/**
 * Undo a day's reading completion.
 * Deletes ALL reading_sessions for this enrollment on this date,
 * then recalculates user_stats from scratch (XP, streak, level).
 */
export async function unmarkDayComplete(
  enrollmentId: string,
  dateLocal: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return { success: false, error: 'Not authenticated' }
  }

  console.log('[unmarkDayComplete]', {
    enrollment_id: enrollmentId,
    date_local: dateLocal,
    user_id: user.id,
  })

  // 1. Delete ALL sessions for this user on this date, regardless of which
  // enrollment they belong to (enrollment_id may be stale after re-enrollment).
  const { error: deleteError } = await supabase
    .from('reading_sessions')
    .delete()
    .eq('user_id', user.id)
    .eq('date_local', dateLocal)

  if (deleteError) {
    console.error(
      '[unmarkDayComplete] DELETE failed:',
      JSON.stringify(deleteError),
    )
    return { success: false, error: deleteError.message }
  }

  console.log('[unmarkDayComplete] DELETE ok')

  // 2. Recalculate user_stats from ALL remaining sessions (full paged scan —
  // a bare SELECT here hits the same PostgREST max-rows cap as
  // recalcUserStatsAfterCompletion and would write an understated XP/streak).
  const { rows: remaining, scanError: recalcScanError } =
    await fetchAllReadingSessions<{ date_local: string; xp_earned: number }>(
      () =>
        supabase
          .from('reading_sessions')
          .select('date_local, xp_earned')
          .eq('user_id', user.id),
      'unmarkDayComplete.recalc',
    )

  // Fail closed: writing stats derived from a partial scan would silently
  // understate total_xp, level and streak — the exact bug class this fixes.
  if (recalcScanError) {
    console.error(
      '[unmarkDayComplete] fetch for recalc failed:',
      JSON.stringify(recalcScanError),
    )
    return { success: false, error: recalcScanError.message }
  }

  // Collect unique completion dates in order
  const uniqueDates = [...new Set(remaining.map((r) => r.date_local))].sort()

  // Calculate streak — FIX: use en-CA+HKT throughout
  const todayStr = getHKTDateStr()
  // Yesterday is derived from the same reading date, not from wall-clock
  // arithmetic — otherwise "yesterday" could be a day the user doesn't count.
  const yesterdayStr = addDays(todayStr, -1)

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

  // XP = sum of xp_earned across all remaining reading_sessions
  const totalXp = (remaining ?? []).reduce(
    (sum, s) => sum + (s.xp_earned || 0),
    0,
  )
  const level = Math.floor(Math.sqrt(totalXp / 100)) + 1

  console.log('[unmarkDayComplete] recalculated:', {
    uniqueDates,
    streak,
    totalXp,
    level,
    todayStr,
    yesterdayStr,
  })

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
      last_completed_date:
        uniqueDates.length > 0 ? uniqueDates[uniqueDates.length - 1] : null,
    })
    .eq('user_id', user.id)

  if (updateError) {
    console.error(
      '[unmarkDayComplete] stats update failed:',
      JSON.stringify(updateError),
    )
    return { success: false, error: updateError.message }
  }

  console.log('[unmarkDayComplete] stats updated ok')

  // Revalidate dashboard so updated XP/streak reflects immediately
  revalidatePath('/dashboard')

  // Also remove today's group check-ins (since user un-completed today's reading, all group check-ins for today are undone)
  try {
    const { error: grpErr } = await supabase
      .from('group_checkins')
      .delete()
      .eq('user_id', user.id)
      .eq('date_local', dateLocal)
    if (grpErr) {
      console.error(
        '[unmarkDayComplete] group_checkins delete failed:',
        JSON.stringify(grpErr),
      )
    } else {
      console.log(
        '[unmarkDayComplete] group_checkins removed for date',
        dateLocal,
      )
    }
  } catch (e) {
    console.error('[unmarkDayComplete] group cleanup error:', e)
  }

  return { success: true }
}

/**
 * Batch-mark multiple chapters as complete in a single DB round-trip.
 * Replaces N × markLessonComplete() calls with a single bulk INSERT.
 * Then recalculates stats server-side (no full-session transfer).
 */
/**
 * Mark a whole reading run complete.
 *
 * `dateLocal` is the FALLBACK date for refs that have no explicit entry in
 * `dates`. A catch-up queue holds several days' chapters at once (missed days
 * plus today), and every one of them used to be written under today's single
 * date_local — so finishing 「兩日 8 章」 recorded all eight chapters against
 * today and left the missed day still marked unread on both the dashboard and
 * the calendar. Pass `dates` to attribute each chapter to the plan day it came
 * from; the ref order matches the queue order, so index alignment is exact.
 */
export async function markDayCompleteBatch(
  enrollmentId: string,
  refs: string[],
  dateLocal: string,
  dates?: (string | null)[],
): Promise<{
  success: boolean
  insertedCount?: number
  error?: string
  // Authoritative post-insert stats, already computed from the same SELECT
  // that updates user_stats. Returned so callers can refresh local state
  // without a second full-table reading_sessions scan.
  totalXp?: number
  level?: number
  currentStreak?: number
  longestStreak?: number
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'Not authenticated' }
  if (!refs || refs.length === 0)
    return { success: false, error: 'No refs provided' }
  // A misaligned dates array would attribute chapters to the wrong days, which
  // is worse than not attributing them at all — reject rather than guess.
  if (dates && dates.length !== refs.length) {
    return { success: false, error: 'dates length must match refs length' }
  }

  // Future-date guard (public launch): cannot mark a future day as complete
  if (isFutureDate(dateLocal)) {
    return { success: false, error: 'cannot mark a future date as complete' }
  }
  if (dates?.some((d) => d && isFutureDate(d))) {
    return { success: false, error: 'cannot mark a future date as complete' }
  }

  // ── Step 1: Bulk INSERT all chapters in ONE round-trip ──────────────────────
  const now = new Date()
  const rows: Record<string, unknown>[] = refs.map((ref, i) => {
    const parts = ref.trim().split(/\s+/)
    const bookZh = parts[0]
    // Handle "創 1" or "創1" or "創 1:3"
    const chapterPart = parts[1] ?? '1'
    const chapter = parseInt(chapterPart.replace(/:\d+$/, ''), 10) || 1
    const own = dates?.[i] ?? null
    return {
      enrollment_id: enrollmentId,
      user_id: user.id,
      chapter_ref: ref,
      date_local: own || dateLocal,
      xp_earned: 10,
      day_number: 1,
      book_zh: bookZh,
      chapter,
    }
  })

  // ── Duplicate guard (mirrors markLessonComplete above) ─────────────────────
  // Completion events are keyed by (user_id, enrollment_id, date_local,
  // chapter_ref). The DB trigger trg_dedupe_reading_session (migration 0006)
  // silently drops duplicate inserts as a backstop; doing the check here keeps
  // the batch idempotent and lets insertedCount report rows actually inserted.
  //
  // Keys are JSON.stringify'd tuples, NOT `${a}|${b}|${c}` template strings:
  // a bare pipe join is ambiguous — chapter_ref is free text (added in
  // migration 0003, backfilled from book_zh + chapter) and a ref containing a
  // pipe would splice the tuple into the wrong fields. JSON encodes each field
  // with its own delimiters, so two different tuples can never produce the
  // same key.
  const sessionKey = (
    enrollmentId: unknown,
    dateLocal: unknown,
    chapterRef: unknown,
  ) => JSON.stringify([enrollmentId, dateLocal, chapterRef])

  // First dedupe duplicates within `rows` itself, keeping the first occurrence.
  const seenKeys = new Set<string>()
  const uniqueRows = rows.filter((row) => {
    const key = sessionKey(row.enrollment_id, row.date_local, row.chapter_ref)
    if (seenKeys.has(key)) return false
    seenKeys.add(key)
    return true
  })

  // Compare against each row's OWN final date_local (dates?.[i] ?? null can
  // differ per row), so build the key from the row value, not the fallback.
  //
  // Narrowing keeps the result set small: only the distinct date_local values
  // this batch can actually write matter for the comparison, and every one is
  // a valid YYYY-MM-DD string — `row.date_local` comes from `own || dateLocal`,
  // and both sides of that fallback are non-null (the column is NOT NULL in the
  // schema, and the future-date guard above already rejected any malformed
  // override).
  //
  // fetchAllReadingSessions() then pages with .range() instead of trusting a
  // limit header: PostgREST caps a bare SELECT at its max-rows default (1000),
  // and production has a user with 2266 sessions, so even a narrowed guard can
  // sit above the cap — a truncated result silently hides old duplicates and
  // the batch would insert them again. Paging below the cap until a short page
  // proves the end makes truncation structurally impossible, whatever limit
  // PostgREST is configured with.
  const batchDates = [
    ...new Set(uniqueRows.map((row) => row.date_local as string)),
  ].sort()
  const { rows: existingSessions, scanError: batchScanError } =
    await fetchAllReadingSessions<{
      enrollment_id: string
      date_local: string
      chapter_ref: string
    }>(
      () =>
        supabase
          .from('reading_sessions')
          .select('enrollment_id, date_local, chapter_ref')
          .eq('user_id', user.id)
          .eq('enrollment_id', enrollmentId)
          .in('date_local', batchDates),
      'markDayCompleteBatch.duplicateGuard',
    )

  // Fail closed. Unlike markLessonComplete (where a missed guard just re-runs
  // an insert the trigger will drop), this path bulk-inserts many rows at
  // once: if the SELECT errored we cannot tell which of them already exist,
  // and writing duplicate completion events corrupts XP/level/streak — worse
  // than not writing them. fetchAllReadingSessions() returns whatever it
  // managed to page plus a truncatedAtGuard flag; either symptom means the key
  // set is incomplete, so skip the insert and report the failure.
  if (batchScanError) {
    console.error(
      '[markDayCompleteBatch] duplicate-guard SELECT failed:',
      batchScanError,
    )
    return { success: false, error: batchScanError.message }
  }

  const existingKeys = new Set(
    (existingSessions ?? []).map((r) =>
      sessionKey(r.enrollment_id, r.date_local, r.chapter_ref),
    ),
  )

  const newRows = uniqueRows.filter((row) => {
    const key = sessionKey(row.enrollment_id, row.date_local, row.chapter_ref)
    return !existingKeys.has(key)
  })

  if (newRows.length > 0) {
    // upsert + ignoreDuplicates → ON CONFLICT DO NOTHING. The unique index
    // uniq_reading_session_event on (user_id, enrollment_id, date_local,
    // chapter_ref) rejects a row that a concurrent request already wrote
    // between the guard SELECT above and this INSERT. Without this, one
    // conflicting row fails the WHOLE multi-row insert and the reader loses
    // every other chapter in the batch. With it, the conflicting row is
    // skipped and the rest are written; the recalc below then reads the
    // deduplicated set and computes the same XP either way.
    //
    // .insert() cannot express this — its options are only { count,
    // defaultToNull }. .upsert() is what carries onConflict/ignoreDuplicates.
    const { error: insertError } = await supabase
      .from('reading_sessions')
      .upsert(newRows, {
        onConflict: 'user_id,enrollment_id,date_local,chapter_ref',
        ignoreDuplicates: true,
      })

    if (insertError) {
      console.error('[markDayCompleteBatch] bulk INSERT failed:', insertError)
      return { success: false, error: insertError.message }
    }
  } else {
    console.log(
      '[markDayCompleteBatch] all rows already exist; skipping INSERT',
    )
  }

  // ── Step 2: Recalculate user stats server-side (full paged scan + UPDATE) ──
  // Same truncation fix as recalcUserStatsAfterCompletion(): a bare SELECT here
  // silently capped at PostgREST's max-rows (1000), understating totalXp and
  // every streak for high-volume readers. Streak logic below is unchanged.
  const { rows: allSessions } = await fetchAllReadingSessions<{
    date_local: string
    xp_earned: number
  }>(
    () =>
      supabase
        .from('reading_sessions')
        .select('date_local, xp_earned')
        .eq('user_id', user.id),
    'markDayCompleteBatch.recalc',
  )

  const uniqueDates = [...new Set(allSessions.map((r) => r.date_local))].sort()

  const todayStr = getHKTDateStr()
  // Yesterday is derived from the same reading date, not from wall-clock
  // arithmetic — otherwise "yesterday" could be a day the user doesn't count.
  const yesterdayStr = addDays(todayStr, -1)

  let streak = 0
  if (uniqueDates.length > 0) {
    let lastValidIdx = uniqueDates.length - 1
    for (let i = uniqueDates.length - 1; i >= 0; i--) {
      if (uniqueDates[i] <= todayStr) {
        lastValidIdx = i
        break
      }
    }
    const lastDate = uniqueDates[lastValidIdx]
    if (lastDate === todayStr || lastDate === yesterdayStr) {
      streak = 1
      for (let i = lastValidIdx - 1; i >= 0; i--) {
        const diffDays = Math.round(
          (new Date(uniqueDates[i + 1]).getTime() -
            new Date(uniqueDates[i]).getTime()) /
            86400000,
        )
        if (diffDays === 1) streak++
        else break
      }
    }
  }

  const totalXp = allSessions.reduce(
    (sum: number, s: { xp_earned?: number }) => sum + (s.xp_earned ?? 0),
    0,
  )
  const level = Math.floor(Math.sqrt(totalXp / 100)) + 1
  const lastDateVal =
    uniqueDates.length > 0 ? uniqueDates[uniqueDates.length - 1] : null

  let longestStreak = streak
  let currentRun = 1
  for (let i = 1; i < uniqueDates.length; i++) {
    const diffDays = Math.round(
      (new Date(uniqueDates[i]).getTime() -
        new Date(uniqueDates[i - 1]).getTime()) /
        86400000,
    )
    if (diffDays === 1) {
      currentRun++
      longestStreak = Math.max(longestStreak, currentRun)
    } else currentRun = 1
  }

  await supabase
    .from('user_stats')
    .update({
      total_xp: totalXp,
      level,
      current_streak: streak,
      longest_streak: Math.max(longestStreak, streak),
      last_completed_date: lastDateVal,
    })
    .eq('user_id', user.id)

  // Revalidate dashboard so group check-in status reflects immediately
  revalidatePath('/dashboard')

  return {
    success: true,
    insertedCount: newRows.length,
    totalXp,
    level,
    currentStreak: streak,
    longestStreak: Math.max(longestStreak, streak),
  }
}

/**
 * Mark a plan enrollment as completed.
 * Called when user finishes all days in a plan.
 */
export async function markPlanComplete(
  enrollmentId: string,
): Promise<{ success: boolean; error?: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
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
    .from('user_stats')
    .select('completed_plans')
    .eq('user_id', user.id)
    .single()

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
