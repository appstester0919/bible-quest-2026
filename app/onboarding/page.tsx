'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { completeOnboarding } from './actions'
import {
  Scope,
  DAILY_CHAPTER_OPTIONS,
  DAYS_TABLE,
  getRequiredDays,
  getEstimatedCompletionDate,
} from '@/lib/bible/scope'

// ─── Constants ─────────────────────────────────────────────────────────────────

const SCOPES: { id: Scope; label: string; desc: string }[] = [
  { id: 'nt',     label: '新約',         desc: '260 章聖經' },
  { id: 'ot',     label: '舊約',         desc: '929 章聖經' },
  { id: 'nt_ot',  label: '新約 + 舊約',  desc: '1189 章聖經' },
]

// Start date range: today → Jan 1 of this year
function getMinDate(): string {
  const y = new Date().getFullYear()
  return `${y}-01-01`
}
function getToday(): string {
  return new Date().toISOString().split('T')[0]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(date: Date): string {
  return date.toLocaleDateString('zh-Hant', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const [scope, setScope]         = useState<Scope>('nt')
  const [chaptersPerDay, setChapters] = useState(7)
  const [startDate, setStartDate]  = useState(getToday())
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')

  const dailyOptions = DAILY_CHAPTER_OPTIONS[scope]
  const daysTable    = DAYS_TABLE[scope]
  const requiredDays = getRequiredDays(scope, chaptersPerDay)
  const completionDate = getEstimatedCompletionDate(scope, requiredDays, new Date(startDate + 'T00:00:00'))

  // Reset chapters if current choice isn't in new scope's options
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
    const fd = new FormData()
    fd.append('scope', scope)
    fd.append('total_days', String(requiredDays))
    fd.append('start_date', startDate)
    const result = await completeOnboarding(fd)
    if (result.error) {
      setError(result.error)
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  return (
    <main className="min-h-screen flex flex-col bg-[var(--color-background)]">
      {/* Header */}
      <div className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
        <a href="/dashboard" className="text-2xl text-[var(--color-muted)]">←</a>
        <h1 className="text-xl font-bold text-[var(--color-primary)]">建立讀經計劃</h1>
      </div>

      <div className="flex-1 flex flex-col justify-center px-4 py-6">
        <div className="max-w-sm mx-auto w-full space-y-5">

          {/* ── Scope Tabs ─────────────────────────────────────── */}
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

          {/* ── Start Date ─────────────────────────────────────── */}
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

          {/* ── Daily Chapters ──────────────────────────────────── */}
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

          {/* ── Plan Preview ────────────────────────────────────── */}
          <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
            <div className="text-xs font-bold text-[var(--color-muted)] uppercase tracking-wider">
              計劃預覽
            </div>

            {/* Highlighted days selector */}
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

            {/* Stats */}
            <div className="pt-3 border-t border-[var(--color-muted)]/10 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-muted)]">每日章數</span>
                <span className="font-bold text-[var(--color-primary)]">{chaptersPerDay} 章</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-muted)]">總天數</span>
                <span className="font-bold text-[var(--color-primary)]">{requiredDays} 天</span>
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

          {/* Error */}
          {error && (
            <div className="p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 rounded-lg text-sm text-[var(--color-danger)] text-center">
              {error}
            </div>
          )}

          {/* Start Button */}
          <button
            onClick={handleSubmit}
            disabled={loading}
            className="w-full py-3.5 px-4 bg-[var(--color-success)] text-white rounded-xl font-extrabold text-base shadow-[var(--shadow-button)] hover:bg-[#46A302] active:translate-y-0.5 active:shadow-none transition-all disabled:opacity-60"
          >
            {loading ? '建立中...' : '開始讀經！'}
          </button>

        </div>
      </div>
    </main>
  )
}
