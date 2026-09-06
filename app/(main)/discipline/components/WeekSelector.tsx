'use client'

/**
 * WeekSelector — pick any Sat-based week, default to current.
 *
 * Used by /discipline/weekly to switch between weeks for late fill-in.
 *
 * Week boundaries: SAT→FRI (牧會/營會週). The 7-day window covers
 * Sat, Sun, Mon, Tue, Wed, Thu, Fri in that order — matches
 * DAY_HEADERS in /discipline/weekly/page.tsx.
 *
 * Stored value: ISO year + week, formatted as "YYYY-Www"
 * (e.g. "2026-W36" = Sat 9月5日 → Fri 9月11日).
 *
 * Round-20 (2026-09-06) — switched from ISO Mon-based week (Round-19 era)
 * to Sat-based week boundaries so the printed worksheet layout
 * (Sat..Fri columns) lines up with the displayed date numbers.
 *
 * Migration note (Round-20): cells["sat"] + cells["sun"] round-trip
 * cleanly because both algorithms agree those two days fall on the
 * same calendar date for the same week label. cells["mon"]..["fri"]
 * shift by 7 days under the new algorithm — any previously-saved
 * weekday records will land on the wrong day after deploy; the
 * /discipline/weekly page shows a one-time banner explaining this.
 */

import { useMemo } from 'react'

type Props = {
  /** Current week in "YYYY-Www" format */
  value: string
  onChange: (next: string) => void
}

/** Convert Date to "YYYY-Www" string where week starts Saturday. */
export function weekString(d: Date): string {
  // Clone to avoid mutating caller's date.
  const ref = new Date(d.getFullYear(), d.getMonth(), d.getDate())
  // JS getDay(): Sun=0..Sat=6. We want Sat=0..Fri=6.
  // dayShift = 0 if Sat, 1 if Sun, 2 if Mon, ..., 6 if Fri.
  const dayShift = (ref.getDay() + 1) % 7
  // Saturday of this week (anchor).
  ref.setDate(ref.getDate() - dayShift)

  // Find Jan 1 of ref's year, then walk forward to the first Saturday —
  // that's the first week's anchor. Week 1 = the week containing Jan 1.
  const jan1 = new Date(ref.getFullYear(), 0, 1)
  const jan1Shift = (jan1.getDay() + 1) % 7
  const firstSaturday = new Date(jan1)
  firstSaturday.setDate(jan1.getDate() - jan1Shift)

  const daysSinceFirstSat = Math.round(
    (ref.getTime() - firstSaturday.getTime()) / 86400000
  )
  const week = Math.floor(daysSinceFirstSat / 7) + 1
  const year = ref.getFullYear()
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Back-compat alias for callers that still import isoWeekString. */
export const isoWeekString = weekString

/** Get the Saturday (start) of a Sat-based week. */
function startOfWeek(iso: string): Date {
  const [yearStr, weekStr] = iso.split('-W')
  const year = parseInt(yearStr, 10)
  const week = parseInt(weekStr, 10)
  const jan1 = new Date(year, 0, 1)
  const jan1Shift = (jan1.getDay() + 1) % 7
  const firstSaturday = new Date(jan1)
  firstSaturday.setDate(jan1.getDate() - jan1Shift)
  const saturday = new Date(firstSaturday)
  saturday.setDate(firstSaturday.getDate() + (week - 1) * 7)
  return saturday
}

/** Back-compat alias. */
export const startOfISOWeek = startOfWeek

/** Step a Sat-based week by ±N weeks. */
export function shiftWeek(iso: string, delta: number): string {
  const saturday = startOfWeek(iso)
  saturday.setDate(saturday.getDate() + delta * 7)
  return weekString(saturday)
}

/** Pretty range, e.g. "9月5日 – 9月11日" (Sat..Fri). */
function weekRangeLabel(iso: string): string {
  const saturday = startOfWeek(iso)
  const friday = new Date(saturday)
  friday.setDate(saturday.getDate() + 6)
  const fmt = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`
  return `${fmt(saturday)} – ${fmt(friday)}`
}

export default function WeekSelector({ value, onChange }: Props) {
  const currentWeek = useMemo(() => weekString(new Date()), [])
  const isCurrent = value === currentWeek
  const label = useMemo(() => weekRangeLabel(value), [value])

  return (
    <div className="week-selector">
      <button
        type="button"
        className="week-selector-arrow"
        aria-label="上一週"
        onClick={() => onChange(shiftWeek(value, -1))}
      >
        ‹
      </button>
      <div className="week-selector-center">
        <span className="week-selector-week">{value}</span>
        <span className="week-selector-range">{label}</span>
        {isCurrent && <span className="week-selector-badge">本週</span>}
      </div>
      <button
        type="button"
        className="week-selector-arrow"
        aria-label="下一週"
        onClick={() => onChange(shiftWeek(value, +1))}
      >
        ›
      </button>
    </div>
  )
}

/** Convenience: get all 7 dates (Sat..Fri) for a Sat-based week. */
export function weekDates(iso: string): Date[] {
  const saturday = startOfWeek(iso)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(saturday)
    d.setDate(saturday.getDate() + i)
    return d
  })
}
