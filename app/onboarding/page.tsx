'use client'

import { useState, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { completeOnboarding } from './actions'
import { getChaptersPerDay, getEstimatedCompletionDate } from '@/lib/bible/scope'

// ─── Constants ─────────────────────────────────────────────────────────────────

const READING_SCOPES = [
  { id: 'nt',   label: '新約',           description: '260 章聖經', chapters: 260, defaultDays: 60 },
  { id: 'ot',   label: '舊約',           description: '929 章聖經', chapters: 929, defaultDays: 180 },
  { id: 'nt_ot', label: '新約 + 舊約',  description: '1189 章聖經', chapters: 1189, defaultDays: 365 },
]

const READING_ORDERS = [
  { id: 'nt_ot',   label: '新約 → 舊約', sublabel: '先讀新約聖經，再讀舊約聖經' },
  { id: 'ot_nt',   label: '舊約 → 新約', sublabel: '先讀舊約聖經，再讀新約聖經' },
  { id: 'parallel', label: '新舊並行',    sublabel: '每日同時讀新約和舊約' },
]

// 4-tier dynamic slider steps per spec Task 2.3
const SLIDER_TIERS: [min: number, max: number, step: number][] = [
  [40,  60,  1],
  [60,  90,  5],
  [90,  180, 10],
  [180, 365, 30],
]

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Get min/max/step for each scope's slider */
function getSliderConfig(scope: string): { min: number; max: number; step: number; marks: number[] } {
  const ntOnly     = { min: 40,  max: 60,  step: 1,  marks: [40, 50, 60] }
  const otOnly     = { min: 90,  max: 365, step: 30, marks: [90, 180, 365] }
  const ntOt       = { min: 180, max: 365, step: 30, marks: [180, 240, 300, 365] }
  return scope === 'nt' ? ntOnly : scope === 'ot' ? otOnly : ntOt
}

/** Snap slider value to nearest valid step within its tier */
function snapToStep(value: number, min: number, max: number, step: number): number {
  const snapped = Math.round((value - min) / step) * step + min
  return Math.min(max, Math.max(min, snapped))
}

/** Format a date in HK timezone */
function formatDate(date: Date): string {
  return date.toLocaleDateString('zh-Hant', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** Compute live preview for nt_ot parallel reading */
function computeParallelPreview(totalDays: number): { ntPerDay: number; otPerDay: number } {
  const NT = 260, OT = 929
  // Parallel: divide days between NT and OT proportionally to chapter count
  const total = NT + OT
  const ntRatio = NT / total
  const otRatio = OT / total
  const ntDays = Math.round(totalDays * ntRatio)
  const otDays = Math.round(totalDays * otRatio)
  const ntPerDay = getChaptersPerDay('nt', ntDays)
  const otPerDay = getChaptersPerDay('ot', otDays)
  return { ntPerDay, otPerDay }
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const [step, setStep]         = useState(1)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [scope, setScope]       = useState<'nt' | 'ot' | 'nt_ot'>('nt')
  const [totalDays, setTotalDays] = useState(60)
  const [readingOrder, setReadingOrder] = useState('nt_ot')

  const selected = READING_SCOPES.find((s) => s.id === scope)!
  const slider   = getSliderConfig(scope)

  // Live preview — recomputes on every input change (spec: useMemo)
  const preview = useMemo(() => {
    const chaptersPerDay = getChaptersPerDay(scope as 'nt' | 'ot' | 'nt_ot', totalDays)
    const completionDate = getEstimatedCompletionDate(scope as 'nt' | 'ot' | 'nt_ot', totalDays)
    const parallel = scope === 'nt_ot' && readingOrder === 'parallel'
      ? computeParallelPreview(totalDays)
      : null
    return { chaptersPerDay, completionDate, parallel }
  }, [scope, totalDays, readingOrder])

  // When scope changes, reset to its default days
  function handleScopeChange(id: 'nt' | 'ot' | 'nt_ot') {
    const cfg = getSliderConfig(id)
    const defaultDays = id === 'nt' ? 60 : id === 'ot' ? 180 : 365
    const snapped = snapToStep(defaultDays, cfg.min, cfg.max, cfg.step)
    setScope(id)
    setTotalDays(snapped)
  }

  function handleSliderChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = Number(e.target.value)
    const snapped = snapToStep(raw, slider.min, slider.max, slider.step)
    setTotalDays(snapped)
  }

  async function handleSubmit() {
    setLoading(true)
    setError('')
    const fd = new FormData()
    fd.append('scope', scope)
    fd.append('total_days', String(totalDays))
    if (scope === 'nt_ot') fd.append('reading_order', readingOrder)
    const result = await completeOnboarding(fd)
    if (result.error) {
      setError(result.error)
      setLoading(false)
    } else {
      router.push('/dashboard')
    }
  }

  const pct = ((totalDays - slider.min) / (slider.max - slider.min)) * 100

  return (
    <main className="min-h-screen flex flex-col bg-[var(--color-background)]">
      {/* Progress indicator */}
      <div className="pt-8 px-4">
        <div className="flex gap-1 max-w-sm mx-auto">
          {[1, 2].map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full transition-colors ${
                s <= step ? 'bg-[var(--color-success)]' : 'bg-[var(--color-muted)]/20'
              }`}
            />
          ))}
        </div>
        <p className="text-center text-xs text-[var(--color-muted)] mt-2 font-bold uppercase tracking-wider">
          步驟 {step} / 2
        </p>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-4 mt-4 max-w-sm mx-auto w-full">
          <div className="p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 rounded-lg text-sm text-[var(--color-danger)] text-center">
            {error}
          </div>
        </div>
      )}

      {/* ── Step 1: Scope + Slider ─────────────────────────────────────── */}
      {step === 1 && (
        <div className="flex-1 flex flex-col justify-center px-4">
          <div className="max-w-sm mx-auto w-full">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">📖</div>
              <h1 className="text-2xl font-extrabold text-[var(--color-primary)] tracking-tight">
                選擇讀經範圍
              </h1>
              <p className="text-sm text-[var(--color-muted)] mt-1">
                預計 {formatDate(preview.completionDate)} 完成
              </p>
            </div>

            {/* Scope radio cards */}
            <div className="space-y-3 mb-6">
              {READING_SCOPES.map((s) => (
                <button
                  key={s.id}
                  onClick={() => handleScopeChange(s.id as 'nt' | 'ot' | 'nt_ot')}
                  className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                    scope === s.id
                      ? 'border-[var(--color-success)] bg-[var(--color-success)]/5'
                      : 'border-[var(--color-muted)]/20 bg-white hover:border-[var(--color-muted)]/40'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-[var(--color-primary)]">{s.label}</div>
                      <div className="text-sm text-[var(--color-muted)]">{s.description}</div>
                    </div>
                    {scope === s.id && (
                      <span className="text-[var(--color-success)] text-lg">✓</span>
                    )}
                  </div>
                </button>
              ))}
            </div>

            {/* Live preview card */}
            <div className="p-4 bg-white rounded-xl border border-[var(--color-muted)]/20 mb-6">
              <div className="text-xs font-bold text-[var(--color-muted)] uppercase tracking-wider mb-2">
                計劃預覽
              </div>

              {/* Chapter-per-day display */}
              {preview.parallel ? (
                /* Parallel: show NT + OT split */
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-muted)]">新約</span>
                    <span className="font-bold text-[var(--color-primary)]">每日 {preview.parallel.ntPerDay} 章</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-[var(--color-muted)]">舊約</span>
                    <span className="font-bold text-[var(--color-primary)]">每日 {preview.parallel.otPerDay} 章</span>
                  </div>
                  <div className="text-xs text-[var(--color-muted)] mt-1">
                    Parallel reading · {totalDays} days total
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-[var(--color-muted)]">每日</span>
                  <span className="text-2xl font-extrabold text-[var(--color-success)]">
                    {preview.chaptersPerDay}
                    <span className="text-base font-bold text-[var(--color-muted)] ml-1">章</span>
                  </span>
                </div>
              )}

              {/* Slider */}
              <div className="mt-4">
                <div className="flex justify-between text-xs text-[var(--color-muted)] font-bold mb-2">
                  <span>{slider.min}天</span>
                  <span>{totalDays}天</span>
                  <span>{slider.max}天</span>
                </div>

                {/* Custom range track */}
                <div className="relative h-2 bg-[var(--color-muted)]/20 rounded-full">
                  <div
                    className="absolute left-0 top-0 h-2 bg-[var(--color-success)] rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                  <input
                    type="range"
                    min={slider.min}
                    max={slider.max}
                    step={slider.step}
                    value={totalDays}
                    onChange={handleSliderChange}
                    className="absolute inset-0 w-full opacity-0 cursor-pointer"
                    aria-label="選擇完成天數"
                  />
                  {/* Thumb indicator */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-5 h-5 bg-white border-2 border-[var(--color-success)] rounded-full shadow pointer-events-none"
                    style={{ left: `calc(${pct}% - 10px)` }}
                  />
                </div>

                {/* Step hints */}
                <div className="flex justify-between text-[10px] text-[var(--color-muted)] mt-1 opacity-60">
                  {slider.marks.map((m) => (
                    <span key={m}>{m}d</span>
                  ))}
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-[var(--color-muted)]/10 text-xs text-[var(--color-muted)]">
                預計完成：<span className="font-bold text-[var(--color-primary)]">{formatDate(preview.completionDate)}</span>
              </div>
            </div>

            <button
              onClick={() => setStep(2)}
              className="w-full py-3.5 px-4 bg-[var(--color-success)] text-white rounded-xl font-extrabold text-base shadow-[var(--shadow-button)] hover:bg-[#46A302] active:translate-y-0.5 active:shadow-none transition-all"
            >
              繼續
            </button>
          </div>
        </div>
      )}

      {/* ── Step 2: Reading Order ──────────────────────────────────────── */}
      {step === 2 && (
        <div className="flex-1 flex flex-col justify-center px-4">
          <div className="max-w-sm mx-auto w-full">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">📅</div>
              <h1 className="text-2xl font-extrabold text-[var(--color-primary)] tracking-tight">
                閱讀順序
              </h1>
              <p className="text-sm text-[var(--color-muted)] mt-1">
                每日 {preview.chaptersPerDay} 章
              </p>
            </div>

            {/* Reading order cards — only for nt_ot */}
            {scope === 'nt_ot' ? (
              <div className="space-y-3 mb-6">
                {READING_ORDERS.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => setReadingOrder(o.id)}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                      readingOrder === o.id
                        ? 'border-[var(--color-success)] bg-[var(--color-success)]/5'
                        : 'border-[var(--color-muted)]/20 bg-white hover:border-[var(--color-muted)]/40'
                    }`}
                  >
                    <div className="font-bold text-[var(--color-primary)]">{o.label}</div>
                    <div className="text-sm text-[var(--color-muted)] mt-0.5">{o.sublabel}</div>
                    {readingOrder === o.id && (
                      <div className="mt-2 text-xs text-[var(--color-success)] font-bold">
                        每日{' '}
                        {o.id === 'parallel'
                          ? `${preview.parallel?.ntPerDay ?? '?'} 章 NT + ${preview.parallel?.otPerDay ?? '?'} 章 OT`
                          : `${preview.chaptersPerDay} 章`}
                      </div>
                    )}
                  </button>
                ))}
              </div>
            ) : (
              /* NT or OT only — no order needed, show summary */
              <div className="p-4 bg-white rounded-xl border border-[var(--color-muted)]/20 mb-6 text-center">
                <div className="text-sm text-[var(--color-muted)]">你的讀經計劃</div>
                <div className="font-extrabold text-[var(--color-primary)] text-lg mt-1">
                  {selected.label} · 每日 {preview.chaptersPerDay} 章
                </div>
                <div className="text-sm text-[var(--color-muted)] mt-1">
                  {totalDays}天完成 · {formatDate(preview.completionDate)}
                </div>
              </div>
            )}

            {/* Plan summary */}
            <div className="p-4 bg-[var(--color-success)]/5 rounded-xl border border-[var(--color-success)]/20 mb-6">
              <div className="text-xs font-bold text-[var(--color-muted)] uppercase tracking-wider mb-1">
                你的讀經計劃
              </div>
              <div className="font-bold text-[var(--color-primary)]">
                {selected.label} · {totalDays}天完成
              </div>
              <div className="text-sm text-[var(--color-muted)] mt-1">
                預計 {formatDate(preview.completionDate)}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep(1)}
                className="flex-1 py-3.5 px-4 bg-white text-[var(--color-primary)] rounded-xl border border-[var(--color-muted)]/30 font-bold text-base hover:bg-[var(--color-background)] transition-all"
              >
                上一步
              </button>
              <button
                onClick={handleSubmit}
                disabled={loading}
                className="flex-1 py-3.5 px-4 bg-[var(--color-success)] text-white rounded-xl font-extrabold text-base shadow-[var(--shadow-button)] hover:bg-[#46A302] active:translate-y-0.5 active:shadow-none transition-all disabled:opacity-60"
              >
                {loading ? '完成中...' : '開始讀經！'}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
