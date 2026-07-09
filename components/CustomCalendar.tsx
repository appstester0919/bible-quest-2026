'use client'

import { useState, useMemo } from 'react'
import { celebrate } from '@/lib/confetti'

interface CustomCalendarProps {
  plan: Map<string, string[]>
  completedDays: Set<string>
  selectedDate: Date | null
  onSelect: (date: Date) => void
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日']

function toHKDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
}

function getHKToday(): Date {
  const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' }).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export default function CustomCalendar({ plan, completedDays, selectedDate, onSelect }: CustomCalendarProps) {
  const [viewDate, setViewDate] = useState(() => {
    const today = getHKToday()
    return new Date(today.getFullYear(), today.getMonth(), 1)
  })

  const hktToday = toHKDateString(getHKToday())
  const selectedKey = selectedDate ? toHKDateString(selectedDate) : ''

  // Generate calendar grid for the current month
  const calendarDays = useMemo(() => {
    const year = viewDate.getFullYear()
    const month = viewDate.getMonth()
    const firstDay = new Date(year, month, 1)
    const lastDay = new Date(year, month + 1, 0)
    
    // Get the day of week of the first day (0=Sun, 1=Mon, ..., 6=Sat)
    // Convert to Mon-first: Mon=0, ..., Sun=6
    let firstDow = firstDay.getDay() // 0=Sun
    const firstCol = firstDow === 0 ? 6 : firstDow - 1 // Mon-first: Mon=col0, Sun=col6

    const days: Array<{ date: Date | null; key: string | null }> = []
    
    // Leading empty cells (before month starts)
    for (let i = 0; i < firstCol; i++) {
      days.push({ date: null, key: null })
    }
    
    // Days of the month
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const date = new Date(year, month, d)
      days.push({ date, key: toHKDateString(date) })
    }
    
    // Trailing empty cells (fill last row to 7)
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

  return (
    <div className="select-none">
      {/* Navigation */}
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={prevMonth}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-lg font-extrabold text-[#1F2937] hover:bg-gray-100 active:bg-gray-200 transition-colors"
        >‹</button>
        <span className="font-bold text-base text-[#1F2937]">{monthLabel}</span>
        <button
          onClick={nextMonth}
          className="w-9 h-9 flex items-center justify-center rounded-lg text-lg font-extrabold text-[#1F2937] hover:bg-gray-100 active:bg-gray-200 transition-colors"
        >›</button>
      </div>

      {/* Weekday header — separate grid, 7 cols */}
      <div className="grid grid-cols-7 px-3 pb-1">
        {WEEKDAY_LABELS.map((label, i) => (
          <div
            key={i}
            className="text-center text-xs font-bold tracking-wide"
            style={{ color: i === 5 ? '#ef4444' : '#9ca3af' }}
          >
            {label}
          </div>
        ))}
      </div>

      {/* Days grid — separate grid, 7 cols */}
      <div className="grid grid-cols-7 gap-1 px-3 pb-3">
        {calendarDays.map((day, idx) => {
          if (!day.date) {
            return <div key={`empty-${idx}`} className="aspect-square" />
          }

          const key = day.key!
          const refs = plan.get(key)
          const completed = completedDays.has(key)
          const isToday = key === hktToday
          const isSelected = key === selectedKey
          const col = idx % 7
          const isSat = col === 5
          const isSun = col === 6
          const hasColoredBg = completed || isToday || (refs && refs.length > 0)
          const dayColor = hasColoredBg
            ? '#1f2937'
            : isSat ? '#ef4444'
              : isSun ? '#374151'
              : '#1f2937'

          let bgClass = 'bg-transparent'
          let ringClass = ''
          if (completed) {
            bgClass = isToday ? 'bg-green-300' : 'bg-green-200'
            ringClass = isToday ? 'ring-2 ring-green-500' : ''
          } else if (isToday) {
            bgClass = 'bg-orange-100'
            ringClass = 'ring-2 ring-orange-400'
          } else if (refs && refs.length > 0) {
            bgClass = 'bg-amber-50'
          }
          if (isSelected && !isToday) {
            ringClass = 'ring-2 ring-green-500'
          }

          return (
            <button
              key={key}
              onClick={() => day.date && onSelect(day.date)}
              className={`
                relative aspect-square flex flex-col items-center justify-center
                rounded-xl transition-all text-sm font-semibold
                ${bgClass} ${ringClass}
                ${refs && refs.length > 0 && !completed ? 'font-bold' : ''}
                ${!refs || refs.length === 0 ? 'opacity-40' : 'opacity-100'}
              `}
              style={{ color: dayColor }}
            >
              <span>{day.date.getDate()}</span>
              {refs && refs.length > 0 && (
                <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 flex gap-px">
                  {refs.slice(0, 3).map((_, i) => (
                    <div
                      key={i}
                      className={`w-1 h-1 rounded-full ${completed ? 'bg-green-600' : 'bg-blue-400'}`}
                    />
                  ))}
                  {refs.length > 3 && (
                    <span className="text-[8px] text-gray-400 leading-none">+</span>
                  )}
                </div>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
