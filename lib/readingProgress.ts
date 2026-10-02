import { addDays, daysBetween } from './readingDate'

// ============================================================================
// Reading-progress catch-up analysis.
//
// WHY THIS EXISTS
//
// Most missed days are not a crisis — a reader is busy for three days, comes
// back, and has to work out how to jump back in. Today that means digging
// through the read page to work out where they stopped, dragging out a range,
// and hoping they pick the right span. A plan that has quietly slipped is the
// most common reason a reading plan gets abandoned.
//
// This module answers one question — "how far behind is this reader, and
// where are their gaps?" — so the dashboard can offer ONE tap for the common
// cases and leave genuinely complex reshuffling to the settings page.
//
// It does NOT decide what to do. It reports the three cases and the plan
// consequences of each; the UI picks which to offer and the user picks.
// ============================================================================

/** A contiguous run of plan days that produced no reading_sessions rows. */
export interface GapBlock {
  /** First missed day — the chapter to restart from. */
  firstDate: string
  /** Last missed day (inclusive). */
  lastDate: string
  /** Whole days in this block. */
  days: number
  /** Every chapter the plan scheduled across this block, in order. */
  refs: string[]
}

export type CatchUpCase =
  /** No gaps: on schedule, or ahead. Nothing to offer. */
  | { kind: 'on_track' }
  /** Behind, but small enough to read in one sitting. */
  | {
      kind: 'small'
      behindDays: number
      missedRefs: string[]
      firstGap: GapBlock
    }
  /**
   * Behind by more than a week. One gap block, or several:
   *  - one block → restarting there is unambiguous, so offer that alone
   *  - many     → the reader knows their own situation better than we do (a
   *    missed block may have been read but not marked, or genuinely skipped),
   *    so offer BOTH the earliest and the latest block and let them choose.
   *    Anything between belongs in settings.
   */
  | {
      kind: 'reanchor'
      behindDays: number
      missedRefs: string[]
      firstGap: GapBlock
      lastGap: GapBlock
      /** true when the plan has more than one gap BLOCK */
      multipleGaps: boolean
    }

/** Max days of catch-up that can reasonably be read in one go. */
export const CATCHUP_MAX_DAYS = 7

/**
 * Analyse how far behind a reader is.
 *
 * Today is deliberately EXCLUDED. Not having read today's chapters yet is the
 * normal state of every single day — counting it would make an on-schedule
 * reader look one day behind all day, and the dashboard would nag them about
 * a gap that isn't one. Only days that have already passed can be missed.
 *
 * @param startedAt      enrollment.started_at (only the date part matters)
 * @param today          the reader's current reading date (05:00 HKT cutoff)
 * @param completedDates distinct date_local values that have a session row
 * @param planForDate    (date) => chapters scheduled, or [] if the plan had
 *                       already ended by that day
 */
export function analyseCatchUp(
  startedAt: string | null | undefined,
  today: string,
  completedDates: string[],
  planForDate: (date: string) => string[],
): CatchUpCase {
  if (!startedAt) return { kind: 'on_track' }

  const startDate = startedAt.split('T')[0]
  // A plan starting today (or in the future, which a stale clock can produce)
  // has nothing to catch up on.
  if (daysBetween(startDate, today) <= 0) return { kind: 'on_track' }

  const done = new Set(completedDates)

  // Every elapsed day from the start up to and including yesterday.
  const lastElapsed = addDays(today, -1)
  if (daysBetween(startDate, lastElapsed) < 0) return { kind: 'on_track' }

  // Walk the plan and collect missed days, then group them into CONTIGUOUS
  // blocks. Grouping matters: a 26-day miss is one gap, not 26, and offering
  // "restart from the last missed day" for a single contiguous run would skip
  // 25 chapters — the restart must be the block's FIRST day.
  const missed: { date: string; refs: string[] }[] = []
  for (let d = startDate; daysBetween(d, lastElapsed) >= 0; d = addDays(d, 1)) {
    const plannedRefs = planForDate(d)
    if (plannedRefs.length === 0) continue // plan had ended, or no data
    if (done.has(d)) continue
    missed.push({ date: d, refs: plannedRefs })
  }

  if (missed.length === 0) return { kind: 'on_track' }

  const blocks: GapBlock[] = []
  let cur: GapBlock | null = null
  for (const m of missed) {
    if (cur && daysBetween(cur.lastDate, m.date) === 1) {
      cur.lastDate = m.date
      cur.days += 1
      cur.refs.push(...m.refs)
    } else {
      cur = { firstDate: m.date, lastDate: m.date, days: 1, refs: [...m.refs] }
      blocks.push(cur)
    }
  }

  const missedRefs = missed.flatMap((m) => m.refs)
  const behindDays = missed.length
  const firstGap = blocks[0]
  const lastGap = blocks[blocks.length - 1]

  if (behindDays <= CATCHUP_MAX_DAYS) {
    return { kind: 'small', behindDays, missedRefs, firstGap }
  }

  return {
    kind: 'reanchor',
    behindDays,
    missedRefs,
    firstGap,
    lastGap,
    multipleGaps: blocks.length > 1,
  }
}

/** "馬太福音 1" → "馬太 1", for compact plan summaries. */
export function shortRef(ref: string): string {
  const parts = ref.trim().split(/\s+/)
  const book = parts[0] ?? ''
  const chapter = (parts[1] ?? '').replace(/:\d+$/, '')
  // 和合本 book names end in 記/福音/書/etc; trim those so 「馬太福音」
  // renders as 「馬太」. Fall back to the full name if nothing is left.
  const short = book.replace(/(福音|記|書|篇|歌|詩|箴|道|錄|傳|志|考)$/u, '')
  return chapter ? `${short || book} ${chapter}` : short || book
}

/** "馬太 1 – 馬太 3" for a span, or a single ref when the span is one chapter. */
export function describeRefSpan(refs: string[]): string {
  if (refs.length === 0) return '—'
  const first = shortRef(refs[0])
  const last = shortRef(refs[refs.length - 1])
  return first === last ? first : `${first} – ${last}`
}
