'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import CustomCalendar from '@/components/CustomCalendar'
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
        .order('created_at', { ascending: false })
        .limit(1)
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
  }, [])

  const handleCompleteDay = useCallback(async (date: Date) => {
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
      <div className="min-h-screen flex items-center justify-center px-[var(--spacing-md)] bg-[var(--color-background)]">
        <div className="card text-center max-w-sm w-full animate-scale-in">
          <div style={{ fontSize: 56, marginBottom: 16 }}>📅</div>
          <h2 className="h-section mb-2">尚未有讀經計劃</h2>
          <p className="text-muted mb-6">請先建立讀經計劃</p>
          <a href="/onboarding" className="btn btn-primary btn-block">
            開始計劃
          </a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* Header */}
      <header className="bg-[var(--color-surface)] px-4 py-3 shadow-sm sticky top-0 z-10">
        <h1 className="h-section flex items-center gap-2">📅 讀經日曆</h1>
      </header>

      <main className="max-w-sm mx-auto px-4 py-6 space-y-4 pb-24">
        {/* Progress card */}
        <div className="card">
          <div className="flex justify-between items-center mb-3">
            <span className="font-bold text-[var(--color-primary)]">完成進度</span>
            <span className="badge badge-success">{completedCount}/{totalPlanDays} 天</span>
          </div>
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <p className="text-xs text-muted mt-2 text-right">{progress}% 完成</p>
        </div>

        {/* Custom Mon-first Calendar */}
        <div className="card overflow-hidden">
          <CustomCalendar plan={plan} completedDays={completedDays} selectedDate={selectedDate} onSelect={handleDateClick} onComplete={handleCompleteDay} />
        </div>

        {/* Selected Day Detail */}
        {selectedDate && (
          <div className="card animate-scale-in">
            <h3 className="h-section mb-3">
              {selectedDate.toLocaleDateString('zh-TW', {
                year: 'numeric', month: 'long', day: 'numeric',
              })}
            </h3>
            {selectedRefs.length > 0 ? (
              <>
                <div className="space-y-2 mb-4">
                  {selectedRefs.map((ref, i) => (
                    <div key={i} className={`flex items-center gap-3 p-3 rounded-xl ${
                      completedDays.has(selectedKey!) ? 'bg-[#D7FFB8]' : 'bg-[var(--color-background)]'
                    }`}>
                      <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-extrabold ${
                        completedDays.has(selectedKey!) ? 'bg-[var(--color-success)] text-white' : 'bg-[var(--color-line)] text-[var(--color-ink-soft)]'
                      }`}>
                        {completedDays.has(selectedKey!) ? '✓' : i + 1}
                      </span>
                      <span className={`font-bold ${completedDays.has(selectedKey!) ? 'line-through text-muted' : ''}`}>{ref}</span>
                    </div>
                  ))}
                </div>
                {completedDays.has(selectedKey!) ? (
                  <div className="text-center py-3 bg-[#D7FFB8] rounded-xl text-[#2D7A01] font-extrabold">
                    ✓ 已完成
                  </div>
                ) : (
                  <button
                    onClick={() => handleDateClick(selectedDate)}
                    disabled={isCompleting}
                    className="btn btn-primary btn-block"
                  >
                    {isCompleting ? '處理中...' : '標記完成 ✓'}
                  </button>
                )}
              </>
            ) : (
              <p className="text-muted text-center py-4">此日沒有讀經計劃</p>
            )}
          </div>
        )}

        {/* Today's Reading */}
        {todayRefs.length > 0 && (
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <span style={{ fontSize: 20 }}>📖</span>
              <h3 className="h-section">今日功課</h3>
              <span className="badge badge-gem ml-auto">{hktToday}</span>
            </div>
            <div className="space-y-2">
              {todayRefs.map((ref, i) => (
                <div key={i} className={`flex items-center gap-3 p-3 rounded-xl ${
                  completedDays.has(hktToday) ? 'bg-[#D7FFB8]' : 'bg-[#FFF1A8]'
                }`}>
                  <span className={`w-7 h-7 rounded-full flex items-center justify-center text-sm font-extrabold ${
                    completedDays.has(hktToday) ? 'bg-[var(--color-success)] text-white' : 'bg-[var(--color-xp)] text-[var(--color-primary)]'
                  }`}>
                    {completedDays.has(hktToday) ? '✓' : i + 1}
                  </span>
                  <span className={`font-bold ${completedDays.has(hktToday) ? 'line-through text-muted' : ''}`}>{ref}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* Success Banner */}
      {showSuccess && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-50 bg-[var(--color-success)] text-white px-6 py-3 rounded-2xl shadow-lg font-extrabold animate-level-up">
          ✓ 讀經完成！繼續努力！
        </div>
      )}
    </div>
  )
}
