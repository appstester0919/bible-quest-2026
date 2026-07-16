// ============================================================================
// Reading plan generator — single source of truth for which chapters to read
// on each calendar date, given an enrollment's scope + reading_order.
//
// Handles 4 reading modes:
//   1. scope = 'nt'                          → read NT chapters linearly
//   2. scope = 'ot'                          → read OT chapters linearly
//   3. scope = 'nt_ot', order = 'parallel'  → daily split (e.g. NT 2 + OT 5)
//   4. scope = 'nt_ot', order = 'nt_then_ot' → finish all NT, then all OT
//   5. scope = 'nt_ot', order = 'ot_then_nt' → finish all OT, then all NT
//
// For mode 3 (parallel): reading_order stores "N-OT" format (e.g. "2-5")
// ============================================================================

import {
  getRemainingChapters,
  NT_FIRST_BOOK_INDEX,
  OT_FIRST_BOOK_INDEX,
} from './scope'

export type BookMeta = {
  name: string          // e.g. "創世記"
  abbr: string          // e.g. "創"
  /** 0-based canonical index (創 = 0, …, 瑪 = 38, 太 = 39, …, 啓 = 64) */
  index: number
  chapters: number
}

export type EnrollmentLite = {
  scope: 'nt' | 'ot' | 'nt_ot'
  chapters_per_day: number
  reading_order?: string | null  // for nt_ot: "2-5" / "nt_then_ot" / "ot_then_nt"
  started_at?: string | null
  /** 0-based NT book index (39=馬太 to 64=啟示錄) where NT reading starts.
   *  Defaults to 39 (馬太) when not provided. */
  nt_start_book_index?: number
  /** 0-based OT book index (0=創世記 to 38=瑪拉基) where OT reading starts.
   *  Defaults to 0 (創世記) when not provided. */
  ot_start_book_index?: number
  /** Generic single-column start (migration 010). For single-testament
   *  scopes ('nt' or 'ot') this is the canonical source; for 'nt_ot' use
   *  the per-testament columns above. */
  start_book_index?: number
  /** 1-based chapter within the start book (NT and OT share this).
   *  Defaults to 1 when not provided. */
  start_chapter?: number
  /** Per-testament start chapter (migration 013). For 'nt_ot' scope, these
   *  take precedence over start_chapter for the matching testament.
   *  Falls back to start_chapter when not provided. */
  nt_start_chapter?: number
  ot_start_chapter?: number
}

/** Default NT start (馬太福音 1 章) */
const DEFAULT_NT_START_BOOK = 39
/** Default OT start (創世記 1 章) */
const DEFAULT_OT_START_BOOK = 0
const DEFAULT_START_CHAPTER = 1

function toHKDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
}

function advanceDate(date: Date, days: number): Date {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

/**
 * Clamp start chapter into [1, bookChapters] range. Returns 1 if the input is
 * undefined / non-positive / exceeds the book's chapter count. This is the
 * defensive fallback for legacy enrollments that wrote the same start_chapter
 * for both testaments (e.g. OT chapter 110 stored against a 5-chapter NT book).
 */
function clampChapter(
  chapter: number | undefined,
  bookChapters: number
): number {
  if (!chapter || chapter < 1) return 1
  if (chapter > bookChapters) return 1
  return chapter
}

/**
 * Parse reading_order for parallel mode → { nt, ot } chapters per day.
 * Returns null if not parallel / not parseable.
 */
function parseParallelSplit(readingOrder: string | null): { nt: number; ot: number } | null {
  if (!readingOrder) return null
  const m = readingOrder.match(/^(\d+)-(\d+)$/)
  if (!m) return null
  return { nt: Number(m[1]), ot: Number(m[2]) }
}

/**
 * Generate the full reading plan map: date_string → chapter refs.
 *
 * @param enrollment  - the active plan enrollment
 * @param books       - full bible book list (65 books, OT first)
 * @param maxDays     - cap to prevent infinite loops (default 400)
 */
export function generateReadingPlan(
  enrollment: EnrollmentLite,
  books: BookMeta[],
  maxDays = 400
): Map<string, string[]> {
  const plan = new Map<string, string[]>()

  // ── Start date ──────────────────────────────────────────────────────────
  const start = enrollment.started_at
    ? new Date(enrollment.started_at.split('T')[0] + 'T00:00:00')
    : new Date()

  // ── Mode 1 & 2: linear single-testament ─────────────────────────────────
  if (enrollment.scope === 'nt' || enrollment.scope === 'ot') {
    const scopeBooks = enrollment.scope === 'nt'
      ? books.filter((b) => b.index >= 39)
      : books.filter((b) => b.index < 39)

    // Resolve start position: per-testament column takes precedence, then
    // start_book_index (single column from migration 010), then default.
    const startBook = enrollment.scope === 'nt'
      ? (enrollment.nt_start_book_index
          ?? enrollment.start_book_index
          ?? DEFAULT_NT_START_BOOK)
      : (enrollment.ot_start_book_index
          ?? enrollment.start_book_index
          ?? DEFAULT_OT_START_BOOK)
    const startChapter = enrollment.start_chapter ?? DEFAULT_START_CHAPTER

    // Find the array index in scopeBooks that corresponds to startBook
    const startBookArrIdx = scopeBooks.findIndex((b) => b.index === startBook)
    if (startBookArrIdx < 0) {
      // Out-of-range start (e.g. NT start but scope=ot) — skip plan
      return plan
    }

    let bookIdx = startBookArrIdx
    let chapterInBook = startChapter
    let date = new Date(start)

    for (let day = 0; day < maxDays && bookIdx < scopeBooks.length; day++) {
      const refs: string[] = []
      for (let i = 0; i < enrollment.chapters_per_day && bookIdx < scopeBooks.length; i++) {
        const book = scopeBooks[bookIdx]
        refs.push(`${book.name} ${chapterInBook}`)
        chapterInBook++
        if (chapterInBook > book.chapters) {
          bookIdx++
          chapterInBook = 1
        }
      }
      plan.set(toHKDateString(date), refs)
      date = advanceDate(date, 1)
    }
    return plan
  }

  // ── Mode 3+: nt_ot ──────────────────────────────────────────────────────
  const otBooks = books.filter((b) => b.index < 39)
  const ntBooks = books.filter((b) => b.index >= 39)

  const ro: string | null = enrollment.reading_order ?? null
  const split = parseParallelSplit(ro)
  const order = ro

  let date = new Date(start)

  if (split) {
    // ── Parallel: each day reads N chapters from NT + M chapters from OT ──
    // Fill behavior: if NT is exhausted within a day, the unused NT quota
    // is filled from OT (and vice versa). This avoids wasting quota while
    // one testament is finished early.
    // Issue #6: each testament starts at its own user-chosen position.
    // Remaining counts are derived from the start position so the plan
    // doesn't over-read past the end of the relevant testament.
    const ntStartBook = enrollment.nt_start_book_index
      ?? enrollment.start_book_index
      ?? DEFAULT_NT_START_BOOK
    const otStartBook = enrollment.ot_start_book_index
      ?? enrollment.start_book_index
      ?? DEFAULT_OT_START_BOOK
    // Per-testament start chapter takes precedence. For backwards compat with
    // enrollments written before migration 013 (single start_chapter column),
    // fall back to start_chapter and clamp to the start book's chapter count.
    const ntStartBookMeta = books.find((b) => b.index === ntStartBook)
    const otStartBookMeta = books.find((b) => b.index === otStartBook)
    const ntStartChapter = clampChapter(
      enrollment.nt_start_chapter ?? enrollment.start_chapter,
      ntStartBookMeta?.chapters ?? 999
    )
    const otStartChapter = clampChapter(
      enrollment.ot_start_chapter ?? enrollment.start_chapter,
      otStartBookMeta?.chapters ?? 999
    )

    // Compute initial remaining chapter counts. The books[] passed to
    // getRemainingChapters is the full 65-book list; the helper handles
    // per-testament scoping internally.
    const ntInitialRemaining = ntStartBook >= NT_FIRST_BOOK_INDEX
      ? getRemainingChapters('nt', books, ntStartBook, ntStartChapter)
      : 259
    const otInitialRemaining = otStartBook <= OT_FIRST_BOOK_INDEX + 38
      ? getRemainingChapters('ot', books, otStartBook, otStartChapter)
      : 929

    let ntBookArrIdx = ntBooks.findIndex((b) => b.index === ntStartBook)
    let otBookArrIdx = otBooks.findIndex((b) => b.index === otStartBook)
    if (ntBookArrIdx < 0) ntBookArrIdx = 0
    if (otBookArrIdx < 0) otBookArrIdx = 0

    let ntBookIdx = ntBookArrIdx, ntChapter = ntStartChapter, ntRemaining = ntInitialRemaining
    let otBookIdx = otBookArrIdx, otChapter = otStartChapter, otRemaining = otInitialRemaining

    for (let day = 0; day < maxDays && (ntRemaining > 0 || otRemaining > 0); day++) {
      const refs: string[] = []
      let ntQuota = split.nt
      let otQuota = split.ot

      // NT today — capped by remaining NT chapters
      let ntToday = Math.min(ntQuota, ntRemaining)
      for (let i = 0; i < ntToday && ntBookIdx < ntBooks.length; i++) {
        const book = ntBooks[ntBookIdx]
        refs.push(`${book.name} ${ntChapter}`)
        ntChapter++
        if (ntChapter > book.chapters) {
          ntBookIdx++
          ntChapter = 1
        }
      }
      ntRemaining -= ntToday

      // OT today — first read the planned OT quota, then fill any unused NT quota
      let otToday = Math.min(otQuota, otRemaining)
      for (let i = 0; i < otToday && otBookIdx < otBooks.length; i++) {
        const book = otBooks[otBookIdx]
        refs.push(`${book.name} ${otChapter}`)
        otChapter++
        if (otChapter > book.chapters) {
          otBookIdx++
          otChapter = 1
        }
      }
      otRemaining -= otToday

      // Fill unused NT quota with OT
      const unusedNtQuota = ntQuota - ntToday
      if (unusedNtQuota > 0 && otRemaining > 0) {
        const fillToday = Math.min(unusedNtQuota, otRemaining)
        for (let i = 0; i < fillToday && otBookIdx < otBooks.length; i++) {
          const book = otBooks[otBookIdx]
          refs.push(`${book.name} ${otChapter}`)
          otChapter++
          if (otChapter > book.chapters) {
            otBookIdx++
            otChapter = 1
          }
        }
        otRemaining -= fillToday
      }

      // Fill unused OT quota with NT (if NT still has remaining)
      const unusedOtQuota = otQuota - otToday
      if (unusedOtQuota > 0 && ntRemaining > 0) {
        const fillToday = Math.min(unusedOtQuota, ntRemaining)
        for (let i = 0; i < fillToday && ntBookIdx < ntBooks.length; i++) {
          const book = ntBooks[ntBookIdx]
          refs.push(`${book.name} ${ntChapter}`)
          ntChapter++
          if (ntChapter > book.chapters) {
            ntBookIdx++
            ntChapter = 1
          }
        }
        ntRemaining -= fillToday
      }

      plan.set(toHKDateString(date), refs)
      date = advanceDate(date, 1)
    }
    return plan
  }

  if (order === 'nt_then_ot' || order === 'ot_then_nt') {
    // ── Priority mode: read primary testament first each day; if the primary
    // testament is fully done, fill remaining daily quota from the secondary.
    //
    // Behavior:
    //   • nt_then_ot: read NT chapters first. Once NT is exhausted (within the
    //     day or globally), the remaining quota is filled from OT.
    //   • ot_then_nt: symmetric.
    //
    // Day layout for nt_then_ot at 6 ch/day:
    //   Day 1-43: 6 NT chapters
    //   Day 44:   NT has 260/260 done by chapter 2 → fill remaining 4 from OT
    //   Day 45+:  all 6 chapters from OT
    const primary   = order === 'nt_then_ot' ? ntBooks : otBooks
    const secondary = order === 'nt_then_ot' ? otBooks : ntBooks
    const primaryTotal   = order === 'nt_then_ot' ? 259 : 929
    const secondaryTotal = order === 'nt_then_ot' ? 929 : 259

    // Issue #6: primary testament starts at its user-chosen position;
    // secondary always starts from its testament head (it's only read
    // AFTER primary is done, so its start is implicitly 0/1 for OT or
    // 39/1 for NT — no need for a user-controlled start).
    const primaryStartBook = order === 'nt_then_ot'
      ? (enrollment.nt_start_book_index ?? enrollment.start_book_index ?? DEFAULT_NT_START_BOOK)
      : (enrollment.ot_start_book_index ?? enrollment.start_book_index ?? DEFAULT_OT_START_BOOK)
    const primaryStartChapter = enrollment.start_chapter ?? DEFAULT_START_CHAPTER

    const primaryScope: 'nt' | 'ot' = order === 'nt_then_ot' ? 'nt' : 'ot'
    const primaryInitialRemaining = getRemainingChapters(
      primaryScope, books, primaryStartBook, primaryStartChapter
    )

    let priBookArrIdx = primary.findIndex((b) => b.index === primaryStartBook)
    if (priBookArrIdx < 0) priBookArrIdx = 0

    let priBookIdx = priBookArrIdx, priChapter = primaryStartChapter, priRemaining = primaryInitialRemaining
    let secBookIdx = 0, secChapter = 1, secRemaining = secondaryTotal

    for (let day = 0; day < maxDays && (priRemaining > 0 || secRemaining > 0); day++) {
      const refs: string[] = []
      let quota = enrollment.chapters_per_day

      // Primary testament — read up to quota chapters
      const priToday = Math.min(quota, priRemaining)
      for (let i = 0; i < priToday && priBookIdx < primary.length; i++) {
        const book = primary[priBookIdx]
        refs.push(`${book.name} ${priChapter}`)
        priChapter++
        if (priChapter > book.chapters) {
          priBookIdx++
          priChapter = 1
        }
      }
      priRemaining -= priToday
      quota -= priToday

      // Secondary testament — fill any remaining quota
      const secToday = Math.min(quota, secRemaining)
      for (let i = 0; i < secToday && secBookIdx < secondary.length; i++) {
        const book = secondary[secBookIdx]
        refs.push(`${book.name} ${secChapter}`)
        secChapter++
        if (secChapter > book.chapters) {
          secBookIdx++
          secChapter = 1
        }
      }
      secRemaining -= secToday

      plan.set(toHKDateString(date), refs)
      date = advanceDate(date, 1)
    }
    return plan
  }

  // Fallback (legacy data without reading_order): linear NT+OT
  // Issue #6: respect start position by finding the first book in the
  // 0..64 range that's >= startBookIndex.
  const startBook = enrollment.start_book_index ?? DEFAULT_NT_START_BOOK
  const startChapter = enrollment.start_chapter ?? DEFAULT_START_CHAPTER
  const startBookArrIdx = books.findIndex((b) => b.index >= startBook)
  if (startBookArrIdx < 0) return plan

  const scopeBooks = books
  let bookIdx = startBookArrIdx
  let chapterInBook = startChapter
  for (let day = 0; day < maxDays && bookIdx < scopeBooks.length; day++) {
    const refs: string[] = []
    for (let i = 0; i < enrollment.chapters_per_day && bookIdx < scopeBooks.length; i++) {
      const book = scopeBooks[bookIdx]
      refs.push(`${book.name} ${chapterInBook}`)
      chapterInBook++
      if (chapterInBook > book.chapters) {
        bookIdx++
        chapterInBook = 1
      }
    }
    plan.set(toHKDateString(date), refs)
    date = advanceDate(date, 1)
  }
  return plan
}
