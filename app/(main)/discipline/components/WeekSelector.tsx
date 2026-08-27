'use client'

/**
 * WeekSelector — pick any ISO week, default to current.
 *
 * Used by /discipline/weekly to switch between weeks for late fill-in.
 * ISO week numbering: weeks start Monday; week 1 = first week with a Thursday.
 *
 * Stored value: ISO year + week, formatted as "YYYY-Www" (e.g. "2026-W34").
 */

import { useMemo } from 'react'

type Props = {
  /** Current week in "YYYY-Www" format */
  value: string
  onChange: (next: string) => void
}

/** Convert Date to ISO "YYYY-Www" string */
export function isoWeekString(d: Date): string {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = (target.getUTCDay() + 6) % 7 // Mon=0 ... Sun=6
  target.setUTCDate(target.getUTCDate() - dayNum + 3) // nearest Thursday
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4))
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    )
  const year = target.getUTCFullYear()
  return `${year}-W${String(week).padStart(2, '0')}`
}

/** Get the Monday (start) of an ISO week */
function startOfISOWeek(iso: string): Date {
  const [yearStr, weekStr] = iso.split('-W')
  const year = parseInt(yearStr, 10)
  const week = parseInt(weekStr, 10)
  // Jan 4 is always in week 1
  const jan4 = new Date(year, 0, 4)
  const jan4Day = (jan4.getDay() + 6) % 7 // Mon=0
  const mondayWeek1 = new Date(jan4)
  mondayWeek1.setDate(jan4.getDate() - jan4Day)
  const monday = new Date(mondayWeek1)
  monday.setDate(mondayWeek1.getDate() + (week - 1) * 7)
  return monday
}

/** Step an ISO week by ±N weeks */
export function shiftWeek(iso: string, delta: number): string {
  const monday = startOfISOWeek(iso)
  monday.setDate(monday.getDate() + delta * 7)
  return isoWeekString(monday)
}

/** Pretty range, e.g. "8月18日 – 8月24日" */
function weekRangeLabel(iso: string): string {
  const monday = startOfISOWeek(iso)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = (d: Date) => `${d.getMonth() + 1}月${d.getDate()}日`
  return `${fmt(monday)} – ${fmt(sunday)}`
}

export default function WeekSelector({ value, onChange }: Props) {
  const currentWeek = useMemo(() => isoWeekString(new Date()), [])
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

/** Convenience: get all 7 dates (Mon..Sun) for an ISO week */
export function weekDates(iso: string): Date[] {
  const monday = startOfISOWeek(iso)
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday)
    d.setDate(monday.getDate() + i)
    return d
  })
}