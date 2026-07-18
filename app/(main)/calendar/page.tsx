'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import CustomCalendar from '@/components/CustomCalendar'
import 'react-calendar/dist/Calendar.css'
import { formatReadingPlanFull } from '@/lib/chineseBibleAbbreviations'
import { createClient } from '@/lib/supabase/client'
import { getBooksMeta, type BookMeta } from '@/lib/bible/lookup'
import { generateReadingPlan } from '@/lib/bible/planGenerator'
import { celebrate } from '@/lib/confetti'
import { markDayCompleteBatch, unmarkDayComplete, markPlanComplete } from '@/lib/actions'
import { checkInAllMyGroups } from '@/lib/groupActions'

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
  // Delegate to the shared plan generator — handles all reading_order modes.
  return generateReadingPlan(enrollment, books, 400)
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
        .order('started_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (enrollmentError) {
        console.error('[calendar] enrollment error:', enrollmentError)
        setEnrollment(null)
      } else {
        setEnrollment(enrollmentData)
      }

      const { data: sessionsData } = enrollmentData && !enrollmentError
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
    // Defensive: only count sessions for the CURRENT enrollment. If somehow
    // stale sessions from a previous enrollment leak into state (e.g. after
    // a redesign where the user navigated quickly between pages), filter them
    // out here so the progress count stays accurate.
    const set = new Set<string>()
    sessions.forEach(s => {
      if (enrollment && s.enrollment_id === enrollment.id) {
        set.add(s.date_local)
      }
    })
    return set
  }, [sessions, enrollment])

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

    // Future-date guard (public launch): cannot mark a future day as complete
    if (key > hktToday) {
      alert('未到嘅日子無法標記完成')
      return
    }

    setIsCompleting(true)
    try {
      // Single RPC: bulk INSERT all chapters + recalculate stats server-side.
      // Replaces N × markLessonComplete() + recalcUserStatsAfterCompletion()
      // which saved ~N × (auth rtt + insert rtt) round-trips.
      const result = await markDayCompleteBatch(enrollment.id, refs, key)
      if (!result.success) {
        alert(`寫入失敗: ${result.error}`)
        setIsCompleting(false)
        return
      }

      // Sync group check-ins fire-and-forget (non-blocking)
      checkInAllMyGroups(key).catch(e => console.error('[handleCompleteDay] group sync err:', e))

      // Check if plan is now fully completed
      const newCompletedCount = completedDays.size + 1
      if (newCompletedCount >= plan.size) {
        await markPlanComplete(enrollment.id)
      }

      await celebrate({ type: 'burst', particleCount: Math.min(refs.length * 30, 180) })
      setSessions(prev => [...prev, ...refs.map((ref, i) => ({
        id: `new-${i}`,
        enrollment_id: enrollment.id,
        chapter_ref: ref,
        date_local: key,
      }))])
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 3000)
    } catch (error) {
      console.error('Complete error:', error)
      alert(`失敗: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsCompleting(false)
    }
  }, [plan, completedDays, enrollment])

  const handleUncompleteDay = useCallback(async (date: Date) => {
    const key = dateToHKDateString(date)
    if (!enrollment) return

    setIsCompleting(true)
    try {
      const result = await unmarkDayComplete(enrollment.id, key)
      if (!result.success) {
        alert(`取消失敗：${result.error}`)
        setIsCompleting(false)
        return
      }
      // Remove sessions for this date from local state
      setSessions(prev => prev.filter(s => s.date_local !== key))
      setShowSuccess(true)
      setTimeout(() => setShowSuccess(false), 3000)
    } catch (error) {
      console.error('Uncomplete error:', error)
      alert(`取消失敗：${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setIsCompleting(false)
    }
  }, [enrollment])

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
          <CustomCalendar plan={plan} completedDays={completedDays} selectedDate={selectedDate} onSelect={handleDateClick} onComplete={handleCompleteDay} onUncomplete={handleUncompleteDay} />
          <p className="text-xs text-muted mt-2 px-1 leading-relaxed">
            💡 完成進度㩒日子方格，不但有經驗值，記錄會加進「總章數」，並讓群組同伴知道你今日已完成！
          </p>
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
                <div className={`p-3 rounded-xl text-center font-bold ${
                  completedDays.has(selectedKey!) ? 'bg-[#D7FFB8] text-[#2D7A01] line-through' : 'bg-[var(--color-background)] text-[var(--color-ink)]'
                }`}>
                  {formatReadingPlanFull(selectedRefs)}
                </div>
                {completedDays.has(selectedKey!) ? (
                  <div className="text-center py-3 bg-[#D7FFB8] rounded-xl text-[#2D7A01] font-extrabold">
                    ✓ 已完成
                  </div>
                ) : selectedKey! > hktToday ? (
                  <div className="text-center py-3 bg-[var(--color-background)] rounded-xl text-[var(--color-muted)] font-bold">
                    🔒 此日尚未到期，無法標記完成
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
            <div className={`p-3 rounded-xl text-center font-bold ${
              completedDays.has(hktToday) ? 'bg-[#D7FFB8] text-[#2D7A01] line-through' : 'bg-[#FFF1A8] text-[var(--color-ink)]'
            }`}>
              {formatReadingPlanFull(todayRefs)}
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
