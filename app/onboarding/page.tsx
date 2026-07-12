'use client'

import { Suspense } from 'react'
import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { completeOnboarding, redesignPlan } from './actions'
import {
  Scope,
  DAILY_CHAPTER_OPTIONS,
  DAYS_TABLE,
  PARALLEL_TABLE,
  NT_OT_ORDERS,
  NtOtOrder,
  getRequiredDays,
  getEstimatedCompletionDate,
  getSequentialDays,
} from '@/lib/bible/scope'
import { createClient } from '@/lib/supabase/client'

const SCOPES: { id: Scope; label: string; desc: string }[] = [
  { id: 'nt',     label: '新約',         desc: '260 章聖經' },
  { id: 'ot',     label: '舊約',         desc: '929 章聖經' },
  { id: 'nt_ot',  label: '新約 + 舊約',  desc: '1189 章聖經' },
]

function getMinDate(): string {
  const y = new Date().getFullYear()
  return `${y}-01-01`
}
function getToday(): string {
  // Use HK timezone — at midnight HKT, UTC is already previous day,
  // so toISOString() would block "today" selection.
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('zh-Hant', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

type OldEnrollment = {
  id: string
  scope: Scope
  chapters_per_day: number
  total_days: number
  started_at: string
}

export default function OnboardingPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-[var(--color-muted)]">載入中...</div>}>
      <OnboardingInner />
    </Suspense>
  )
}

function OnboardingInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isRedesign = searchParams.get('mode') === 'redesign'

  const [scope, setScope]         = useState<Scope>('nt')
  const [chaptersPerDay, setChapters] = useState(7)
  const [ntOtOrder, setNtOtOrder] = useState<NtOtOrder>('parallel')
  const [startDate, setStartDate]  = useState(getToday())
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  const [oldEnrollment, setOldEnrollment] = useState<OldEnrollment | null>(null)
  const [keepProgress, setKeepProgress] = useState(false)
  const [oldProgress, setOldProgress]   = useState<{ read: number; total: number } | null>(null)

  useEffect(() => {
    if (!isRedesign) return
    ;(async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const { data: enrollment } = await supabase
        .from('user_plan_enrollments')
        .select('id, scope, chapters_per_day, total_days, started_at, reading_order')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .maybeSingle()
      if (enrollment) {
        setOldEnrollment({
          id: enrollment.id,
          scope: enrollment.scope as Scope,
          chapters_per_day: enrollment.chapters_per_day,
          total_days: enrollment.total_days,
          started_at: enrollment.started_at,
        })
        setScope(enrollment.scope as Scope)
        setChapters(enrollment.chapters_per_day)

        const { count } = await supabase
          .from('reading_sessions')
          .select('*', { count: 'exact', head: true })
          .eq('enrollment_id', enrollment.id)
        setOldProgress({ read: count ?? 0, total: getRequiredDays(enrollment.scope as Scope, enrollment.chapters_per_day) * enrollment.chapters_per_day })
      }
    })()
  }, [isRedesign])

  const dailyOptions = DAILY_CHAPTER_OPTIONS[scope]
  const daysTable    = DAYS_TABLE[scope]
  const requiredDays = getRequiredDays(scope, chaptersPerDay)

  // nt_ot: 3 reading orders
  const parallelInfo = scope === 'nt_ot' && ntOtOrder === 'parallel' ? PARALLEL_TABLE[chaptersPerDay] : null

  // Plan days depends on nt_ot order
  let planDays: number
  if (scope === 'nt_ot' && ntOtOrder !== 'parallel') {
    planDays = getSequentialDays(chaptersPerDay, ntOtOrder as 'nt_then_ot' | 'ot_then_nt')
  } else if (parallelInfo) {
    planDays = parallelInfo.totalDays
  } else {
    planDays = requiredDays
  }

  // For parallel: nt/ot per day comes from PARALLEL_TABLE
  // For sequential: chaptersPerDay goes entirely to whichever testament is active
  const ntChapters   = scope === 'nt_ot' && ntOtOrder === 'parallel' ? (parallelInfo?.nt ?? 0) : (scope === 'nt_ot' ? chaptersPerDay : Math.ceil(260 / (planDays || 1)))
  const otChapters   = scope === 'nt_ot' && ntOtOrder === 'parallel' ? (parallelInfo?.ot ?? 0) : 0

  const completionDate = getEstimatedCompletionDate(scope, planDays, new Date(startDate + 'T00:00:00'))

  function handleScopeChange(s: Scope) {
    setScope(s)
    const opts = DAILY_CHAPTER_OPTIONS[s]
    if (!opts.includes(chaptersPerDay)) {
      setChapters(opts[Math.floor(opts.length / 2)])
    }
  }

  async function handleSubmit() {
    setLoading(true)
    setError('')
    if (isRedesign && oldEnrollment) {
      const result = await redesignPlan({
        oldEnrollmentId: oldEnrollment.id,
        scope,
        totalDays: planDays,
        startDate,
        ntChapters,
        otChapters,
        ntOtOrder,
        keepProgress,
      })
      if (result.error) {
        setError(result.error)
        setLoading(false)
      } else {
        router.push('/dashboard')
      }
    } else {
      const fd = new FormData()
      fd.append('scope', scope)
      fd.append('total_days', String(planDays))
      fd.append('start_date', startDate)
      if (scope === 'nt_ot') {
        // Parallel: "N-OT" format. Sequential: 'nt_then_ot' / 'ot_then_nt'
        const ro = ntOtOrder === 'parallel' ? `${ntChapters}-${otChapters}` : ntOtOrder
        fd.append('reading_order', ro)
      }
      const result = await completeOnboarding(fd)
      if (result.error) {
        setError(result.error)
        setLoading(false)
      } else {
        router.push('/dashboard')
      }
    }
  }

  return (
    <main className="min-h-screen flex flex-col bg-[var(--color-background)]">
      <div className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
        <a href="/dashboard" className="text-2xl text-[var(--color-muted)]">←</a>
        <h1 className="text-xl font-bold text-[var(--color-primary)]">
          {isRedesign ? '重新設計計劃' : '建立讀經計劃'}
        </h1>
      </div>

      <div className="flex-1 flex flex-col justify-center px-4 py-6">
        <div className="max-w-sm mx-auto w-full space-y-5">

          {isRedesign && oldEnrollment && (
            <div className="bg-amber-50 border-2 border-amber-200 rounded-2xl p-4 space-y-2">
              <div className="text-sm font-bold text-amber-900">📌 當前計劃</div>
              <div className="text-xs text-amber-800 space-y-0.5">
                <div>範圍：{oldEnrollment.scope === 'nt' ? '新約' : oldEnrollment.scope === 'ot' ? '舊約' : '新舊約'}</div>
                <div>每日 {oldEnrollment.chapters_per_day} 章 · 共 {getRequiredDays(oldEnrollment.scope, oldEnrollment.chapters_per_day)} 天</div>
                {oldProgress && (
                  <div>已完成 {oldProgress.read} 章 / {oldProgress.total} 章</div>
                )}
              </div>
              <label className="flex items-start gap-2 mt-3 pt-3 border-t border-amber-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={keepProgress}
                  onChange={(e) => setKeepProgress(e.target.checked)}
                  className="mt-0.5 w-4 h-4 accent-amber-600"
                />
                <div className="flex-1">
                  <div className="text-sm font-bold text-amber-900">
                    保留現時計劃嘅讀經進度
                  </div>
                  <div className="text-xs text-amber-700 mt-0.5">
                    {keepProgress
                      ? '原有 reading_sessions 保留喺資料庫，新計劃沿用原開始日期繼續讀'
                      : '原有讀經記錄保留喺資料庫，新計劃從今日重新開始'}
                  </div>
                </div>
              </label>
            </div>
          )}

          <div className="flex gap-2">
            {SCOPES.map((s) => (
              <button
                key={s.id}
                onClick={() => handleScopeChange(s.id)}
                className={`flex-1 py-2.5 px-2 rounded-xl font-bold text-sm transition-all border-2 ${
                  scope === s.id
                    ? 'bg-[var(--color-success)]/10 border-[var(--color-success)] text-[var(--color-success)]'
                    : 'bg-white border-[var(--color-muted)]/20 text-[var(--color-muted)] hover:border-[var(--color-muted)]/40'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <label className="text-sm font-bold text-[var(--color-primary)] block mb-2">
              📅 開始日期
            </label>
            <input
              type="date"
              value={startDate}
              min={getMinDate()}
              max={getToday()}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border border-[var(--color-muted)]/20 bg-[var(--color-background)] text-[var(--color-primary)] text-base"
            />
            <p className="text-xs text-[var(--color-muted)] mt-1.5">
              可選擇今天或之前的日期
            </p>
          </div>

          {/* Reading-order picker — only for nt_ot scope */}
          {scope === 'nt_ot' && (
            <div className="bg-white rounded-2xl p-4 shadow-sm">
              <div className="text-sm font-bold text-[var(--color-primary)] mb-3">
                🔀 讀經順序
              </div>
              <div className="grid grid-cols-3 gap-2">
                {NT_OT_ORDERS.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setNtOtOrder(o.id)}
                    className={`py-2 px-2 rounded-xl font-bold text-xs transition-all border-2 ${
                      ntOtOrder === o.id
                        ? 'bg-[var(--color-success)]/10 border-[var(--color-success)] text-[var(--color-success)]'
                        : 'bg-[var(--color-background)] border-[var(--color-muted)]/20 text-[var(--color-primary)] hover:border-[var(--color-muted)]/40'
                    }`}
                    title={o.desc}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
              <p className="text-xs text-[var(--color-muted)] mt-2">
                {NT_OT_ORDERS.find((o) => o.id === ntOtOrder)?.desc}
              </p>
            </div>
          )}

          <div className="bg-white rounded-2xl p-4 shadow-sm">
            <div className="text-sm font-bold text-[var(--color-primary)] mb-3">
              📖 每日章數
            </div>
            <div className="flex flex-wrap gap-2">
              {dailyOptions.map((n) => (
                <button
                  key={n}
                  onClick={() => setChapters(n)}
                  className={`py-2 px-3 rounded-xl font-bold text-sm transition-all ${
                    chaptersPerDay === n
                      ? 'bg-[var(--color-success)] text-white shadow-[var(--shadow-button)]'
                      : 'bg-[var(--color-background)] text-[var(--color-primary)] hover:bg-[var(--color-success)]/10'
                  }`}
                >
                  {n}章
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
            <div className="text-xs font-bold text-[var(--color-muted)] uppercase tracking-wider">
              計劃預覽
            </div>

            {scope !== 'nt_ot' ? (
              <div>
                <div className="text-xs text-[var(--color-muted)] mb-2">
                  計劃天數（揀每日章數後自動計算）
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(daysTable).map(([chapters, days]) => (
                    <div
                      key={chapters}
                      className={`py-2 px-3 rounded-xl text-sm font-bold transition-all ${
                        Number(chapters) === chaptersPerDay
                          ? 'bg-[var(--color-success)] text-white shadow-[var(--shadow-button)]'
                          : 'bg-[var(--color-background)] text-[var(--color-muted)]'
                      }`}
                    >
                      {days}天
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div>
                <div className="text-xs text-[var(--color-muted)] mb-2">
                  {ntOtOrder === 'parallel' ? '並行計劃天數' : '順序計劃天數'}
                </div>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(daysTable).map(([n, days]) => {
                    // Sequential: show actual total days for THIS order
                    const actualDays = ntOtOrder === 'parallel'
                      ? Number(days)
                      : getSequentialDays(Number(n), ntOtOrder as 'nt_then_ot' | 'ot_then_nt')
                    const isActive = chaptersPerDay === Number(n)
                    return (
                      <div
                        key={n}
                        onClick={() => setChapters(Number(n))}
                        className={`py-2 px-3 rounded-xl text-sm font-bold transition-all cursor-pointer ${
                          isActive
                            ? 'bg-[var(--color-success)] text-white shadow-[var(--shadow-button)]'
                            : 'bg-[var(--color-background)] text-[var(--color-muted)] hover:bg-[var(--color-success)]/10'
                        }`}
                      >
                        {n}章 · {actualDays}天
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-[var(--color-muted)]/10 space-y-1.5">
              {scope === 'nt_ot' && ntOtOrder === 'parallel' && parallelInfo ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--color-muted)]">新約章數</span>
                    <span className="font-bold text-[var(--color-primary)]">{ntChapters} 章/天</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--color-muted)]">舊約章數</span>
                    <span className="font-bold text-[var(--color-primary)]">{otChapters} 章/天</span>
                  </div>
                </>
              ) : scope === 'nt_ot' ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--color-muted)]">讀經順序</span>
                    <span className="font-bold text-[var(--color-primary)]">
                      {ntOtOrder === 'nt_then_ot' ? '先新後舊' : ntOtOrder === 'ot_then_nt' ? '先舊後新' : '並行'}
                    </span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--color-muted)]">新約用時</span>
                    <span className="font-bold text-[var(--color-primary)]">{Math.ceil(260 / chaptersPerDay)} 天</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[var(--color-muted)]">舊約用時</span>
                    <span className="font-bold text-[var(--color-primary)]">{Math.ceil(929 / chaptersPerDay)} 天</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--color-muted)]">每日章數</span>
                  <span className="font-bold text-[var(--color-primary)]">{chaptersPerDay} 章</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-muted)]">總天數</span>
                <span className="font-bold text-[var(--color-primary)]">{planDays} 天</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-muted)]">開始日期</span>
                <span className="font-bold text-[var(--color-primary)]">
                  {new Date(startDate + 'T00:00:00').toLocaleDateString('zh-Hant', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: 'long', day: 'numeric' })}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-muted)]">預計完成</span>
                <span className="font-bold text-[var(--color-success)]">{formatDate(completionDate)}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 rounded-lg text-sm text-[var(--color-danger)] text-center">
              {error}
            </div>
          )}

          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-3.5 px-4 bg-[var(--color-success)] text-white rounded-xl font-extrabold text-base shadow-[var(--shadow-button)] hover:bg-[#46A302] active:translate-y-0.5 active:shadow-none transition-all disabled:opacity-60"
          >
            {loading ? '建立中...' : isRedesign ? '確認重新設計' : '開始讀經！'}
          </button>

        </div>
      </div>
    </main>
  )
}
