'use client'

/**
 * /discipline/goals — Goal Setting page.
 *
 * Mirrors the printed worksheet:
 *   5 categories (VIRTUE / KNOWLEDGE / SELF-CONTROL / GODLINESS / LOVE)
 *   × 2 columns (PLAN | STEPS / TIMELINE)
 *
 * One-shot form: user fills once at course start, saves to localStorage,
 * exported as PNG for trainer confirmation.
 */

import { useEffect, useState } from 'react'
import DisciplineCard from '../components/DisciplineCard'
import ExportButton from '../components/ExportButton'

const CATEGORIES = [
  { key: 'virtue', label: 'VIRTUE', zh: '品德' },
  { key: 'knowledge', label: 'KNOWLEDGE', zh: '知識' },
  { key: 'self_control', label: 'SELF-CONTROL', zh: '節制' },
  { key: 'godliness', label: 'GODLINESS', zh: '敬虔' },
  { key: 'love', label: 'LOVE', zh: '愛心' },
] as const

type CategoryKey = (typeof CATEGORIES)[number]['key']
type GoalForm = Record<CategoryKey, { plan: string; steps: string }>
const EMPTY: GoalForm = {
  virtue: { plan: '', steps: '' },
  knowledge: { plan: '', steps: '' },
  self_control: { plan: '', steps: '' },
  godliness: { plan: '', steps: '' },
  love: { plan: '', steps: '' },
}

const STORAGE_KEY = 'duobible.discipline.goals.v1'

export default function GoalsPage() {
  const [goals, setGoals] = useState<GoalForm>(EMPTY)
  const [hydrated, setHydrated] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          setGoals({ ...EMPTY, ...parsed.goals })
          setSavedAt(parsed.savedAt ?? null)
        }
      }
    } catch {
      /* corrupt localStorage — ignore */
    }
    setHydrated(true)
  }, [])

  function update(cat: CategoryKey, field: 'plan' | 'steps', val: string) {
    setGoals((g) => ({ ...g, [cat]: { ...g[cat], [field]: val } }))
  }

  function save() {
    const payload = { goals, savedAt: new Date().toISOString() }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
      setSavedAt(payload.savedAt)
    } catch {
      /* localStorage full / disabled — silent */
    }
  }

  function reset() {
    if (!confirm('確定要清空所有目標嗎？此操作無法復原。')) return
    setGoals(EMPTY)
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setSavedAt(null)
  }

  const filename = `goals-${new Date().toISOString().slice(0, 10)}.png`

  return (
    <div className="page page-discipline-goals">
      <header className="page-header">
        <h1 className="h1">目標設定</h1>
        <p className="page-subtitle">
          課程開始前，請為每個範疇訂立你的本季目標
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
              <div key={cat.key} className="discipline-goal-row">
                <div className="discipline-goal-cell discipline-goal-cat">
                  <span className="discipline-cat-en">{cat.label}</span>
                  <span className="discipline-cat-zh">{cat.zh}</span>
                </div>
                <div className="discipline-goal-cell">
                  {hydrated ? (
                    <textarea
                      className="discipline-textarea"
                      value={goals[cat.key].plan}
                      onChange={(e) => update(cat.key, 'plan', e.target.value)}
                      placeholder={`${cat.zh}的目標…`}
                      rows={3}
                      aria-label={`${cat.label} 目標`}
                    />
                  ) : (
                    <div className="discipline-textarea-skeleton" />
                  )}
                </div>
                <div className="discipline-goal-cell">
                  {hydrated ? (
                    <textarea
                      className="discipline-textarea"
                      value={goals[cat.key].steps}
                      onChange={(e) => update(cat.key, 'steps', e.target.value)}
                      placeholder="具體步驟 / 時間…"
                      rows={3}
                      aria-label={`${cat.label} 步驟`}
                    />
                  ) : (
                    <div className="discipline-textarea-skeleton" />
                  )}
                </div>
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
          <button type="button" className="btn-primary" onClick={save}>
            💾 儲存目標
          </button>
          <button type="button" className="btn-secondary" onClick={reset}>
            清空
          </button>
        </div>
      </DisciplineCard>

      <DisciplineCard accent="gem" title="提交給導師">
        <p>填寫完成後，匯出圖片後透過 WhatsApp 傳給導師確認。</p>
        <ExportButton
          targetSelector="#discipline-goals-export"
          filename={filename}
          shareTitle="成全操練目標設定"
          shareText="這是我的成全追求每週目標，請導師過目。"
        />
      </DisciplineCard>
    </div>
  )
}