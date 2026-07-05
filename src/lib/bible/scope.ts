/**
 * Bible scope constants and calculations
 * NT = New Testament (260 chapters)
 * OT = Old Testament (929 chapters)
 */

export const SCOPE_CHAPTERS = {
  nt: 260,     // 新約聖經章數
  ot: 929,     // 舊約聖經章數
  nt_ot: 1189, // 新約 + 舊約
} as const

export type Scope = keyof typeof SCOPE_CHAPTERS

export type ReadingOrder = 'nt_ot' | 'ot_nt' | 'parallel'

/**
 * Get total chapters for a scope
 */
export function getTotalChapters(scope: Scope): number {
  return SCOPE_CHAPTERS[scope]
}

/**
 * Calculate chapters per day for a given scope and total days
 */
export function getChaptersPerDay(scope: Scope, totalDays: number): number {
  return Math.ceil(SCOPE_CHAPTERS[scope] / totalDays)
}

/**
 * Calculate expected completion date
 */
export function getCompletionDate(startDate: Date, scope: Scope, totalDays: number): Date {
  const chaptersPerDay = getChaptersPerDay(scope, totalDays)
  const totalChapters = SCOPE_CHAPTERS[scope]
  const actualDaysNeeded = Math.ceil(totalChapters / chaptersPerDay)
  const completion = new Date(startDate)
  completion.setDate(completion.getDate() + actualDaysNeeded)
  return completion
}

/**
 * Format date as HK/Taiwan date string
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('zh-Hant', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
