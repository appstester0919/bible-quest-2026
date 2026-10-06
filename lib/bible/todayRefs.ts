// ============================================================================
// Today's required chapters — the single answer to 「今日讀經係咩」
//
// Extracted from app/(main)/read/page.tsx so it can be unit-tested. That file is
// 2683 lines of client component with zero exported functions: its logic could
// only be exercised by rendering the page against a live Supabase and the
// 44MB bible JSON. Three of this session's bugs (8770dd3, faf375f, f6b7121)
// were all 「同一個概念喺兩個地方各寫一次」 and none of them had a test that
// could have caught them. This module is the fix for that class, not just for
// this one function.
//
// The rule it encodes: 今日讀經 always comes from generateReadingPlan. Never
// replay the plan by hand. The hand-rolled replay that lived here before walked
// a flat book list from 創 1 and ignored reading_order, nt_start_book_index,
// ot_start_book_index and start_book_index entirely, so every parallel plan and
// every mid-Bible start — i.e. every plan the catch-up button produces —
// showed a range that disagreed with the dashboard.
// ============================================================================

import {
  generateReadingPlan,
  type BookMeta,
  type EnrollmentLite,
} from './planGenerator'

/** Days of slack added past today so the lookup always contains today. */
const HORIZON_SLACK_DAYS = 30
/** Used when the enrollment has no usable started_at. */
const FALLBACK_HORIZON_DAYS = 400

/** Days between two YYYY-MM-DD strings, negative when `to` is earlier. */
function daysBetween(from: string, to: string): number {
  const a = new Date(from + 'T00:00:00').getTime()
  const b = new Date(to + 'T00:00:00').getTime()
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.floor((b - a) / 86400000)
}

/**
 * How far ahead the plan must be generated so that `today` is inside it.
 *
 * A fixed horizon silently truncates for exactly the readers who need catch-up
 * most — someone 400+ days behind gets no entry for today and the caller falls
 * through to a wrong fallback. Sizing the horizon from the actual gap makes the
 * lookup correct at any distance behind.
 */
export function horizonForToday(
  enrollment: EnrollmentLite,
  today: string,
): number {
  const started = enrollment.started_at?.split('T')[0]
  if (!started) return FALLBACK_HORIZON_DAYS
  const behind = daysBetween(started, today)
  return Math.max(1, behind + 1) + HORIZON_SLACK_DAYS
}

/**
 * The chapters required today.
 *
 * `autoLoadedRefs` short-circuits: when the reader arrived with an explicit
 * range in the URL (今日功課 link, a shared range, a catch-up queue) those refs
 * ARE today's work, even if they cover several days. That is the whole point
 * of the catch-up feature, so it must win over the plan lookup.
 *
 * Otherwise ask the generator. Returns [] when nothing is due — before the
 * plan starts, or after it runs out of chapters — rather than guessing.
 */
export function todayRequiredRefs(
  autoLoadedRefs: string[] | null | undefined,
  enrollment: EnrollmentLite | null | undefined,
  books: BookMeta[],
  today: string,
): string[] {
  if (autoLoadedRefs && autoLoadedRefs.length > 0) return autoLoadedRefs
  if (!enrollment || books.length === 0) return []

  const plan = generateReadingPlan(
    enrollment,
    books,
    horizonForToday(enrollment, today),
  )
  return plan.get(today) ?? []
}

/**
 * Map every chapter ref to the calendar date the plan scheduled it for.
 *
 * The generator only fills `maxDays` entries, so a ref far in the future is
 * absent and the caller falls back to today. Completion records written against
 * the wrong date are the bug this replaced.
 */
export function planRefDates(
  enrollment: EnrollmentLite | null | undefined,
  books: BookMeta[],
  horizonDays: number,
): Map<string, string> {
  if (!enrollment || books.length === 0) return new Map()
  const plan = generateReadingPlan(enrollment, books, horizonDays)
  const map = new Map<string, string>()
  for (const [date, refs] of plan) {
    for (const r of refs) if (!map.has(r)) map.set(r, date)
  }
  return map
}
