import { addDays, daysBetween } from './readingDate'
import { generateReadingPlan, type EnrollmentLite } from './bible/planGenerator'
import type { BookMeta } from './bible/lookup'

/** 0-based index of 馬太福音 — the first NT book. */
const NT_FIRST_BOOK_INDEX = 39

/** The canon index a re-anchored plan should read from, and how. */
export interface AnchorPosition {
  book_index: number
  chapter: number
}

/**
 * The enrollment as it must be rewritten for a plan re-anchored at `pos`.
 *
 * WHY reading_order HAS TO MOVE — the bug that made the dialog lie
 *
 * The plan generator treats `reading_order` as deciding which testament is
 * PRIMARY. Under `'ot_then_nt'` the OT is primary and is read first, from
 * `ot_start_chapter`. Re-anchoring onto an NT chapter by rewriting only the
 * start columns therefore changed nothing: the plan still began at 詩篇 51 and
 * the confirm dialog promised 哥林多前 7 while the plan served 詩篇 111.
 *
 * When the reader restarts INSIDE the secondary testament, the two testaments
 * have to swap roles, otherwise the new start position is never consulted. So
 * the order is flipped to match whichever testament the anchor sits in, and
 * both start columns are written explicitly.
 *
 * This lives in one place on purpose: the confirm dialog's preview and the
 * server action that performs the write must not be able to disagree.
 */
export function reanchoredEnrollment<
  E extends EnrollmentLite & Record<string, unknown>,
>(enrollment: E, pos: AnchorPosition): EnrollmentLite {
  const anchorIsNT = pos.book_index >= NT_FIRST_BOOK_INDEX
  const order = enrollment.reading_order ?? null
  const isSequential = order === 'nt_then_ot' || order === 'ot_then_nt'

  const base: EnrollmentLite = {
    ...enrollment,
    started_at: null,
    start_book_index: pos.book_index,
    start_chapter: pos.chapter,
  }

  if (!isSequential) {
    // Single-testament or parallel: the columns the generator reads for this
    // shape are start_book_index / start_chapter, already set above.
    return base
  }

  // Sequential: swap the primary testament to the one the anchor sits in, and
  // keep the OTHER testament's start where the reader originally chose it, so
  // the second half of the plan still begins where they asked.
  const flipped: EnrollmentLite = anchorIsNT
    ? { ...base, reading_order: 'nt_then_ot' }
    : { ...base, reading_order: 'ot_then_nt' }

  if (anchorIsNT) {
    return {
      ...flipped,
      nt_start_book_index: pos.book_index,
      nt_start_chapter: pos.chapter,
      ot_start_book_index: enrollment.ot_start_book_index ?? 0,
      ot_start_chapter: enrollment.ot_start_chapter ?? 1,
    }
  }
  return {
    ...flipped,
    ot_start_book_index: pos.book_index,
    ot_start_chapter: pos.chapter,
    nt_start_book_index: enrollment.nt_start_book_index ?? NT_FIRST_BOOK_INDEX,
    nt_start_chapter: enrollment.nt_start_chapter ?? 1,
  }
}

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
  /**
   * Behind, but ONLY the recent part is still catch-up-able.
   *
   * This is the priority case and it is checked BEFORE the >7-day branches.
   * Rationale: a reader who is 23 days behind has already made peace with
   * having skipped the old material — offering to re-read it is noise, and
   * two competing buttons make them stop reading. But the LAST few days are
   * genuinely cheap to recover (≤7 days = one week's reading), and that is
   * the decision they can still act on. So the recent window wins, alone.
   */
  | {
      kind: 'catch_up'
      /** Days in the recent, still-recoverable window. */
      behindDays: number
      /** Every chapter scheduled across that window, in order. */
      missedRefs: string[]
      firstGap: GapBlock
      /** Total missed days, including the old ones we deliberately ignore. */
      totalBehindDays: number
      /**
       * Today's own scheduled chapters.
       *
       * The catch-up action is a READ, not a re-plan: it queues the missed
       * days AND today, so catching up lands the reader on today's lesson
       * rather than a few chapters behind it. Re-anchoring would move today
       * itself, which is not what "I missed three days" is asking for.
       */
      today: string[]
    }
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

  // ── Priority: the most recent gap, if it is still catch-up-able ──────────
  // Checked BEFORE the >7-day branches, and deliberately keyed on the last
  // gap BLOCK rather than a raw 7-day slice.
  //
  // A slice of the last 7 missed days is almost never contiguous: any day the
  // reader did manage to read sits inside it and splits it in two. Keying on
  // the block means the offer is always "read this unbroken run", which is
  // both answerable in one go and safe to re-anchor onto (a block's first day
  // cannot swallow a day the reader actually read).
  //
  // The priority is the whole point. A reader 23 days behind has already made
  // peace with the old material; offering it alongside the recent week as a
  // second button is what made the earlier version confusing. The last block
  // is the only part still cheap to recover, so it takes the card alone.
  if (lastGap.days <= CATCHUP_MAX_DAYS) {
    return {
      kind: 'catch_up',
      behindDays: lastGap.days,
      missedRefs: [...lastGap.refs],
      firstGap: {
        firstDate: lastGap.firstDate,
        lastDate: lastGap.lastDate,
        days: lastGap.days,
        refs: [...lastGap.refs],
      },
      totalBehindDays: behindDays,
      today: planForDate(today),
    }
  }

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

/**
 * Compute the start position for a plan re-anchored on `anchorDate`.
 *
 * For the parallel ('2-5') reading order both testaments advance together, so
 * the anchor day's refs are the SAME single position and we simply return its
 * first chapter. For the sequential orders ('nt_then_ot' / 'ot_then_nt') the
 * active testament on that day depends on whether the primary is already
 * finished, so the day's refs can span BOTH testaments — in that case the plan
 * is mid-flight and re-anchoring is not a simple matter of "one book, one
 * chapter"; we return the first ref and let the caller's start position keep
 * the sequential offset, which the plan generator already honours.
 *
 * @param enrollment the CURRENT enrollment (its start position is ignored)
 * @param books     canonical book list
 * @param anchorDate the day the reader chose to restart from
 * @returns the book index + chapter to start from, or null if unresolvable
 */
export function anchorPositionFor(
  enrollment: EnrollmentLite,
  books: BookMeta[],
  anchorDate: string,
): AnchorPosition | null {
  if (books.length === 0) return null

  // The plan as it stands today, keyed by date — the anchor day must be one
  // it actually scheduled, otherwise there is nothing to restart from.
  const current = generateReadingPlan(enrollment, books, 400)
  const refs = current.get(anchorDate) ?? []
  if (refs.length === 0) return null

  // Take the chapter the anchor day would have read FIRST. For a single
  // testament or a parallel order that is exactly the restart point; for a
  // sequential order mid-flight it is the correct head of the restart run.
  const firstRef = refs[0]
  const match = firstRef.match(/^(.+?)\s+(\d+)$/)
  if (!match) return null
  const bookName = match[1]
  const chapter = Number(match[2])
  const book = books.find((b) => b.name === bookName)
  if (!book || !Number.isFinite(chapter) || chapter < 1) return null

  return { book_index: book.index, chapter }
}

/** "馬太 1 – 馬太 3" for a span, or a single ref when the span is one chapter. */
export function describeRefSpan(refs: string[]): string {
  if (refs.length === 0) return '—'
  const first = shortRef(refs[0])
  const last = shortRef(refs[refs.length - 1])
  return first === last ? first : `${first} – ${last}`
}
