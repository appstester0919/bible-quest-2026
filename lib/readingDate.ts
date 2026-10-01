// ============================================================================
// Reading-date helper — the SINGLE source of truth for `date_local`.
//
// WHY THIS EXISTS
//
// The app is read largely at night by young people, and a session finished at
// 02:00 or 03:00 belongs to the PREVIOUS day in the user's own reckoning. That
// intent was already half-implemented: `dashboard/actions.ts` did
//
//     new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
//       .toISOString().split('T')[0]
//
// which converts to HKT and then straight back to UTC — silently rolling the
// date back by 8 hours, giving an implicit 08:00 cutoff. The other 28 call
// sites used `toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })`,
// which has NO cutoff at all. So a session completed at 02:00 HKT was WRITTEN
// as the previous day but READ as the current day: the page looked for a
// `date_local` that could never exist, and a completed lesson showed as
// unfinished.
//
// Fix: one function, one cutoff, used by every call site.
//
// WHAT THE CUTOFF DOES
//
//   real HKT time < 05:00  →  date_local = yesterday
//   real HKT time >= 05:00 →  date_local = today
//
// Chosen at 05:00 (user decision, 2026-10-01) so a night-owl finishing around
// 03:00–04:00 still counts as the previous day, matching how the user
// describes their own habit.
//
// RULES FOR CALL SITES
//
//   • Reading dates (reading_sessions.date_local, plan day keys, "is today
//     done", streak grouping) → use `readingDate()`.
//   • Push-notification scheduling is a DIFFERENT concern and deliberately
//     keeps its own plain HKT date — see `notificationDate()`. Do not merge
//     the two: a 06:30 notification must fire at 06:30, not be re-anchored to
//     "yesterday".
// ============================================================================

/** Real HKT time-of-day, as { h, m } — always in Asia/Hong_Kong. */
export function hktTimeOfDay(now: Date = new Date()): { h: number; m: number } {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Hong_Kong',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now)
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? '0')
  return { h: get('hour'), m: get('minute') }
}

/**
 * Hour (HKT) at which the reading day rolls over. Times strictly before this
 * belong to the previous day.
 */
export const READING_DAY_CUTOFF_HOUR = 5

/**
 * The `date_local` a reading session completed at `now` should be recorded
 * under, as YYYY-MM-DD. This is THE definition used for every reading-date
 * decision in the app: writing a session, looking up "did I finish today",
 * grouping sessions by day for streaks, and matching a chapter to its
 * scheduled plan day.
 */
export function readingDate(now: Date = new Date()): string {
  const { h } = hktTimeOfDay(now)
  if (h < READING_DAY_CUTOFF_HOUR) {
    // Before cutoff — walk back one day from the HKT calendar date.
    const ymd = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Hong_Kong',
    }).format(now)
    const [y, m, d] = ymd.split('-').map(Number)
    const prev = new Date(Date.UTC(y, m - 1, d))
    prev.setUTCDate(prev.getUTCDate() - 1)
    return prev.toISOString().slice(0, 10)
  }
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
  }).format(now)
}

/**
 * Plain HKT calendar date, with no cutoff — for notification scheduling and
 * anything else that must fire on the wall-clock day regardless of the
 * reading-day convention.
 */
export function notificationDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
  }).format(now)
}

/** Parse a YYYY-MM-DD into a local-midnight Date (for date-only arithmetic). */
export function parseYmd(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Whole days from `a` to `b`, both YYYY-MM-DD. b − a. */
export function daysBetween(a: string, b: string): number {
  return Math.round(
    (parseYmd(b).getTime() - parseYmd(a).getTime()) / 86_400_000,
  )
}

/** Add `n` days to a YYYY-MM-DD string. */
export function addDays(ymd: string, n: number): string {
  const d = parseYmd(ymd)
  d.setDate(d.getDate() + n)
  const p = (x: number) => String(x).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
