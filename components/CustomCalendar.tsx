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
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 12px 8px', background: '#f8fafc', borderRadius: '12px 12px 0 0' }}>
        <button
          onClick={prevMonth}
          style={{ minWidth: '44px', height: '44px', background: 'none', border: 'none', fontSize: '20px', fontWeight: 700, color: '#374151', cursor: 'pointer', borderRadius: '8px' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#e5e7eb')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >‹</button>
        <span style={{ fontWeight: 700, fontSize: '16px', color: '#1F2937', flexGrow: 1, textAlign: 'center' }}>{monthLabel}</span>
        <button
          onClick={nextMonth}
          style={{ minWidth: '44px', height: '44px', background: 'none', border: 'none', fontSize: '20px', fontWeight: 700, color: '#374151', cursor: 'pointer', borderRadius: '8px' }}
          onMouseEnter={(e) => (e.currentTarget.style.background = '#e5e7eb')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'none')}
        >›</button>
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
          const col = idx % 7
          const isSat = col === 5
          const isSun = col === 6
          const hasPlan = refs && refs.length > 0

          // Background by state
          let bg = '#fff'
          if (completed) {
            bg = isToday ? '#bbf7d0' : '#bbf7d0' // green-200
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
                cursor: hasPlan ? 'pointer' : 'default',
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
                fontSize: '14px',
                fontWeight: 700,
                color: completed ? '#16a34a' : dateNumColor,
                lineHeight: 1,
                marginBottom: '4px',
                textDecoration: completed ? 'line-through' : 'none',
                opacity: completed ? 0.7 : 1,
              }}>
                {day.date.getDate()}
              </span>

              {/* Plan text */}
              {hasPlan && (
                <div style={{
                  fontSize: '9px',
                  lineHeight: 1.1,
                  color: completed ? '#16a34a' : '#374151',
                  textAlign: 'center',
                  fontWeight: 500,
                  wordBreak: 'break-word',
                  textDecoration: completed ? 'line-through' : 'none',
                  opacity: completed ? 0.7 : 1,
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