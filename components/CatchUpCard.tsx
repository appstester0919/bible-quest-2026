'use client'

import { useMemo, useState } from 'react'
import { reanchorPlan } from '@/lib/catchupActions'
import { readingDate, addDays, daysBetween } from '@/lib/readingDate'
import {
  generateReadingPlan,
  type EnrollmentLite,
} from '@/lib/bible/planGenerator'
import type { BookMeta } from '@/lib/bible/lookup'
import {
  analyseCatchUp,
  anchorPositionFor,
  describeRefSpan,
  shortRef,
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

/**
 * Confirmation shown before any plan is rewritten.
 *
 * Extracted from the re-anchor branch so the catch-up branch gets it too —
 * it used to live inline, which meant the new seven-day-priority branch could
 * set `pending` and then render a card with no way to confirm anything.
 *
 * Every row answers a question the reader is actually asking: where do I
 * start, what will today be, what am I catching up on, and what stays the
 * same. The previous "詩 51 – 路加 15" span answered none of them.
 */
function ConfirmDialog({
  pending,
  busy,
  error,
  anchorRefs,
  todayRefs,
  chaptersPerDay,
  onCancel,
  onConfirm,
}: {
  pending: { date: string; label: string; bookIndex: number; chapter: number }
  busy: boolean
  error: string | null
  anchorRefs: string[]
  todayRefs: string[]
  chaptersPerDay: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-end justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={() => !busy && onCancel()}
    >
      <div
        className="card w-full max-w-md pb-2"
        style={{ background: 'var(--color-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="h-eyebrow">📅 確認新安排</p>
        <p className="font-extrabold text-lg mt-1">{pending.label}</p>

        <dl className="mt-3 text-sm space-y-2">
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--color-ink-soft)' }}>由呢日開始</dt>
            <dd className="font-bold text-right">
              {D(pending.date)} · {shortRef(anchorRefs[0] ?? '')}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--color-ink-soft)' }}>要補讀</dt>
            <dd className="font-bold text-right">
              {describeRefSpan(anchorRefs)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--color-ink-soft)' }}>今日讀經</dt>
            <dd className="font-bold text-right">
              {describeRefSpan(todayRefs)}
            </dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--color-ink-soft)' }}>之後每日</dt>
            <dd className="font-bold">{chaptersPerDay} 章</dd>
          </div>
        </dl>

        <p className="text-xs mt-3" style={{ color: 'var(--color-ink-soft)' }}>
          已經讀過嘅紀錄唔會改動；跳過咗嘅日子會留返喺日曆同連續紀錄上面。
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
            onClick={onCancel}
            className="btn btn-secondary flex-1"
            style={{ minHeight: 48 }}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="btn btn-primary flex-1"
            style={{ minHeight: 48 }}
          >
            {busy ? '執行中…' : '就係咁做'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function CatchUpCard({ enrollment, books, completedDates }: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<{
    date: string
    label: string
    /** Canon position the new plan must start from — see anchorPositionFor. */
    bookIndex: number
    chapter: number
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

  // The chapters this anchor is actually about — the run of days being
  // chased. Without this the dialog showed only an unexplained start/end
  // span (「詩 51 – 路加 15」) that was neither the missed range nor the
  // plan's remainder, so it answered no question the reader had.
  const anchorRefs: string[] = useMemo(() => {
    if (!pending || books.length === 0) return []
    const plan = generateReadingPlan(enrollment, books, 400)
    const out: string[] = []
    for (
      let d = pending.date;
      daysBetween(
        d,
        addDays(
          pending.date,
          analysis.kind === 'catch_up' ? analysis.behindDays - 1 : 0,
        ),
      ) >= 0;
      d = addDays(d, 1)
    ) {
      out.push(...(plan.get(d) ?? []))
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, books, enrollment, analysis])

  if (analysis.kind === 'on_track') return null

  // ── Preview the schedule a given anchor would produce ─────────────────────
  // The plan is a pure function of started_at, so the consequence of an
  // anchor is computable before anything is written. This is what the user
  // confirms against — never a vague promise of "we'll adjust it".
  // The preview has to move the start POSITION too, not just the date —
  // otherwise it shows the very schedule the old code would have produced,
  // which is how the confirm dialog came to promise chapters the plan would
  // never serve.
  const previewFor = (
    anchor: string,
    bookIndex: number,
    chapter: number,
  ): string[] => {
    const isNT = bookIndex >= 39
    const plan = generateReadingPlan(
      {
        ...enrollment,
        started_at: anchor,
        start_book_index: bookIndex,
        start_chapter: chapter,
        ...(isNT
          ? { nt_start_book_index: bookIndex, nt_start_chapter: chapter }
          : { ot_start_book_index: bookIndex, ot_start_chapter: chapter }),
      },
      books,
      400,
    )
    return plan.get(readingDate()) ?? []
  }

  const applyAnchor = async (target: {
    date: string
    bookIndex: number
    chapter: number
  }) => {
    const anchor = target.date
    setBusy(true)
    setError(null)
    try {
      const res = await reanchorPlan(
        enrollment.id,
        anchor,
        target.bookIndex,
        target.chapter,
      )
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

  // ── Priority case: only the recent week is still worth chasing ───────────
  // Checked first, before 'small' and 'reanchor', because a reader 23 days
  // behind does not want to be told about the 23 days — they want the last
  // week, which is the only part that is still cheap. Offering both windows
  // side by side is what made the earlier version confusing.
  if (analysis.kind === 'catch_up') {
    const gap = analysis.firstGap
    const pos = anchorPositionFor(enrollment, books, gap.firstDate)
    if (!pos) return null // position unresolvable — better silent than wrong
    const href = buildCatchUpHref(analysis.missedRefs)
    return (
      <>
        <div className="card" style={{ borderColor: 'var(--color-success)' }}>
          <p className="h-eyebrow">📖 追趕進度</p>
          <p className="font-extrabold text-lg mt-1">
            最近 {analysis.behindDays} 日未讀，共 {analysis.missedRefs.length}{' '}
            章
          </p>
          <p
            className="text-sm mt-1"
            style={{ color: 'var(--color-ink-soft)' }}
          >
            {D(gap.firstDate)} – {D(gap.lastDate)} · {describeRefSpan(gap.refs)}
          </p>

          <button
            type="button"
            disabled={busy}
            onClick={() =>
              setPending({
                date: gap.firstDate,
                label: `追趕最近 ${analysis.behindDays} 日`,
                bookIndex: pos.book_index,
                chapter: pos.chapter,
              })
            }
            className="btn btn-primary mt-3 gap-2"
            style={{
              minHeight: 56,
              width: '100%',
              flexDirection: 'column',
              alignItems: 'flex-start',
              paddingTop: 10,
              paddingBottom: 10,
              textTransform: 'none',
              letterSpacing: 0,
              lineHeight: 1.3,
            }}
          >
            <span className="flex items-center gap-2 w-full">
              <span style={{ fontSize: 17 }}>⏩</span>
              <span>追趕呢 {analysis.behindDays} 日</span>
            </span>
            <span
              className="w-full"
              style={{
                fontSize: 13,
                fontWeight: 700,
                opacity: 0.85,
                paddingLeft: 29,
                whiteSpace: 'normal',
              }}
            >
              {describeRefSpan(gap.refs)}
            </span>
            <span
              className="w-full"
              style={{
                fontSize: 12,
                fontWeight: 600,
                opacity: 0.7,
                paddingLeft: 29,
                whiteSpace: 'normal',
              }}
            >
              讀完之後，今日就由 {shortRef(gap.refs[0] ?? '')} 開始
            </span>
          </button>

          <p
            className="text-xs mt-2"
            style={{ color: 'var(--color-ink-soft)' }}
          >
            {analysis.totalBehindDays > analysis.behindDays
              ? `更早嘅 ${analysis.totalBehindDays - analysis.behindDays} 日已經唔追。想重新編排請到「設定」。`
              : '讀完之後，今日功課會自動接返原定進度。'}
          </p>
          <a
            href={href}
            className="text-xs mt-1 block"
            style={{ color: 'var(--color-ink-soft)' }}
          >
            或者逐章慢慢補讀 →
          </a>
        </div>
        {pending && (
          <ConfirmDialog
            pending={pending}
            busy={busy}
            error={error}
            anchorRefs={anchorRefs}
            todayRefs={previewFor(
              pending.date,
              pending.bookIndex,
              pending.chapter,
            )}
            chaptersPerDay={enrollment.chapters_per_day}
            onCancel={() => setPending(null)}
            onConfirm={() =>
              applyAnchor({
                date: pending.date,
                bookIndex: pending.bookIndex,
                chapter: pending.chapter,
              })
            }
          />
        )}
      </>
    )
  }

  // ── Case 1: ≤ 7 days behind — read them, don't rewrite the plan ───────────
  if (analysis.kind === 'small') {
    const href = buildCatchUpHref(analysis.missedRefs)
    return (
      <div className="card" style={{ borderColor: 'var(--color-success)' }}>
        <p className="h-eyebrow">📖 補讀進度</p>
        <p className="font-extrabold text-lg mt-1">
          有 {analysis.behindDays} 日嘅功課未讀，共 {analysis.missedRefs.length}{' '}
          章
        </p>
        <p className="text-sm mt-1" style={{ color: 'var(--color-ink-soft)' }}>
          {D(analysis.firstGap.firstDate)} – {D(analysis.firstGap.lastDate)} ·{' '}
          {describeRefSpan(analysis.missedRefs)}
        </p>
        <a
          href={href}
          className="btn btn-primary w-full mt-3"
          style={{ minHeight: 48, width: '100%' }}
        >
          補讀晒 {analysis.missedRefs.length} 章 →
        </a>
        <p className="text-xs mt-2" style={{ color: 'var(--color-ink-soft)' }}>
          補讀之後，今日功課會自動接返原定進度，計劃唔會改動。
        </p>
      </div>
    )
  }

  // ── Cases 2 & 3: > 7 days behind — re-anchor the plan ────────────────────
  // Two buttons, deliberately different weights. They are NOT "more" and "less"
  // of the same action — they are two different decisions with different
  // consequences, so the copy has to say which is which rather than relying on
  // the reader to work it out from the dates.
  const gapButton = (
    gap: GapBlock,
    title: string,
    hint: string,
    variant: 'primary' | 'secondary',
  ) => (
    <button
      key={gap.firstDate}
      type="button"
      disabled={busy}
      onClick={() => {
        const pos = anchorPositionFor(enrollment, books, gap.firstDate)
        if (!pos) return
        setPending({
          date: gap.firstDate,
          label: title,
          bookIndex: pos.book_index,
          chapter: pos.chapter,
        })
      }}
      className={`btn ${variant === 'primary' ? 'btn-primary' : 'btn-secondary'} gap-2`}
      style={{
        minHeight: 56,
        width: '100%',
        flexDirection: 'column',
        alignItems: 'flex-start',
        paddingTop: 10,
        paddingBottom: 10,
        textTransform: 'none',
        letterSpacing: 0,
        lineHeight: 1.3,
      }}
    >
      <span className="flex items-center gap-2 w-full">
        <span style={{ fontSize: 17 }}>
          {variant === 'primary' ? '⏪' : '⏩'}
        </span>
        <span>{title}</span>
      </span>
      <span
        className="w-full"
        style={{
          fontSize: 13,
          fontWeight: 700,
          opacity: 0.85,
          paddingLeft: 29,
          whiteSpace: 'normal',
        }}
      >
        {D(gap.firstDate)} · {describeRefSpan(gap.refs)}
      </span>
      <span
        className="w-full"
        style={{
          fontSize: 12,
          fontWeight: 600,
          opacity: 0.7,
          paddingLeft: 29,
          whiteSpace: 'normal',
        }}
      >
        {hint}
      </span>
    </button>
  )

  return (
    <>
      <div className="card" style={{ borderColor: 'var(--color-success)' }}>
        <p className="h-eyebrow">📅 調整進度</p>
        <p className="font-extrabold text-lg mt-1">
          你有 {analysis.behindDays} 日未讀，想喺邊度接返落去？
        </p>
        <p className="text-sm mt-1" style={{ color: 'var(--color-ink-soft)' }}>
          揀一個斷位重新開始，今日就會讀嗰個位置嘅章，往後照原本每日章數繼續。
          {!analysis.multipleGaps && ' 呢個計劃只有一個斷位。'}
        </p>

        <div className="flex flex-col gap-2 mt-3">
          {analysis.multipleGaps
            ? gapButton(
                analysis.firstGap,
                '由最早嘅斷位接返',
                '補返晒中間漏咗嘅進度',
                'primary',
              )
            : gapButton(
                analysis.firstGap,
                '由斷位接返',
                '繼續原本嘅進度',
                'primary',
              )}
          {analysis.multipleGaps &&
            gapButton(
              analysis.lastGap,
              '由最近嘅斷位接返',
              '跳過中間，只讀之後嘅內容',
              'secondary',
            )}
        </div>

        <p className="text-xs mt-2" style={{ color: 'var(--color-ink-soft)' }}>
          執行前會列出新的計劃安排，確認後才會改動。若想自行重新編排，請到「設定」。
        </p>
      </div>
      {pending && (
        <ConfirmDialog
          pending={pending}
          busy={busy}
          error={error}
          anchorRefs={anchorRefs}
          todayRefs={previewFor(
            pending.date,
            pending.bookIndex,
            pending.chapter,
          )}
          chaptersPerDay={enrollment.chapters_per_day}
          onCancel={() => setPending(null)}
          onConfirm={() =>
            applyAnchor({
              date: pending.date,
              bookIndex: pending.bookIndex,
              chapter: pending.chapter,
            })
          }
        />
      )}
    </>
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
