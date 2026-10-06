/**
 * Format a plan date for display, pinned to the Hong Kong reading day.
 *
 * Shared by onboarding and settings so 預計完成 reads identically wherever the
 * reader meets it — two copies of this helper is how the two pages drifted.
 */
export function formatPlanDate(date: Date): string {
  return date.toLocaleDateString('zh-Hant', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}
