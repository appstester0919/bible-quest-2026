'use client'

import { useMemo, useState } from 'react'
import { reanchorPlan } from '@/lib/catchupActions'
import { readingDate } from '@/lib/readingDate'
import {
  generateReadingPlan,
  type EnrollmentLite,
} from '@/lib/bible/planGenerator'
import type { BookMeta } from '@/lib/bible/lookup'
import {
  analyseCatchUp,
  describeRefSpan,
  type CatchUpCase,
  type GapBlock,
} from '@/lib/readingProgress'

// ============================================================================
// Catch-up card.
//
// Shows ONLY when the reader is genuinely behind, and offers only the cases
// the analysis can answer unambiguously:
//
//   ≤ 7 days behind  → read the missed chapters (a deep link, nothing written)
//   > 7 days, one gap → restart the plan at that gap
//   > 7 days, several → restart at the first OR the last gap; the reader
//                       knows their own history better than we can guess
//
// Anything more tangled than that belongs in settings, which already offers
// full manual control. This card's whole job is to make the common case one
// tap and to never guess on the user's behalf.
// ============================================================================

interface Props {
  /** The dashboard's enrollment, widened to the plan generator's own shape so
      the preview and the real dashboard plan can never drift apart. */
  enrollment: EnrollmentLite & { id: string; chapters_per_day: number }
  books: BookMeta[]
  completedDates: string[]
}

const D = (s: string) =>
  new Date(`${s}T00:00:00+08:00`).toLocaleDateString('zh-HK', {
    month: 'numeric',
    day: 'numeric',
  })

export function CatchUpCard({ enrollment, books, completedDates }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{
    date: string
    label: string
  } | null>(null)

  const today = readingDate()

  // Regenerating the whole plan on every render would be wasteful; it only
  // depends on the enrollment, the book list and the completion set.
  const analysis = useMemo<CatchUpCase>(() => {
    if (books.length === 0) return { kind: 'on_track' }
    const plan = generateReadingPlan(enrollment, books, 400)
    return analyseCatchUp(
      enrollment.started_at,
      today,
      completedDates,
      (d) => plan.get(d) ?? [],
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollment, books, completedDates, today])

  if (analysis.kind === 'on_track') return null

  // ── Preview the schedule a given anchor would produce ─────────────────────
  // The plan is a pure function of started_at, so the consequence of an
  // anchor is computable before anything is written. This is what the user
  // confirms against — never a vague promise of "we'll adjust it".
  const previewFor = (anchor: string): string[] => {
    const plan = generateReadingPlan(
      { ...enrollment, started_at: anchor },
      books,
      400,
    )
    return plan.get(readingDate()) ?? []
  }

  const applyAnchor = async (anchor: string) => {
    setBusy(true)
    setError(null)
    try {
      const res = await reanchorPlan(enrollment.id, anchor)
      if (!res.ok) setError(res.error)
      else setPending(null)
      // Reload so the dashboard recomputes the plan and progress bar.
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失敗')
    } finally {
      setBusy(false)
    }
  }

  // ── Case 1: ≤ 7 days behind — read them, don't rewrite the plan ───────────
  if (analysis.kind === 'small') {
    const href = buildCatchUpHref(analysis.firstGap.refs)
    return (
      <div className="card" style={{ borderColor: 'var(--color-primary)' }}>
        <p className="h-eyebrow">落後進度</p>
        <p className="font-extrabold mt-1">
          你落後 {analysis.behindDays} 日，共 {analysis.missedRefs.length}{' '}
          章未讀
        </p>
        <p className="text-sm opacity-80 mt-1">
          {D(analysis.firstGap.firstDate)} – {D(analysis.firstGap.lastDate)} ·{' '}
          {describeRefSpan(analysis.firstGap.refs)}
        </p>
        <a
          href={href}
          className="btn btn-primary w-full mt-3 inline-block text-center"
          style={{ minHeight: 44 }}
        >
          一次過追進度（{analysis.missedRefs.length}章）
        </a>
        <p className="text-xs opacity-60 mt-2">
          讀完後今日功課會自動接回原定進度，計劃不會改動。
        </p>
      </div>
    )
  }

  // ── Cases 2 & 3: > 7 days behind — re-anchor the plan ────────────────────
  const gapButton = (
    gap: GapBlock,
    label: string,
    variant: 'primary' | 'secondary',
  ) => (
    <button
      key={gap.firstDate}
      type="button"
      disabled={busy}
      onClick={() => setPending({ date: gap.firstDate, label })}
      className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-ghost'} w-full`}
      style={{ minHeight: 44 }}
    >
      {label}
      <span className="text-xs opacity-70 ml-2">
        {D(gap.firstDate)} · {describeRefSpan(gap.refs)}
      </span>
    </button>
  )

  return (
    <div className="card" style={{ borderColor: 'var(--color-primary)' }}>
      <p className="h-eyebrow">落後進度</p>
      <p className="font-extrabold mt-1">你落後 {analysis.behindDays} 日</p>
      <p className="text-sm opacity-80 mt-1">
        重新調整進度後，今日會由你選的斷位開始，按原本每日章數繼續。
        {!analysis.multipleGaps && ' 這個計劃只有一個斷位。'}
      </p>

      <div className="flex flex-col gap-2 mt-3">
        {analysis.multipleGaps
          ? gapButton(analysis.firstGap, '由第一個斷位重新開始', 'primary')
          : gapButton(analysis.firstGap, '由斷位重新開始', 'primary')}
        {analysis.multipleGaps &&
          gapButton(analysis.lastGap, '由最後斷位重新開始', 'secondary')}
      </div>

      <p className="text-xs opacity-60 mt-2">
        執行前會列出新的計劃安排，確認後才會改動。若想自行重新編排，請到「設定」。
      </p>

      {/* ── Confirm: show the ACTUAL resulting schedule before writing ────── */}
      {pending && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-end justify-center p-4"
          style={{ background: 'rgba(0,0,0,0.5)' }}
          onClick={() => !busy && setPending(null)}
        >
          <div
            className="card w-full max-w-md pb-2"
            style={{ background: 'var(--color-surface)' }}
            onClick={(e) => e.stopPropagation()}
          >
            <p className="h-eyebrow">確認新計劃</p>
            <p className="font-extrabold text-lg mt-1">{pending.label}</p>

            <dl className="mt-3 text-sm space-y-2">
              <div className="flex justify-between gap-3">
                <dt className="opacity-70">新起點</dt>
                <dd className="font-bold">{D(pending.date)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="opacity-70">今日讀經</dt>
                <dd className="font-bold text-right">
                  {describeRefSpan(previewFor(pending.date))}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="opacity-70">每日章數</dt>
                <dd className="font-bold">{enrollment.chapters_per_day} 章</dd>
              </div>
            </dl>

            <p className="text-xs opacity-70 mt-3">
              已經讀過的紀錄不會改動，未讀的斷位日子會留在日曆上。
            </p>

            {error && (
              <p
                className="text-sm mt-2"
                style={{ color: 'var(--color-danger, #DC2626)' }}
              >
                {error}
              </p>
            )}

            <div className="flex gap-2 mt-4">
              <button
                type="button"
                disabled={busy}
                onClick={() => setPending(null)}
                className="btn btn-ghost flex-1"
                style={{ minHeight: 44 }}
              >
                取消
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => applyAnchor(pending.date)}
                className="btn btn-primary flex-1"
                style={{ minHeight: 44 }}
              >
                {busy ? '執行中…' : '確認執行'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Deep link into the read page for a set of chapters, so the small-behind
 * case stays a pure "go read" with nothing written to the database.
 *
 * Uses the read page's EXISTING `?today=1&refs=` contract, which already
 * expands a comma-separated ref list into a bounded range-mode queue. That
 * deliberately reuses the machinery the today-lesson card relies on, so the
 * catch-up list is bounded (no infinite scroll) and cannot strand the
 * 完成讀經 button below an ever-growing list — the two bugs fixed in 41ec4ad.
 *
 * `today=1` is required by the read page; it also means the read page will
 * look for an existing session on the current reading date, which is exactly
 * what we want — the chapters read now ARE today's catch-up.
 */
function buildCatchUpHref(refs: string[]): string {
  if (refs.length === 0) return '/read'
  const list = refs.map((r) => encodeURIComponent(r)).join(',')
  return `/read?today=1&refs=${list}`
}
