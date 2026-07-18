'use client'

import { useState, useMemo } from 'react'
import { celebrate } from '@/lib/utils/confetti'
import { parseReadingPlan } from '@/lib/chineseBibleAbbreviations'

interface CustomCalendarProps {
  plan: Map<string, string[]>
  completedDays: Set<string>
  selectedDate: Date | null
  onSelect: (date: Date) => void
  onComplete: (date: Date) => Promise<void>
  onUncomplete: (date: Date) => Promise<void>
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function toHKDateString(date: Date): string {
  const [y, m, d] = date.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' }).split('-').map(Number)
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function getHKToday(): string {
  return toHKDateString(new Date())
}

export default function CustomCalendar({ plan, completedDays, selectedDate, onSelect, onComplete, onUncomplete }: CustomCalendarProps) {
  const [viewDate, setViewDate] = useState(() => {
    const today = new Date()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })

  // Day-cell font size (controls plan text below the date number). Persist in
  // localStorage so the user's preferred scale survives across sessions.
  const [dayFontScale, setDayFontScale] = useState(() => {
    if (typeof window === 'undefined') return 1
    const saved = window.localStorage.getItem('bq_calendar_day_font_scale')
    const n = saved ? Number(saved) : 1
    return Number.isFinite(n) && n >= 0.8 && n <= 1.6 ? n : 1
  })
  const adjustFont = (delta: number) => {
    setDayFontScale((s) => {
      const next = Math.min(1.6, Math.max(0.8, +(s + delta).toFixed(2)))
      try { window.localStorage.setItem('bq_calendar_day_font_scale', String(next)) } catch {}
      return next
    })
  }

  const hktToday = getHKToday()
  const selectedKey = selectedDate ? toHKDateString(selectedDate) : ''

  // Generate calendar grid for the current month
  const calendarDays = useMemo(() => {
    const year = viewDate.getFullYear()
    const month = viewDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)

    // Mon-first: Mon=col0, ..., Sun=col6
    let firstDow = firstDay.getDay() // 0=Sun, 1=Mon, ..., 6=Sat
    const firstCol = firstDow === 0 ? 6 : firstDow - 1

    const days: Array<{ date: Date | null; key: string | null }> = []

    // Leading empty cells
    for (let i = 0; i < firstCol; i++) {
      days.push({ date: null, key: null })
    }

    // Days of the month
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d)
      days.push({ date, key: toHKDateString(date) })
    }

    // Trailing empty cells
    while (days.length % 7 !== 0) {
      days.push({ date: null, key: null })
    }

    return days
  }, [viewDate])

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()
  const prevMonth = () => setViewDate(new Date(year, month - 1, 1))
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1))
  const monthLabel = `${year}年${month + 1}月`

  // Group into weeks
  const weeks: Array<Array<typeof calendarDays[0]>> = []
  for (let i = 0; i < calendarDays.length; i += 7) {
    weeks.push(calendarDays.slice(i, i + 7))
  }

  const handleTileClick = async (day: typeof calendarDays[0]) => {
    if (!day.date || !day.key) return

    // Future-date guard (public launch): cannot mark a future day as complete
    // Allow past/today to keep existing complete/uncomplete flows intact.
    if (day.key > hktToday) {
      onSelect(day.date) // still let user inspect future reading plan
      return
    }

    onSelect(day.date)
    // If already completed, uncomplete it
    if (completedDays.has(day.key)) {
      try {
        await onUncomplete(day.date)
      } catch (e) {
        // silently ignore
      }
      return
    }
    // If not yet completed and has reading plan, mark complete + celebrate
    if (plan.has(day.key)) {
      try {
        await onComplete(day.date)
        await celebrate({ type: 'basic', particleCount: 100 })
      } catch (e) {
        // silently ignore
      }
    }
  }

  return (
    <div style={{ width: '100%' }}>
      {/* Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 8px 8px', background: '#f8fafc', borderRadius: '12px 12px 0 0', gap: 6 }}>
        <button
          onClick={prevMonth}
          aria-label="上一月"
          style={{ minWidth: '44px', height: '44px', background: 'none', border: 'none', fontSize: '20px', fontWeight: 700, color: '#374151', cursor: 'pointer', borderRadius: '8px' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#e5e7eb')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >‹</button>
        <span style={{ fontWeight: 700, fontSize: '16px', color: '#1F2937', flexGrow: 1, textAlign: 'center' }}>{monthLabel}</span>
        <button
          onClick={nextMonth}
          aria-label="下一月"
          style={{ minWidth: '44px', height: '44px', background: 'none', border: 'none', fontSize: '20px', fontWeight: 700, color: '#374151', cursor: 'pointer', borderRadius: '8px' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#e5e7eb')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >›</button>
        {/* Day-cell font size controls (affects plan text inside each day tile) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, paddingLeft: 6, marginLeft: 4, borderLeft: '1px solid #e5e7eb' }}>
          <button
            onClick={() => adjustFont(-0.15)}
            disabled={dayFontScale <= 0.8}
            aria-label="縮小方格字體"
            title="縮小日子方格字體"
            style={{
              minWidth: 36, height: 36, borderRadius: 8, border: '1px solid #d1d5db',
              background: dayFontScale <= 0.8 ? '#f3f4f6' : '#ffffff',
              color: dayFontScale <= 0.8 ? '#9ca3af' : '#374151',
              fontSize: 13, fontWeight: 800, cursor: dayFontScale <= 0.8 ? 'not-allowed' : 'pointer',
            }}
          >A−</button>
          <button
            onClick={() => adjustFont(0.15)}
            disabled={dayFontScale >= 1.6}
            aria-label="放大方格字體"
            title="放大日子方格字體"
            style={{
              minWidth: 36, height: 36, borderRadius: 8, border: '1px solid #58CC02',
              background: dayFontScale >= 1.6 ? '#f3f4f6' : '#E8F8E0',
              color: dayFontScale >= 1.6 ? '#9ca3af' : '#2D7A01',
              fontSize: 13, fontWeight: 800, cursor: dayFontScale >= 1.6 ? 'not-allowed' : 'pointer',
            }}
          >A+</button>
        </div>
      </div>

      {/* Weekday header */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '1px', background: '#e5e7eb', borderBottom: '1px solid #e5e7eb' }}>
        {WEEKDAY_LABELS.map((label, i) => (
          <div
            key={i}
            style={{
              padding: '8px 0',
              textAlign: 'center',
              fontSize: '12px',
              fontWeight: 700,
              color: i === 6 ? '#ef4444' : '#6b7280',
              background: '#f9fafb',
              textTransform: 'uppercase',
            }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Days grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: '1px', background: '#e5e7eb' }}>
        {calendarDays.map((day, idx) => {
          if (!day.date) {
            return <div key={`empty-${idx}`} style={{ background: '#fff', minHeight: '60px' }} />
          }

          const key = day.key!
          const refs = plan.get(key)
          const completed = completedDays.has(key)
          const isToday = key === hktToday
          const isFuture = key > hktToday
          const col = idx % 7
          const isSat = col === 5
          const isSun = col === 6
          const hasPlan = refs && refs.length > 0

          // Background by state
          let bg = '#fff'
          if (completed) {
            bg = isToday ? '#bbf7d0' : '#bbf7d0' // green-200
          } else if (isFuture) {
            bg = '#f3f4f6' // gray-100 — visually muted, signals "not yet"
          } else if (isToday) {
            bg = '#fef9c3' // yellow-100
          } else if (hasPlan) {
            bg = '#fff' // white
          } else {
            bg = '#f9fafb' // gray-50
          }

          // Border ring for today (visible blue ring)
          const ringStyle = isToday ? 'inset 0 0 0 2px #60a5fa' : 'none'

          // Date number color: red Sunday, normal others (Saturday normal since it's a weekday)
          const dateNumColor = isSun ? '#ef4444' : '#1F2937'

          // Parse reading plan for display
          const planText = hasPlan && refs ? parseReadingPlan(refs) : ''

          return (
            <button
              key={key}
              onClick={() => handleTileClick(day)}
              style={{
                background: bg,
                border: 'none',
                borderRadius: '0',
                padding: '4px 2px',
                cursor: hasPlan && !isFuture ? 'pointer' : 'default',
                minHeight: '60px',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-start',
                boxShadow: ringStyle,
                position: 'relative',
                transition: 'background 0.15s',
              }}
              title={planText || `${key}${hasPlan ? ' — ' + planText : ''}`}
            >
              {/* Date number */}
              <span style={{
                fontSize: `${Math.round(14 * dayFontScale)}px`,
                fontWeight: 700,
                color: completed ? '#16a34a' : dateNumColor,
                lineHeight: 1,
                marginBottom: '4px',
                textDecoration: completed ? 'line-through' : 'none',
                opacity: completed ? 0.7 : (isFuture ? 0.4 : 1),
              }}>
                {day.date.getDate()}
              </span>

              {/* Plan text */}
              {hasPlan && (
                <div style={{
                  fontSize: `${Math.max(8, Math.round(9 * dayFontScale))}px`,
                  lineHeight: 1.15,
                  color: completed ? '#16a34a' : '#374151',
                  textAlign: 'center',
                  fontWeight: 500,
                  wordBreak: 'break-word',
                  textDecoration: completed ? 'line-through' : 'none',
                  opacity: completed ? 0.7 : (isFuture ? 0.4 : 1),
                  padding: '0 2px',
                }}>
                  {planText}
                </div>
              )}

              {/* Completion check */}
              {completed && (
                <div style={{
                  position: 'absolute',
                  top: '2px',
                  right: '4px',
                  color: '#16a34a',
                  fontSize: '12px',
                  fontWeight: 700,
                  lineHeight: 1,
                }}>✓</div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}