'use client'

/**
 * /discipline/goals — Goal Setting page.
 *
 * Mirrors the printed worksheet:
 *   5 categories (VIRTUE / KNOWLEDGE / SELF-CONTROL / GODLINESS / LOVE)
 *   × N columns (PLAN | STEPS / TIMELINE), where N ∈ {1, 2} per category.
 *
 * Persistence: Supabase via the upsertDisciplineGoals server action
 * (lib/disciplineActions.ts). Falls back to localStorage
 * 'duobible.discipline.goals.v1' on first load if no Supabase row yet
 * and the user has old v1 data — that legacy data is converted from
 * `{cat: {plan, steps}}` to `{cat: [{plan, steps}]}` on the way in.
 *
 * UI: per-category add/remove buttons cap target count at 2
 * (spec: variable-target-count, 2026-08-28).
 */

import { useEffect, useState } from 'react'
import DisciplineCard from '../components/DisciplineCard'
import ExportButton from '../components/ExportButton'
import FontSizeControl from '../components/FontSizeControl'
import {
  getDisciplineGoals,
  upsertDisciplineGoals,
  resetDisciplineGoals,
  type CategoryKey,
  type GoalTarget,
  type GoalsPayload,
} from '@/lib/disciplineActions'

const CATEGORIES: { key: CategoryKey; label: string; zh: string }[] = [
  { key: 'virtue', label: 'VIRTUE', zh: '品德' },
  { key: 'knowledge', label: 'KNOWLEDGE', zh: '知識' },
  { key: 'self_control', label: 'SELF-CONTROL', zh: '節制' },
  { key: 'godliness', label: 'GODLINESS', zh: '敬虔' },
  { key: 'love', label: 'LOVE', zh: '愛心' },
]

const EMPTY_TARGET = (): GoalTarget => ({ plan: '', steps: '' })
const emptyGoals = (): GoalsPayload => ({
  virtue: [EMPTY_TARGET()],
  knowledge: [EMPTY_TARGET()],
  self_control: [EMPTY_TARGET()],
  godliness: [EMPTY_TARGET()],
  love: [EMPTY_TARGET()],
})

const STORAGE_KEY = 'duobible.discipline.goals.v1'

type LegacyGoalForm = Record<CategoryKey, { plan: string; steps: string }>

/**
 * Convert legacy v1 shape `{cat: {plan, steps}}` to v2 shape `{cat: [{plan, steps}]}`.
 * Tolerates missing keys (returns empty target for any absent category).
 */
function migrateLegacyGoals(raw: unknown): GoalsPayload | null {
  if (!raw || typeof raw !== 'object') return null
  // v2 shape: { virtue: [...], knowledge: [...], ... }
  const out = emptyGoals()
  const obj = raw as Record<string, unknown>
  let anyData = false
  for (const cat of CATEGORIES) {
    const v = obj[cat.key]
    if (Array.isArray(v)) {
      // Already v2 — keep at most 2 targets
      const sliced = v
        .filter(
          (t): t is GoalTarget =>
            !!t && typeof t === 'object' && 'plan' in (t as object)
        )
        .slice(0, 2)
        .map((t) => ({
          plan: typeof t.plan === 'string' ? t.plan : '',
          steps: typeof t.steps === 'string' ? t.steps : '',
        }))
      out[cat.key] = sliced.length > 0 ? sliced : [EMPTY_TARGET()]
      if (sliced.some((t) => t.plan || t.steps)) anyData = true
    } else if (v && typeof v === 'object' && 'plan' in (v as object)) {
      // Legacy v1 shape: {plan, steps} → wrap in [t]
      const legacy = v as { plan?: unknown; steps?: unknown }
      out[cat.key] = [
        {
          plan: typeof legacy.plan === 'string' ? legacy.plan : '',
          steps: typeof legacy.steps === 'string' ? legacy.steps : '',
        },
      ]
      if (legacy.plan || legacy.steps) anyData = true
    }
  }
  return anyData ? out : null
}

/**
 * Read old localStorage payload (wrapper) and convert if needed.
 * Returns null when no usable legacy data is found.
 */
function readLegacyFromStorage(): GoalsPayload | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as { goals?: unknown; form?: unknown }
    // v2 wrapper: { goals: { cat: [...] }, savedAt }
    if (obj.goals && typeof obj.goals === 'object') {
      const migrated = migrateLegacyGoals(obj.goals)
      if (migrated) return migrated
    }
    // v1 wrapper: { form: { cat: {plan, steps} }, savedAt } OR bare {cat: {plan, steps}}
    if (obj.form && typeof obj.form === 'object') {
      const migrated = migrateLegacyGoals(obj.form)
      if (migrated) return migrated
    }
    return migrateLegacyGoals(parsed)
  } catch {
    return null
  }
}

export default function GoalsPage() {
  const [goals, setGoals] = useState<GoalsPayload>(emptyGoals())
  const [hydrated, setHydrated] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [signInRequired, setSignInRequired] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let initial: GoalsPayload | null = null

      // 1) Try Supabase first
      try {
        const res = await getDisciplineGoals()
        if (cancelled) return
        if (res.ok && res.goals) {
          // Ensure each category has at least one target
          const filled: GoalsPayload = { ...emptyGoals(), ...res.goals }
          for (const cat of CATEGORIES) {
            if (!Array.isArray(filled[cat.key]) || filled[cat.key].length === 0) {
              filled[cat.key] = [EMPTY_TARGET()]
            } else {
              filled[cat.key] = filled[cat.key].slice(0, 2)
            }
          }
          initial = filled
          setSavedAt(res.savedAt ?? null)
        } else if (res.error === 'not signed in') {
          setSignInRequired(true)
        }
      } catch {
        /* network error — fall through to localStorage */
      }

      // 2) Fallback: read legacy localStorage, convert to new shape
      if (!initial && !cancelled) {
        const legacy = readLegacyFromStorage()
        if (legacy) initial = legacy
      }

      if (!cancelled && initial) {
        setGoals(initial)
      }
      if (!cancelled) setHydrated(true)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  function updateTarget(
    cat: CategoryKey,
    idx: number,
    field: 'plan' | 'steps',
    val: string
  ) {
    setGoals((g) => {
      const targets = g[cat].map((t, i) =>
        i === idx ? { ...t, [field]: val } : t
      )
      return { ...g, [cat]: targets }
    })
  }

  function addTarget(cat: CategoryKey) {
    setGoals((g) => {
      if (g[cat].length >= 2) return g
      return { ...g, [cat]: [...g[cat], EMPTY_TARGET()] }
    })
  }

  function removeTarget(cat: CategoryKey, idx: number) {
    setGoals((g) => {
      if (g[cat].length <= 1) return g
      const targets = g[cat].filter((_, i) => i !== idx)
      return { ...g, [cat]: targets }
    })
  }

  async function save() {
    if (signInRequired) {
      setStatusMsg('請先登入才能儲存到雲端')
      return
    }
    setSaving(true)
    setStatusMsg(null)
    try {
      const res = await upsertDisciplineGoals(goals)
      if (res.ok && res.savedAt) {
        setSavedAt(res.savedAt)
        setStatusMsg('已儲存')
        // Mirror to legacy key as well so offline reloads show last good state
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({ goals, savedAt: res.savedAt })
          )
        } catch {
          /* ignore */
        }
      } else {
        setStatusMsg(`儲存失敗：${res.error ?? '未知錯誤'}`)
      }
    } catch (e) {
      setStatusMsg(`儲存失敗：${e instanceof Error ? e.message : '未知錯誤'}`)
    } finally {
      setSaving(false)
    }
  }

  async function reset() {
    if (!confirm('確定要清空所有目標嗎？此操作無法復原。')) return
    setGoals(emptyGoals())
    setSavedAt(null)
    setStatusMsg(null)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    if (!signInRequired) {
      try {
        await resetDisciplineGoals()
      } catch {
        /* best-effort */
      }
    }
  }

  const filename = `goals-${new Date().toISOString().slice(0, 10)}.png`

  return (
    <div className="page page-discipline-goals">
      <header className="page-header">
        <h1 className="h1">目標設定</h1>
        <FontSizeControl />
        <p className="page-subtitle">
          課程開始前，請為每個範疇訂立你的本季目標（每個範疇可設 1-2 個目標）
        </p>
      </header>

      <DisciplineCard accent="success" title="我的成全目標" className="discipline-goal-card">
        <div id="discipline-goals-export" className="discipline-export-frame">
          <div className="discipline-template-header">
            <h2 className="discipline-template-title">GOAL SETTING</h2>
            <p className="discipline-template-sub">成全追求 · 每週目標</p>
          </div>

          <div className="discipline-goal-table">
            <div className="discipline-goal-row discipline-goal-head">
              <div className="discipline-goal-cell discipline-goal-cat">範疇</div>
              <div className="discipline-goal-cell">PLAN</div>
              <div className="discipline-goal-cell">STEPS / TIMELINE</div>
            </div>
            {CATEGORIES.map((cat) => (
              <div key={cat.key}>
                {goals[cat.key].map((target, idx) => (
                  <div key={`${cat.key}-${idx}`} className="discipline-goal-row">
                    <div className="discipline-goal-cell discipline-goal-cat">
                      <span className="discipline-cat-en">{cat.label}</span>
                      <span className="discipline-cat-zh">
                        {cat.zh}
                        {goals[cat.key].length > 1 && (
                          <span className="discipline-goal-target-index">
                            {` · 目標 ${idx + 1}`}
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="discipline-goal-cell">
                      {hydrated ? (
                        <textarea
                          className="discipline-textarea"
                          value={target.plan}
                          onChange={(e) =>
                            updateTarget(cat.key, idx, 'plan', e.target.value)
                          }
                          placeholder={
                            goals[cat.key].length > 1
                              ? `${cat.zh}的目標 ${idx + 1}…`
                              : `${cat.zh}的目標…`
                          }
                          rows={3}
                          aria-label={`${cat.label} 目標 ${idx + 1} 計劃`}
                        />
                      ) : (
                        <div className="discipline-textarea-skeleton" />
                      )}
                    </div>
                    <div className="discipline-goal-cell">
                      {hydrated ? (
                        <textarea
                          className="discipline-textarea"
                          value={target.steps}
                          onChange={(e) =>
                            updateTarget(cat.key, idx, 'steps', e.target.value)
                          }
                          placeholder="具體步驟 / 時間…"
                          rows={3}
                          aria-label={`${cat.label} 目標 ${idx + 1} 步驟`}
                        />
                      ) : (
                        <div className="discipline-textarea-skeleton" />
                      )}
                    </div>
                  </div>
                ))}
                {hydrated && (
                  <div className="discipline-goal-row-tools">
                    {goals[cat.key].length < 2 && (
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => addTarget(cat.key)}
                        aria-label={`${cat.label} 添加第二個目標`}
                      >
                        + 添加目標
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn-secondary btn-sm"
                      onClick={() => removeTarget(cat.key, goals[cat.key].length - 1)}
                      disabled={goals[cat.key].length <= 1}
                      aria-label={`${cat.label} 移除最後一個目標`}
                    >
                      − 移除目標
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>

          {savedAt && (
            <p className="discipline-saved-stamp">
              ✓ 已儲存於 {new Date(savedAt).toLocaleString('zh-HK')}
            </p>
          )}
        </div>

        <div className="discipline-actions">
          <button
            type="button"
            className="btn-primary"
            onClick={save}
            disabled={saving || !hydrated}
          >
            {saving ? '儲存中…' : '💾 儲存目標'}
          </button>
          <button
            type="button"
            className="btn-secondary"
            onClick={reset}
            disabled={!hydrated}
          >
            清空
          </button>
        </div>
        {statusMsg && (
          <p className="discipline-status" role="status">
            {statusMsg}
          </p>
        )}
        {signInRequired && (
          <p className="discipline-status" role="status">
            未登入：你的編輯會保留在 localStorage，登入後可同步到雲端。
          </p>
        )}
      </DisciplineCard>

      <DisciplineCard accent="gem" title="提交給導師">
        <p>填寫完成後，匯出圖片後透過 WhatsApp 傳給導師確認。</p>
        <ExportButton
          targetSelector="#discipline-goals-export"
          filename={filename}
        />
      </DisciplineCard>
    </div>
  )
}