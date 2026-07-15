/**
 * Reading scope utilities.
 * Scope chapter counts (canonical):
 *   nt     = 259 chapters  (Matthew → Revelation, books 39–64)
 *   ot     = 929 chapters  (Genesis → Malachi,  books 0–38)
 *   nt_ot  = 1188 chapters (all 65 books)
 *
 * NT count verified against public/bible-data.json (sum of chapters for
 * books[39..64] = 259). OT = 929. Total = 1188.
 */

export type Scope = 'nt' | 'ot' | 'nt_ot'

export const SCOPE_CHAPTERS: Record<Scope, number> = {
  nt: 259,
  ot: 929,
  nt_ot: 1188,
}

export const SCOPE_LABELS: Record<Scope, string> = {
  nt: '新約',
  ot: '舊約',
  nt_ot: '新約 + 舊約',
}

// ─── Daily chapter options per scope ─────────────────────────────────────────

export const DAILY_CHAPTER_OPTIONS: Record<Scope, number[]> = {
  nt:     [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20],
  ot:     [3, 4, 5, 6, 7, 8, 9, 10, 15, 17, 20],
  nt_ot:  [4, 5, 6, 7, 8, 9, 10, 12, 14, 16, 18, 20, 22],
}

// ─── Pre-computed required days per scope & daily chapters ─────────────────

// ─── Parallel-plan lookup for nt_ot scope ──────────────────────────────────────
// Key: total chapters/day (N = nt_ch + ot_ch). Value: { totalDays, nt_ch, ot_ch }
export const PARALLEL_TABLE: Record<number, { totalDays: number; nt: number; ot: number }> = {
  4:  { totalDays: 310, nt: 1,  ot: 3  },
  5:  { totalDays: 260, nt: 1,  ot: 4  },
  6:  { totalDays: 233, nt: 2,  ot: 4  },
  7:  { totalDays: 186, nt: 2,  ot: 5  },
  8:  { totalDays: 155, nt: 2,  ot: 6  },
  9:  { totalDays: 133, nt: 2,  ot: 7  },
  10: { totalDays: 130, nt: 2,  ot: 8  },
  12: { totalDays: 104, nt: 3,  ot: 9  },
  14: { totalDays: 87,  nt: 3,  ot: 11 },
  16: { totalDays: 78,  nt: 4,  ot: 12 },
  18: { totalDays: 67,  nt: 4,  ot: 14 },
  20: { totalDays: 62,  nt: 5,  ot: 15 },
  22: { totalDays: 55,  nt: 5,  ot: 17 },
}

// ─── Sequential nt_ot reading orders ──────────────────────────────────────────
// User reads ONE testament at a time, then the other.
// Total days = ceil(nt_chapters / cpd) + ceil(ot_chapters / cpd)
export type NtOtOrder = 'parallel' | 'nt_then_ot' | 'ot_then_nt'

export const NT_OT_ORDERS: { id: NtOtOrder; label: string; desc: string }[] = [
  { id: 'parallel',   label: '新舊並行',   desc: '每日新舊兩邊都讀；一邊完成後餘額自動填另一邊' },
  { id: 'nt_then_ot', label: '新約優先',   desc: '優先讀新約；當日新約讀完，餘下章數自動填舊約' },
  { id: 'ot_then_nt', label: '舊約優先',   desc: '優先讀舊約；當日舊約讀完，餘下章數自動填新約' },
]

/**
 * Compute total days for sequential nt_ot (one testament at a time).
 */
export function getSequentialDays(chaptersPerDay: number, order: 'nt_then_ot' | 'ot_then_nt'): number {
  const ntDays = Math.ceil(260 / chaptersPerDay)
  const otDays = Math.ceil(929 / chaptersPerDay)
  return order === 'nt_then_ot' ? ntDays + otDays : otDays + ntDays
}

export const DAYS_TABLE: Record<Scope, Record<number, number>> = {
  nt: {
    1: 260,  2: 130, 3: 87,  4: 65,  5: 52,  6: 44,
    7: 38,   8: 33,  9: 29, 10: 26, 15: 18, 20: 13,
  },
  ot: {
    3: 310, 4: 233, 5: 186, 6: 155, 7: 133, 8: 117,
    9: 104, 10: 93, 15: 62, 17: 55, 20: 47,
  },
  nt_ot: Object.fromEntries(
    Object.entries(PARALLEL_TABLE).map(([n, v]) => [Number(n), v.totalDays])
  ),
}

/**
 * Get the total chapter count for a scope.
 */
export function getTotalChapters(scope: Scope): number {
  return SCOPE_CHAPTERS[scope]
}

/**
 * Compute chapters per day = ceil(total_chapters / total_days).
 */
export function getChaptersPerDay(scope: Scope, totalDays: number): number {
  return Math.ceil(SCOPE_CHAPTERS[scope] / totalDays)
}

/**
 * Compute required days for a given daily chapter count.
 */
export function getRequiredDays(scope: Scope, chaptersPerDay: number): number {
  return Math.ceil(SCOPE_CHAPTERS[scope] / chaptersPerDay)
}

/**
 * Compute estimated completion date from a start date.
 */
export function getEstimatedCompletionDate(
  scope: Scope,
  totalDays: number,
  startDate: Date = new Date()
): Date {
  const chaptersPerDay = getChaptersPerDay(scope, totalDays)
  const actualDays = Math.ceil(SCOPE_CHAPTERS[scope] / chaptersPerDay)
  const d = new Date(startDate)
  d.setDate(d.getDate() + actualDays)
  return d
}

// ─── Start position (issue #6) ────────────────────────────────────────────

/** NT starts at index 39 (馬太福音) in the canonical 0-based book list */
export const NT_FIRST_BOOK_INDEX = 39
/** NT ends at index 64 (啟示錄) */
export const NT_LAST_BOOK_INDEX = 64
/** OT starts at index 0 (創世記) */
export const OT_FIRST_BOOK_INDEX = 0
/** OT ends at index 38 (瑪拉基書) */
export const OT_LAST_BOOK_INDEX = 38

/**
 * Compute the remaining chapter count from a custom start position to the
 * end of the relevant testament.
 *
 *   NT plan:    startBookIndex ∈ [39, 64] (馬太 to 啟示錄)
 *   OT plan:    startBookIndex ∈ [0, 38]  (創世記 to 瑪拉基)
 *   NT_OT plan: handled in planGenerator.ts (per-side starts)
 *
 * @param scope            'nt' | 'ot' (nt_ot not supported here — use
 *                         planGenerator for combined plans)
 * @param books            full 65-book list (OT first, NT second)
 * @param startBookIndex   0-based canonical book index (0=創, 39=太, 64=啓)
 * @param startChapter     1-based chapter within the start book
 * @returns                remaining chapter count, >= 1
 */
export function getRemainingChapters(
  scope: 'nt' | 'ot',
  books: { index: number; chapters: number }[],
  startBookIndex: number,
  startChapter: number
): number {
  // Restrict to the relevant testament
  const minBook = scope === 'nt' ? NT_FIRST_BOOK_INDEX : OT_FIRST_BOOK_INDEX
  const maxBook = scope === 'nt' ? NT_LAST_BOOK_INDEX : OT_LAST_BOOK_INDEX
  if (startBookIndex < minBook || startBookIndex > maxBook) {
    throw new Error(
      `startBookIndex ${startBookIndex} out of range for scope '${scope}' ` +
        `(expected ${minBook}..${maxBook})`
    )
  }
  if (startChapter < 1) {
    throw new Error(`startChapter must be >= 1, got ${startChapter}`)
  }

  // Sum chapters before startBookIndex (within this testament)
  const before = books
    .filter((b) => b.index >= minBook && b.index < startBookIndex)
    .reduce((sum, b) => sum + b.chapters, 0)

  // Validate: startChapter must not exceed the start book's chapter count
  const startBook = books.find((b) => b.index === startBookIndex)
  if (!startBook) {
    throw new Error(
      `startBookIndex ${startBookIndex} not present in bible book list`
    )
  }
  if (startChapter > startBook.chapters) {
    throw new Error(
      `startChapter ${startChapter} exceeds start book ` +
        `(${startBook.chapters} chapters)`
    )
  }

  const total = scope === 'nt' ? 259 : 929
  return total - before - (startChapter - 1)
}
