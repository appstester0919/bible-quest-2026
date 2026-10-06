'use client'

import { summariseRuns } from '@/lib/refRange'
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
  reanchoredEnrollment,
  describeRefSpan,
  groupRefsByBook,
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
  behindDays,
  onCancel,
  onConfirm,
}: {
  pending: { date: string; label: string; bookIndex: number; chapter: number }
  busy: boolean
  error: string | null
  anchorRefs: string[]
  todayRefs: string[]
  chaptersPerDay: number
  behindDays: number
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      // items-center, not items-end: pinning the sheet to the bottom put its
      // upper half below the fold on a 393×852 phone, so the summary rows
      // were unreachable without scrolling. Centered, and scrollable if the
      // content is ever taller than the viewport.
      className="fixed inset-0 z-50 flex items-center justify-center p-4 overflow-y-auto"
      style={{ background: 'rgba(0,0,0,0.5)' }}
      onClick={() => !busy && onCancel()}
    >
      <div
        className="card w-full max-w-md my-auto"
        style={{ background: 'var(--color-surface)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="h-eyebrow">📅 確認新安排</p>
        <p className="font-extrabold text-lg mt-1">{pending.label}</p>

        <dl className="mt-3 text-sm space-y-2">
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--color-ink-soft)' }}>由斷位接回</dt>
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
          <div className="flex justify-between gap-3">
            <dt style={{ color: 'var(--color-ink-soft)' }}>落後日數</dt>
            <dd className="font-bold text-right">{behindDays} 日 → 0 日</dd>
          </div>
        </dl>

        <p className="text-xs mt-3" style={{ color: 'var(--color-ink-soft)' }}>
          今日就由呢個位置重新開始，之前未讀嘅 {behindDays}{' '}
          日唔使補，已經讀過嘅紀錄亦唔會改動。
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
  // The plan is a pure function of the enrollment, so it is built once and
  // shared: the analysis walks it, and the catch-up card reads today's own
  // chapters straight off it.
  const plan = useMemo(
    () =>
      books.length === 0
        ? new Map<string, string[]>()
        : generateReadingPlan(enrollment, books, 400),
    [enrollment, books],
  )
  const planFor = (d: string): string[] => plan.get(d) ?? []

  const analysis = useMemo<CatchUpCase>(
    () =>
      books.length === 0
        ? { kind: 'on_track' }
        : analyseCatchUp(enrollment.started_at, today, completedDates, planFor),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [enrollment, books, completedDates, today],
  )

  // The chapters this anchor is actually about — the run of days being
  // chased. Without this the dialog showed only an unexplained start/end
  // span (「詩 51 – 路加 15」) that was neither the missed range nor the
  // plan's remainder, so it answered no question the reader had.
  const anchorRefs: string[] = useMemo(() => {
    if (!pending || books.length === 0) return []
    const plan = generateReadingPlan(enrollment, books, 400)
    const out: string[] = []
    // The anchor is ONE day — the chapters that day was supposed to read, which
    // is where reading resumes. Multiplying it by behindDays (the old code, for
    // the catch-up case) made the button advertise the whole 272-day backlog
    // 「馬太 1 – 以西結 30」 as the restart point, when the restart is one
    // day's worth: 馬太 1 – 創世 3.
    out.push(...(plan.get(pending.date) ?? []))
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
  //
  // The rewrite goes through reanchoredEnrollment, the SAME helper the server
  // action uses, so the preview cannot drift from what will actually be
  // written. Setting only the start columns here left the reading ORDER
  // untouched, and under 'ot_then_nt' the OT is what the generator starts
  // from — the dialog showed 詩篇 111 for a plan anchored on 約翰 12.
  const previewFor = (
    anchor: string,
    bookIndex: number,
    chapter: number,
  ): string[] => {
    const rebuilt = reanchoredEnrollment(enrollment, {
      book_index: bookIndex,
      chapter,
    })
    // started_at is TODAY, matching reanchorPlan. The preview previously used
    // the anchor day, so it showed 「今日：創 1 – …」 for a schedule whose day
    // 273 would be today's — the dialog described a different plan from the one
    // the write produced, which is the only thing a confirmation must never do.
    const plan = generateReadingPlan(
      { ...rebuilt, started_at: today },
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

  // ── Priority case: the recent week, as a plain "go read this" link ───────
  // Checked first, before 'small' and 'reanchor'.
  //
  // THIS DOES NOT REWRITE THE PLAN. That was the original misreading: the
  // card looks like a re-anchor button, but what the reader actually wants
  // when a few days slipped is to just READ them. Rewriting the plan moves
  // today's lesson to the anchor chapter, which is not what "I missed three
  // days" means — it quietly reschedules the whole remaining plan as a side
  // effect of catching up.
  //
  // So this is one tap, zero writes, and it shows the missed chapters TOGETHER
  // WITH today's — the reader sees the whole backlog in one queue rather than
  // today's slice only. Only the >7-day case actually rewrites anything, and
  // that one keeps its confirmation dialog.
  if (analysis.kind === 'catch_up') {
    const gap = analysis.firstGap
    // Today's own chapters, so the queue is "missed days + today" rather than
    // "missed days only" — catching up should land you on today, not beside it.
    // Only queue today when it is still unread. After finishing today's
    // lesson the button must cover the backlog alone — appending a day the
    // reader already completed is precisely what the card promises not to do,
    // and it silently doubles the reading.
    // Grouped AFTER appending today: missedRefs is already book-grouped, but
    // today's own NT-then-OT run appended behind it would put 馬太 2 after
    // 創世 4-6 and split 馬太's two chapters around an OT block again.
    const allRefs = groupRefsByBook(
      analysis.todayCompleted
        ? [...analysis.missedRefs]
        : [...analysis.missedRefs, ...analysis.today],
    )
    const href = buildCatchUpHref(allRefs)
    const old = analysis.totalBehindDays - analysis.behindDays

    return (
      // Same design language as the Today's Lesson card above it: a card that
      // is itself the tap target, white text on the green gradient, the same
      // hover/active scale. It is the same KIND of action — "go read this" —
      // so it must not look like a different kind of thing.
      <a
        href={href}
        className="card block hover:scale-[1.01] active:scale-[0.99] transition-transform"
        style={{
          background: 'linear-gradient(135deg, #58CC02 0%, #46A302 100%)',
          color: '#FFFFFF',
        }}
      >
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wider opacity-90">
              追趕進度
            </p>
            <p className="text-xl font-extrabold mt-1">
              {analysis.todayCompleted
                ? `追趕呢 ${analysis.behindDays} 日`
                : `一齊追趕呢 ${analysis.behindDays} 日 + 今日`}
            </p>
            <p className="text-xs opacity-90 mt-1">
              {allRefs.length}章 · {summariseRuns(allRefs)}
            </p>
            <p className="text-xs opacity-80 mt-1">
              {/* 「29/9 至今」 was literally wrong: the gap ends at the last
                  UNREAD day, not today. With 10/2 and 10/3 already read, that
                  wording implied those days were part of the backlog. Name the
                  unread days instead — it is the only span the button covers. */}
              未讀：{D(gap.firstDate)} – {D(gap.lastDate)} · 計劃唔會改動
            </p>
          </div>
          <div className="text-5xl">▶</div>
        </div>
      </a>
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
        {D(gap.firstDate)} · {describeRefSpan(planFor(gap.firstDate))}
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
          behindDays={analysis.behindDays}
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
