/**
 * Reading scope utilities.
 * Scope chapter counts (canonical):
 *   nt     = 260 chapters  (Matthew → Revelation, books 39–64)
 *   ot     = 929 chapters  (Genesis → Malachi,  books 0–38)
 *   nt_ot  = 1189 chapters (all 65 books)
 */

export type Scope = 'nt' | 'ot' | 'nt_ot'

export const SCOPE_CHAPTERS: Record<Scope, number> = {
  nt: 260,
  ot: 929,
  nt_ot: 1189,
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
  nt_ot:  [4, 8, 12, 16, 20],
}

// ─── Pre-computed required days per scope & daily chapters ─────────────────

export const DAYS_TABLE: Record<Scope, Record<number, number>> = {
  nt: {
    1: 260,  2: 130, 3: 87,  4: 65,  5: 52,  6: 44,
    7: 38,   8: 33,  9: 29, 10: 26, 15: 18, 20: 13,
  },
  ot: {
    3: 310, 4: 233, 5: 186, 6: 155, 7: 133, 8: 117,
    9: 104, 10: 93, 15: 62, 17: 55, 20: 47,
  },
  nt_ot: {
    4: 298, 8: 149, 12: 99, 16: 75, 20: 60,
  },
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
