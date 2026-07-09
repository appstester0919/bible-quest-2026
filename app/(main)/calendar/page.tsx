'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import Calendar from 'react-calendar'
import 'react-calendar/dist/Calendar.css'
import { createClient } from '@/lib/supabase/client'
import { getBooksMeta, type BookMeta } from '@/lib/bible/lookup'
import { celebrate } from '@/lib/confetti'

interface Enrollment {
  id: string
  user_id: string
  scope: 'nt' | 'ot' | 'nt_ot'
  reading_order: string | null
  total_days: number
  chapters_per_day: number
  status: string
  created_at: string
  started_at: string
}

interface ReadingSession {
  id: string
  enrollment_id: string
  chapter_ref: string
  date_local: string
}

interface DayPlan {
  refs: string[]
  completed: boolean
}

function toHKDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
}

function dateToHKDateString(date: Date): string {
  return date.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
}

function getHKToday(): Date {
  const [y, m, d] = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' }).split('-').map(Number)
  return new Date(y, m - 1, d)
}

function buildPlan(enrollment: Enrollment, books: BookMeta[]): Map<string, string[]> {
  const plan = new Map<string, string[]>()
  const scopeBooks = enrollment.scope === 'nt'
    ? books.filter((_, i) => i >= 39)
    : enrollment.scope === 'ot'
    ? books.filter((_, i) => i < 39)
    : books

  let bookIdx = 0
  let chapterInBook = 1
  let start: Date
  if (enrollment.started_at) {
    const [y, m, d] = enrollment.started_at.split('T')[0].split('-').map(Number)
    start = new Date(y, m - 1, d)
  } else if (enrollment.created_at) {
    const [y, m, d] = enrollment.created_at.split('T')[0].split('-').map(Number)
    start = new Date(y, m - 1, d)
  } else {
    start = getHKToday()
  }

  let currentStr = toHKDateString(start)
  const MAX_DAYS = 400 // generate up to 400 days of plan

  for (let day = 0; day < MAX_DAYS && bookIdx < scopeBooks.length; day++) {
    const dayRefs: string[] = []
    for (let i = 0; i < enrollment.chapters_per_day && bookIdx < scopeBooks.length; i++) {
      const book = scopeBooks[bookIdx]
      dayRefs.push(`${book.name} ${chapterInBook}`)
      chapterInBook++
      if (chapterInBook > book.chapters) {
        bookIdx++
        chapterInBook = 1
      }
    }
    plan.set(currentStr, dayRefs)
    // Advance by one day (local HK date)
    const [cy, cm, cd] = currentStr.split('-').map(Number)
    const next = new Date(cy, cm - 1, cd + 1)
    currentStr = toHKDateString(next)
  }

  return plan
}

export default function CalendarPage() {
  const [user, setUser] = useState<{ id?: string } | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [sessions, setSessions] = useState<ReadingSession[]>([])
  const [books, setBooks] = useState<BookMeta[]>([])
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [isCompleting, setIsCompleting] = useState(false)
  const [showSuccess, setShowSuccess] = useState(false)
  const [loading, setLoading] = useState(true)

  const hktToday = useMemo(() => dateToHKDateString(new Date()), [])

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) { setLoading(false); return }
      setUser(authUser)

      const { data: enrollmentData, error: enrollmentError } = await supabase
        .from('user_plan_enrollments')
        .select('*')
        .eq('user_id', authUser.id)
        .eq('status', 'active')
        .maybeSingle()

      if (enrollmentError) console.error('Enrollment error:', enrollmentError)
      setEnrollment(enrollmentError ? null : enrollmentData)

      const { data: sessionsData } = enrollmentData
        ? await supabase.from('reading_sessions').select('*').eq('enrollment_id', enrollmentData.id)
        : { data: null as ReadingSession[] | null }
      setSessions(sessionsData ?? [])

      const res = await fetch('/bible-data.json')
      const bibleJson = await res.json()
      setBooks(getBooksMeta(bibleJson))
      setLoading(false)
    }
    fetchData()
  }, [])

  const plan = useMemo(() => {
    if (!enrollment || books.length === 0) return new Map<string, string[]>()
    return buildPlan(enrollment, books)
  }, [enrollment, books])

  const completedDays = useMemo(() => {
    const set = new Set<string>()
    sessions.forEach(s => set.add(s.date_local))
    return set
  }, [sessions])

  const tileContent = useCallback(({ date }: { date: Date }) => {
    const key = dateToHKDateString(date)
    const refs = plan.get(key)
    if (!refs || refs.length === 0) return null
    const completed = completedDays.has(key)
    return (
      <div className="text-xs mt-1 text-center leading-tight">
        {refs.slice(0, 2).map((ref, i) => (
          <div key={i} className={completed ? 'line-through opacity-60' : ''}>
            {ref.length > 8 ? ref.substring(0, 6) + '…' : ref}
          </div>
        ))}
        {refs.length > 2 && <div className="opacity-50">+{refs.length - 2}</div>}
      </div>
    )
  }, [plan, completedDays])

  const tileClassName = useCallback(({ date }: { date: Date }) => {
    const key = dateToHKDateString(date)
    const refs = plan.get(key)
    const completed = completedDays.has(key)
    const isToday = key === hktToday
    const isSelected = selectedDate && dateToHKDateString(selectedDate) === key

    let cls = 'relative '
    if (completed) {
      cls += isToday ? 'bg-green-300 ring-2 ring-[#22c55e] ' : 'bg-green-200 '
    } else if (isToday) {
      cls += 'bg-orange-100 ring-2 ring-orange-400 '
    } else if (refs && refs.length > 0) {
      cls += 'bg-amber-50 '
    }
    if (isSelected) cls += 'ring-2 ring-[#22c55e] '
    return cls
  }, [plan, completedDays, hktToday, selectedDate])

  const handleDateClick = useCallback(async (date: Date) => {
    setSelectedDate(date)
    const key = dateToHKDateString(date)
    const refs = plan.get(key)
    if (!refs || refs.length === 0) return
    if (completedDays.has(key) || !enrollment) return

    setIsCompleting(true)
    try {
      const supabase = createClient()
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) return

      const hktDate = new Date()
      const dateLocal = dateToHKDateString(hktDate)

      await Promise.all(refs.map(ref =>
        supabase.from('reading_sessions').insert({
          user_id: authUser.id,
          enrollment_id: enrollment.id,
          chapter_ref: ref,
          date_local: dateLocal,
        })
      ))

      celebrate({ type: 'burst', particleCount: 120 })
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 3000)
      setSessions(prev => [...prev, ...refs.map((ref, i) => ({
        id: `new-${i}`,
        enrollment_id: enrollment.id,
        chapter_ref: ref,
        date_local: dateLocal,
      }))])
    } catch (error) {
      console.error('Complete error:', error)
    } finally {
      setIsCompleting(false)
    }
  }, [plan, completedDays, enrollment])

  const todayRefs = plan.get(hktToday) ?? []
  const selectedKey = selectedDate ? dateToHKDateString(selectedDate) : ''
  const selectedRefs = selectedKey ? (plan.get(selectedKey) ?? []) : []

  const totalPlanDays = plan.size
  const completedCount = completedDays.size
  const progress = totalPlanDays > 0 ? Math.round((completedCount / totalPlanDays) * 100) : 0

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-[var(--color-muted)]">載入中...</div>
      </div>
    )
  }

  if (!enrollment) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-center p-8">
          <p className="text-4xl mb-4">📅</p>
          <h2 className="text-xl font-bold mb-2">尚未有讀經計劃</h2>
          <p className="text-[var(--color-muted)] mb-6">請先建立讀經計劃</p>
          <a href="/onboarding" className="px-6 py-3 bg-[var(--color-primary)] text-white rounded-2xl font-bold">
            開始計劃
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* Header */}
      <header className="bg-white px-4 py-3 shadow-sm">
        <h1 className="text-xl font-extrabold text-[var(--color-primary)]">📅 讀經日曆</h1>
      </header>

      <main className="max-w-sm mx-auto px-4 py-6 space-y-4">
        {/* Progress */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex justify-between items-center mb-2">
            <span className="font-bold text-[var(--color-primary)]">完成進度</span>
            <span className="text-sm text-[var(--color-muted)]">{completedCount}/{totalPlanDays} 天</span>
          </div>
          <div className="h-3 bg-[var(--color-muted)]/20 rounded-full overflow-hidden">
            <div className="h-full bg-[#22c55e] rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </div>

        {/* Calendar */}
        <div className="bg-white rounded-2xl overflow-hidden shadow-sm">
          <Calendar
            onChange={(value) => { if (value instanceof Date) handleDateClick(value) }}
            value={selectedDate}
            tileContent={tileContent}
            tileClassName={tileClassName}
            showNeighboringMonth={false}
            navigationLabel={({ date }) => `${date.getFullYear()}年${date.getMonth() + 1}月`}
            formatMonthYear={() => ''}
            prevLabel="‹"
            nextLabel="›"
            prev2Label={null}
            next2Label={null}
            locale="zh-TW"
            formatShortWeekday={() => ''}
            minDetail="month"
            maxDetail="month"
          />
        </div>

        <style>{`
          /* Weekday headers — Monday-first, Sunday-last */
          .react-calendar__month-view__weekdays {
            display: grid !important;
            grid-template-columns: repeat(7, 1fr) !important;
            text-align: center !important;
          }
          .react-calendar__month-view__weekdays abbr {
            text-decoration: none !important;
          }
          /* Mon-first column order (hide default, inject custom) */
          .react-calendar__month-view__weekdays > div {
            display: none !important;
          }
          /* Show custom labels instead */
          .react-calendar__month-view__weekdays::after {
            content: '一 二 三 四 五 六 日';
            display: grid !important;
            grid-template-columns: repeat(7, 1fr) !important;
            text-align: center !important;
            font-weight: 700 !important;
            font-size: 0.75rem !important;
            padding: 10px 0 6px !important;
            color: var(--color-muted, #9CA3AF) !important;
            letter-spacing: 0.05em !important;
          }
          .react-calendar__month-view__weekdays::after > span {
            display: block !important;
          }
          /* Saturday column = 6th (index 5, 0-based), red text */
          .react-calendar__month-view__days {
            display: grid !important;
            grid-template-columns: repeat(7, 1fr) !important;
          }
          /* Hide default weekday divs, use custom via ::after content */
          /* Reorder days: Mon=col0, Tue=col1, ..., Sun=col6 */
          .react-calendar__month-view__days > button:nth-child(7n+1) { grid-column: 1; }
          .react-calendar__month-view__days > button:nth-child(7n+2) { grid-column: 2; }
          .react-calendar__month-view__days > button:nth-child(7n+3) { grid-column: 3; }
          .react-calendar__month-view__days > button:nth-child(7n+4) { grid-column: 4; }
          .react-calendar__month-view__days > button:nth-child(7n+5) { grid-column: 5; }
          .react-calendar__month-view__days > button:nth-child(7n+6) { grid-column: 6; }
          .react-calendar__month-view__days > button:nth-child(7n) { grid-column: 7; }
          /* Saturday text red */
          .react-calendar__month-view__days > button:nth-child(7n) .react-calendar__day {
            color: #dc2626 !important;
          }
          .react-calendar__month-view__days > button:nth-child(7n) abbr {
            color: #dc2626 !important;
          }
          /* Sunday text normal (not red) */
          .react-calendar__month-view__days > button:nth-child(7n+1) abbr {
            color: var(--color-text, #1F2937) !important;
          }
          /* Tile styling */
          .react-calendar__tile {
            aspect-ratio: 1 !important;
            display: flex !important;
            flex-direction: column !important;
            align-items: center !important;
            justify-content: center !important;
            font-family: 'Nunito', sans-serif !important;
            font-size: 0.8rem !important;
            border-radius: 12px !important;
          }
          .react-calendar__tile abbr {
            text-decoration: none !important;
            display: block !important;
          }
          /* Navigation */
          .react-calendar__navigation {
            padding: 12px 8px !important;
          }
          .react-calendar__navigation button {
            font-family: 'Nunito', sans-serif !important;
            font-weight: 800 !important;
            font-size: 1.1rem !important;
            color: var(--color-primary, #1F2937) !important;
            background: transparent !important;
            border-radius: 8px !important;
            min-width: 36px !important;
            height: 36px !important;
          }
          .react-calendar__navigation button:hover {
            background: #f0f0f0 !important;
          }
          .react-calendar__navigation__label {
            font-size: 1rem !important;
            font-weight: 700 !important;
          }
          /* Remove default react-calendar border */
          .react-calendar {
            border: none !important;
            background: transparent !important;
            font-family: 'Nunito', sans-serif !important;
          }
          .react-calendar__month-view {
            border: none !important;
          }
        `}</style>

        {/* Selected Day Detail */}
        {selectedDate && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-[var(--color-primary)] mb-3">
              {selectedDate.toLocaleDateString('zh-TW', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </h3>
            {selectedRefs.length > 0 ? (
              <>
                <div className="space-y-2 mb-4">
                  {selectedRefs.map((ref, i) => (
                    <div key={i} className={`flex items-center gap-3 p-3 rounded-xl ${
                      completedDays.has(selectedKey!) ? 'bg-green-100' : 'bg-[var(--color-muted)]/10'
                    }`}>
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        completedDays.has(selectedKey!) ? 'bg-[#22c55e] text-white' : 'bg-[var(--color-muted)]/30'
                      }`}>
                        {completedDays.has(selectedKey!) ? '✓' : i + 1}
                      </span>
                      <span className="font-medium">{ref}</span>
                    </div>
                  ))}
                </div>
                {completedDays.has(selectedKey!) ? (
                  <div className="text-center py-2 bg-green-100 rounded-xl text-green-700 font-bold">
                    ✓ 已完成
                  </div>
                ) : (
                  <button
                    onClick={() => handleDateClick(selectedDate)}
                    disabled={isCompleting}
                    className="w-full py-3 bg-[#22c55e] text-white rounded-2xl font-bold hover:shadow-lg disabled:opacity-50"
                  >
                    {isCompleting ? '處理中...' : '標記完成 ✓'}
                  </button>
                )}
              </>
            ) : (
              <p className="text-[var(--color-muted)]">此日沒有讀經計劃</p>
            )}
          </div>
        )}

        {/* Today's Reading */}
        {todayRefs.length > 0 && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h3 className="font-bold text-[var(--color-primary)] mb-3">
              📖 今日功課 ({hktToday})
            </h3>
            <div className="space-y-2">
              {todayRefs.map((ref, i) => (
                <div key={i} className={`flex items-center gap-3 p-3 rounded-xl ${
                  completedDays.has(hktToday) ? 'bg-green-100' : 'bg-amber-50'
                }`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                    completedDays.has(hktToday) ? 'bg-[#22c55e] text-white' : 'bg-amber-300 text-amber-900'
                  }`}>
                    {completedDays.has(hktToday) ? '✓' : i + 1}
                  </span>
                  <span className="font-medium">{ref}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Success Banner */}
        {showSuccess && (
          <div className="fixed top-8 left-1/2 -translate-x-1/2 z-50 bg-[#22c55e] text-white px-6 py-3 rounded-2xl shadow-lg font-bold animate-bounce">
            ✓ 讀經完成！繼續努力！
          </div>
        )}
      </main>
    </div>
  )
}
