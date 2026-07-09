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
