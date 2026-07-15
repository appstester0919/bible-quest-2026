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
  getRemainingChapters,
} from '@/lib/bible/scope'
import { createClient } from '@/lib/supabase/client'

// ─── Bible book metadata (issue #6: start position picker) ────────────────
import { BIBLE_BOOKS, NT_BOOKS, OT_BOOKS, type BibleBook } from '@/lib/bible/books'

/**
 * Picker UI: a single row of 2 buttons (book + chapter).
 * Click book button → expand book table; click chapter button → expand chapter table.
 * Each table collapses after selection.
 */
function BookModal({
  books,
  selectedBookIdx,
  onSelect,
  onClose,
}: {
  books: BibleBook[]
  selectedBookIdx: number
  onSelect: (bookIdx: number) => void
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      {/* Sheet */}
      <div className="relative z-10 w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl max-h-[85vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-muted)]/10">
          <span className="font-bold text-[var(--color-primary)]">選擇書卷</span>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--color-background)] text-[var(--color-muted)] font-bold"
          >
            ✕
          </button>
        </div>
        {/* Book list */}
        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-5 gap-1.5">
            {books.map((b) => (
              <button
                key={b.index}
                type="button"
                onClick={() => { onSelect(b.index); onClose() }}
                className={`py-2 px-1 rounded-xl text-sm font-bold text-center transition-all ${
                  b.index === selectedBookIdx
                    ? 'bg-[var(--color-success)] text-white shadow-[var(--shadow-button)]'
                    : 'bg-[var(--color-background)] text-[var(--color-primary)] hover:bg-[var(--color-success)]/10'
                }`}
              >
                <div className="text-base leading-tight">{b.abbr}</div>
                <div className="text-[10px] font-normal opacity-70 leading-tight mt-0.5">{b.chapters}章</div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function ChapterModal({
  book,
  selectedChapter,
  onSelect,
  onClose,
}: {
  book: BibleBook
  selectedChapter: number
  onSelect: (ch: number) => void
  onClose: () => void
}) {
  const cols = book.chapters <= 20 ? 6 : book.chapters <= 40 ? 7 : 8
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md bg-white rounded-t-3xl sm:rounded-2xl max-h-[60vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-muted)]/10">
          <span className="font-bold text-[var(--color-primary)]">
            {book.abbr} · 第 {selectedChapter} 章
          </span>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-[var(--color-background)] text-[var(--color-muted)] font-bold"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <div
            className="grid gap-1.5"
            style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
          >
            {Array.from({ length: book.chapters }, (_, i) => i + 1).map((ch) => (
              <button
                key={ch}
                type="button"
                onClick={() => { onSelect(ch); onClose() }}
                className={`py-2 rounded-xl text-sm font-bold text-center transition-all ${
                  ch === selectedChapter
                    ? 'bg-[var(--color-success)] text-white shadow-[var(--shadow-button)]'
                    : 'bg-[var(--color-background)] text-[var(--color-primary)] hover:bg-[var(--color-success)]/10'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StartPositionRow({
  label,
  selectedBookIdx,
  selectedChapter,
  onSelectBook,
  onSelectChapter,
  books,
}: {
  label: string
  selectedBookIdx: number
  selectedChapter: number
  onSelectBook: (bookIdx: number) => void
  onSelectChapter: (ch: number) => void
  books: BibleBook[]
}) {
  const [bookOpen, setBookOpen] = useState(false)
  const [chapterOpen, setChapterOpen] = useState(false)
  const selectedBook = books.find((b) => b.index === selectedBookIdx)!

  return (
    <div>
      <div className="text-xs font-bold text-[var(--color-muted)] mb-1.5">
        {label}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <button
          type="button"
          onClick={() => { setBookOpen(true); setChapterOpen(false) }}
          className="py-2 px-3 rounded-xl font-bold text-sm border-2 border-[var(--color-muted)]/20 bg-white text-[var(--color-primary)] text-left flex items-center gap-2"
        >
          <span className="text-base">📖</span>
          <span className="font-bold">{selectedBook.abbr}</span>
          <span className="text-xs text-[var(--color-muted)] font-normal ml-auto">{selectedBook.chapters}章</span>
        </button>
        <button
          type="button"
          onClick={() => { setChapterOpen(true); setBookOpen(false) }}
          className="py-2 px-3 rounded-xl font-bold text-sm border-2 border-[var(--color-muted)]/20 bg-white text-[var(--color-primary)] min-w-[5rem]"
        >
          {selectedChapter}章
        </button>
      </div>

      {bookOpen && (
        <BookModal
          books={books}
          selectedBookIdx={selectedBookIdx}
          onSelect={(idx) => {
            onSelectBook(idx)
            // Reset chapter to 1 when book changes
            const newBook = books.find((b) => b.index === idx)!
            if (selectedChapter > newBook.chapters) onSelectChapter(1)
          }}
          onClose={() => setBookOpen(false)}
        />
      )}
      {chapterOpen && (
        <ChapterModal
          book={selectedBook}
          selectedChapter={selectedChapter}
          onSelect={onSelectChapter}
          onClose={() => setChapterOpen(false)}
        />
      )}
    </div>
  )
}

const SCOPES: { id: Scope; label: string; desc: string }[] = [
  { id: 'nt',     label: '新約',         desc: '259 章聖經' },
  { id: 'ot',     label: '舊約',         desc: '929 章聖經' },
  { id: 'nt_ot',  label: '新約 + 舊約',  desc: '1188 章聖經' },
]

function getMinDate(): string {
  const y = new Date().getFullYear()
  return `${y}-01-01`
}
function getTomorrow(): string {
  const d = new Date()
  d.setDate(d.getDate() + 1)
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
}
function getToday(): string {
  // Use HK timezone — at midnight HKT, UTC is already previous day,
  // so toLocaleDateString('en-CA') gives the correct local calendar date.
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

  // Start position state (issue #6)
  // Defaults: NT 馬太福音 1 章 (idx 39), OT 創世記 1 章 (idx 0)
  const [ntStartBook, setNtStartBook]     = useState(39)
  const [ntStartChapter, setNtStartChapter] = useState(1)
  const [otStartBook, setOtStartBook]     = useState(0)
  const [otStartChapter, setOtStartChapter] = useState(1)

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
  // Issue #6 fix: total_days for nt_ot = ceil((nt_remaining + ot_remaining) / chapters_per_day)
  // This correctly scales when user picks custom start positions for either testament.
  let planDays: number
  if (scope === 'nt_ot' && ntOtOrder !== 'parallel') {
    // Sequential: primary testament starts at user position; secondary always
    // starts at its testament head. Compute sequentially.
    const primaryRemaining = scope === 'nt_ot' && ntOtOrder === 'nt_then_ot'
      ? getRemainingChapters('nt', BIBLE_BOOKS, ntStartBook, ntStartChapter)
      : getRemainingChapters('ot', BIBLE_BOOKS, otStartBook, otStartChapter)
    const secondaryTotal = ntOtOrder === 'nt_then_ot' ? 929 : 259
    const secondaryDays = Math.ceil(secondaryTotal / chaptersPerDay)
    planDays = Math.ceil(primaryRemaining / chaptersPerDay) + secondaryDays
  } else if (parallelInfo) {
    // Parallel: user formula — total pool = nt_remaining + ot_remaining
    const ntRemaining = getRemainingChapters('nt', BIBLE_BOOKS, ntStartBook, ntStartChapter)
    const otRemaining = getRemainingChapters('ot', BIBLE_BOOKS, otStartBook, otStartChapter)
    planDays = Math.ceil((ntRemaining + otRemaining) / chaptersPerDay)
  } else {
    // Single-testament (nt or ot): recalc from remaining chapter count
    const remaining = scope === 'nt'
      ? getRemainingChapters('nt', BIBLE_BOOKS, ntStartBook, ntStartChapter)
      : getRemainingChapters('ot', BIBLE_BOOKS, otStartBook, otStartChapter)
    planDays = Math.ceil(remaining / chaptersPerDay)
  }

  // For parallel: nt/ot per day comes from PARALLEL_TABLE
  // For sequential: chaptersPerDay goes entirely to whichever testament is active
  // For nt/ot (single-testament): chaptersPerDay IS the daily chapter count for that scope.
  // (Previously this branch did Math.ceil(259 / planDays), which produced a wrong value
  //  for OT because 929 ≠ 259 — see issue #5.)
  const ntChapters   = scope === 'nt_ot' && ntOtOrder === 'parallel' ? (parallelInfo?.nt ?? 0) : (scope === 'nt_ot' ? chaptersPerDay : chaptersPerDay)
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
        // Issue #6: start position
        ntStartBook,
        ntStartChapter,
        otStartBook,
        otStartChapter,
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
      // Trust the UI's computed total daily chapters. For nt_ot parallel this is
      // ntChapters + otChapters (e.g. 2+5=7); for sequential and single-testament
      // modes it equals the chaptersPerDay the user picked (e.g. OT 3 章 → 3).
      // Server must NOT recalculate via Math.ceil(259/totalDays) — that formula
      // only makes sense for NT and silently corrupts OT plans (issue #5).
      fd.append('chapters_per_day', String(ntChapters + otChapters))
      // Issue #6: start position
      fd.append('nt_start_book', String(ntStartBook))
      fd.append('nt_start_chapter', String(ntStartChapter))
      fd.append('ot_start_book', String(otStartBook))
      fd.append('ot_start_chapter', String(otStartChapter))
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
              max={getTomorrow()}
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

          {/* Start position picker (issue #6) */}
          {(scope === 'nt' || scope === 'nt_ot' || scope === 'ot') && (
            <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
              <div className="text-sm font-bold text-[var(--color-primary)]">
                📍 開始位置
              </div>
              {(scope === 'nt' || scope === 'nt_ot') && (
                <StartPositionRow
                  label="新約"
                  selectedBookIdx={ntStartBook}
                  selectedChapter={ntStartChapter}
                  onSelectBook={(i) => {
                    setNtStartBook(i)
                    const newBook = NT_BOOKS.find((b) => b.index === i)
                    if (newBook && ntStartChapter > newBook.chapters) {
                      setNtStartChapter(1)
                    }
                  }}
                  onSelectChapter={setNtStartChapter}
                  books={NT_BOOKS}
                />
              )}
              {(scope === 'ot' || scope === 'nt_ot') && (
                <StartPositionRow
                  label="舊約"
                  selectedBookIdx={otStartBook}
                  selectedChapter={otStartChapter}
                  onSelectBook={(i) => {
                    setOtStartBook(i)
                    const newBook = OT_BOOKS.find((b) => b.index === i)
                    if (newBook && otStartChapter > newBook.chapters) {
                      setOtStartChapter(1)
                    }
                  }}
                  onSelectChapter={setOtStartChapter}
                  books={OT_BOOKS}
                />
              )}
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

            {/* nt_ot: parallel + sequential breakdown */}
            {scope === 'nt_ot' ? (
              <>
                <div className="grid grid-cols-2 gap-2">
                  {/* NT summary */}
                  <div className="bg-[var(--color-background)] rounded-xl p-3 space-y-1">
                    <div className="text-xs text-[var(--color-muted)]">新約</div>
                    <div className="font-bold text-[var(--color-primary)]">
                      {NT_BOOKS.find((b) => b.index === ntStartBook)?.abbr ?? '太'}
                      {' '}
                      第{ntStartChapter}章起
                    </div>
                    <div className="text-xs text-[var(--color-muted)]">
                      剩 {getRemainingChapters('nt', BIBLE_BOOKS, ntStartBook, ntStartChapter)} 章
                    </div>
                    <div className="text-sm font-bold text-[var(--color-primary)]">
                      {ntChapters} 章/天 · {ntOtOrder === 'parallel' ? '並行' : ntOtOrder === 'nt_then_ot' ? '先新後舊' : '先舊後新'}
                    </div>
                  </div>
                  {/* OT summary */}
                  <div className="bg-[var(--color-background)] rounded-xl p-3 space-y-1">
                    <div className="text-xs text-[var(--color-muted)]">舊約</div>
                    <div className="font-bold text-[var(--color-primary)]">
                      {OT_BOOKS.find((b) => b.index === otStartBook)?.abbr ?? '創'}
                      {' '}
                      第{otStartChapter}章起
                    </div>
                    <div className="text-xs text-[var(--color-muted)]">
                      剩 {getRemainingChapters('ot', BIBLE_BOOKS, otStartBook, otStartChapter)} 章
                    </div>
                    <div className="text-sm font-bold text-[var(--color-primary)]">
                      {otChapters} 章/天
                    </div>
                  </div>
                </div>
              </>
            ) : (
              /* NT or OT single testament */
              <div className="bg-[var(--color-background)] rounded-xl p-3 space-y-1">
                <div className="text-xs text-[var(--color-muted)]">
                  {scope === 'nt' ? '新約' : '舊約'}
                </div>
                <div className="font-bold text-[var(--color-primary)]">
                  {(scope === 'nt' ? NT_BOOKS : OT_BOOKS).find(
                    (b) => b.index === (scope === 'nt' ? ntStartBook : otStartBook)
                  )?.abbr ?? '創'}
                  {' 第'}
                  {scope === 'nt' ? ntStartChapter : otStartChapter}
                  章起
                </div>
                <div className="text-xs text-[var(--color-muted)]">
                  剩{' '}
                  {scope === 'nt'
                    ? getRemainingChapters('nt', BIBLE_BOOKS, ntStartBook, ntStartChapter)
                    : getRemainingChapters('ot', BIBLE_BOOKS, otStartBook, otStartChapter)}
                  章 · {chaptersPerDay} 章/天
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-[var(--color-muted)]/10 space-y-1.5">
              <div className="flex justify-between text-sm">
                <span className="text-[var(--color-muted)]">每日章數</span>
                <span className="font-bold text-[var(--color-primary)]">{chaptersPerDay} 章</span>
              </div>
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
