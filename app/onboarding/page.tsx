'use client'

import { useState } from 'react'
import { completeOnboarding } from './actions'

const READING_SCOPES = [
  { id: 'nt', label: '新約', description: '260 章聖經', sublabel: '60天完成', chapters: 260, defaultDays: 60 },
  { id: 'ot', label: '舊約', description: '929 章聖經', sublabel: '180天完成', chapters: 929, defaultDays: 180 },
  { id: 'nt_ot', label: '新約 + 舊約', description: '1189 章聖經', sublabel: '365天完成', chapters: 1189, defaultDays: 365 },
]

const READING_ORDERS = [
  { id: 'nt_ot', label: '新約 → 舊約' },
  { id: 'ot_nt', label: '舊約 → 新約' },
  { id: 'parallel', label: '新舊並行' },
]

function getDaysOptions(scope: string): number[] {
  if (scope === 'nt') return [40, 50, 60, 70, 80, 90]
  if (scope === 'ot') return [90, 120, 150, 180, 240, 365]
  return [180, 240, 300, 365, 450, 540, 730]
}

function formatDate(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toLocaleDateString('zh-Hant', { timeZone: 'Asia/Hong_Kong', year: 'numeric', month: 'long', day: 'numeric' })
}

export default function OnboardingPage() {
  const [step, setStep] = useState(1)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [scope, setScope] = useState('nt')
  const [totalDays, setTotalDays] = useState(60)
  const [readingOrder, setReadingOrder] = useState('nt_ot')

  const selected = READING_SCOPES.find((s) => s.id === scope)!

  async function handleSubmit() {
    setLoading(true)
    setError('')
    const fd = new FormData()
    fd.append('scope', scope)
    fd.append('total_days', String(totalDays))
    fd.append('reading_order', readingOrder)
    try {
      await completeOnboarding(fd)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '發生錯誤')
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex flex-col bg-[var(--color-background)]">
      {/* Progress */}
      <div className="pt-8 px-4">
        <div className="flex gap-1 max-w-sm mx-auto">
          {[1, 2].map((s) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full transition-colors ${s <= step ? 'bg-[var(--color-success)]' : 'bg-[var(--color-muted)]/20'}`} />
          ))}
        </div>
        <p className="text-center text-xs text-[var(--color-muted)] mt-2 font-bold uppercase tracking-wider">步驟 {step} / 2</p>
      </div>

      {/* Error */}
      {error && (
        <div className="mx-4 mt-4 max-w-sm mx-auto w-full">
          <div className="p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 rounded-lg text-sm text-[var(--color-danger)] text-center">{error}</div>
        </div>
      )}

      {step === 1 && (
        <div className="flex-1 flex flex-col justify-center px-4">
          <div className="max-w-sm mx-auto w-full">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">📖</div>
              <h1 className="text-2xl font-extrabold text-[var(--color-primary)] tracking-tight">選擇讀經範圍</h1>
              <p className="text-sm text-[var(--color-muted)] mt-1">預計 {formatDate(totalDays)} 完成</p>
            </div>
            <div className="space-y-3">
              {READING_SCOPES.map((s) => (
                <button key={s.id} onClick={() => { setScope(s.id); setTotalDays(s.defaultDays) }}
                  className={`w-full p-4 rounded-xl border-2 text-left transition-all ${scope === s.id ? 'border-[var(--color-success)] bg-[var(--color-success)]/5' : 'border-[var(--color-muted)]/20 bg-white hover:border-[var(--color-muted)]/40'}`}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="font-bold text-[var(--color-primary)]">{s.label}</div>
                      <div className="text-sm text-[var(--color-muted)]">{s.description}</div>
                    </div>
                    <span className="text-xs font-bold text-[var(--color-success)] bg-[var(--color-success)]/10 px-2 py-1 rounded-full">{s.sublabel}</span>
                  </div>
                  {scope === s.id && (
                    <div className="mt-3 pt-3 border-t border-[var(--color-success)]/20">
                      <label className="text-xs font-bold text-[var(--color-muted)] uppercase tracking-wider block mb-1">完成時間</label>
                      <div className="flex flex-wrap gap-2">
                        {getDaysOptions(s.id).map((d) => (
                          <button key={d} onClick={(e) => { e.stopPropagation(); setTotalDays(d) }}
                            className={`px-3 py-1 rounded-lg text-sm font-bold transition-colors ${totalDays === d ? 'bg-[var(--color-success)] text-white' : 'bg-[var(--color-muted)]/10 text-[var(--color-primary)] hover:bg-[var(--color-muted)]/20'}`}>{d}天</button>
                        ))}
                      </div>
                    </div>
                  )}
                </button>
              ))}
            </div>
            <button onClick={() => setStep(2)} className="mt-6 w-full py-3.5 px-4 bg-[var(--color-success)] text-white rounded-xl font-extrabold text-base shadow-[var(--shadow-button)] hover:bg-[#46A302] active:translate-y-0.5 active:shadow-none transition-all">繼續</button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="flex-1 flex flex-col justify-center px-4">
          <div className="max-w-sm mx-auto w-full">
            <div className="text-center mb-6">
              <div className="text-5xl mb-3">📅</div>
              <h1 className="text-2xl font-extrabold text-[var(--color-primary)] tracking-tight">閱讀順序</h1>
              <p className="text-sm text-[var(--color-muted)] mt-1">每日 {Math.ceil(selected.chapters / totalDays)} 章</p>
            </div>
            {scope === 'nt_ot' && (
              <div className="space-y-3 mb-6">
                {READING_ORDERS.map((o) => (
                  <button key={o.id} onClick={() => setReadingOrder(o.id)}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all ${readingOrder === o.id ? 'border-[var(--color-success)] bg-[var(--color-success)]/5' : 'border-[var(--color-muted)]/20 bg-white hover:border-[var(--color-muted)]/40'}`}>
                    <div className="font-bold text-[var(--color-primary)]">{o.label}</div>
                  </button>
                ))}
              </div>
            )}
            <div className="p-4 bg-white rounded-xl border border-[var(--color-muted)]/20 mb-6">
              <div className="text-sm text-[var(--color-muted)] mb-1">你的讀經計劃</div>
              <div className="font-bold text-[var(--color-primary)]">{selected.label} · {totalDays}天完成</div>
              <div className="text-sm text-[var(--color-muted)] mt-1">預計 {formatDate(totalDays)} 完成</div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 py-3.5 px-4 bg-white text-[var(--color-primary)] rounded-xl border border-[var(--color-muted)]/30 font-bold text-base hover:bg-[var(--color-background)] transition-all">上一步</button>
              <button onClick={handleSubmit} disabled={loading} className="flex-1 py-3.5 px-4 bg-[var(--color-success)] text-white rounded-xl font-extrabold text-base shadow-[var(--shadow-button)] hover:bg-[#46A302] active:translate-y-0.5 active:shadow-none transition-all disabled:opacity-60">{loading ? '完成中...' : '開始讀經！'}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
