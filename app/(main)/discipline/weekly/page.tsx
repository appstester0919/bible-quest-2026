'use client'

/**
 * /discipline/weekly — Weekly Patience Record.
 *
 * Mirrors the printed worksheet:
 *   5 rows (categories) × 7 columns (Sat..Fri)
 *   Each cell = 1-or-2 target checkboxes + 50-char note
 *
 * Target count per cell follows goals[cat].length (1 or 2), so the UI
 * auto-extends when the user adds a 2nd target in /goals. Goals are
 * read once at mount and on week change (rarely needed in practice —
 * a goals update on /goals would need a re-navigation to take effect
 * for the cell grid; that's acceptable for v1).
 *
 * Persistence: Supabase via the upsertDisciplineWeekly server action
 * (lib/disciplineActions.ts). Falls back to localStorage
 * 'duobible.discipline.weekly.v1.<isoWeek>' on first load if no
 * Supabase row yet — that legacy data is converted from
 * `{cat: {day: {checked, note}}}` to `{cat: {day: {targets: [checked], note}}}`
 * on the way in.
 */

import { useEffect, useMemo, useState } from 'react'
import DisciplineCard from '../components/DisciplineCard'
import ExportButton from '../components/ExportButton'
import WeekSelector, {
  isoWeekString,
  weekDates,
  shiftWeek,
} from '../components/WeekSelector'
import {
  getDisciplineWeekly,
  upsertDisciplineWeekly,
  type CategoryKey,
  type DayKey,
  type WeeklyCell,
  type WeeklyCellsPayload,
} from '@/lib/disciplineActions'

const CATEGORIES: { key: CategoryKey; label: string; zh: string }[] = [
  { key: 'virtue', label: 'VIRTUE', zh: '品德' },
  { key: 'knowledge', label: 'KNOWLEDGE', zh: '知識' },
  { key: 'self_control', label: 'SELF-CONTROL', zh: '節制' },
  { key: 'godliness', label: 'GODLINESS', zh: '敬虔' },
  { key: 'love', label: 'LOVE', zh: '愛心' },
]

const DAY_HEADERS: { key: DayKey; label: string; enShort: string }[] = [
  { key: 'sat', label: '六', enShort: 'SAT' },
  { key: 'sun', label: '日', enShort: 'SUN' },
  { key: 'mon', label: '一', enShort: 'MON' },
  { key: 'tue', label: '二', enShort: 'TUE' },
  { key: 'wed', label: '三', enShort: 'WED' },
  { key: 'thu', label: '四', enShort: 'THU' },
  { key: 'fri', label: '五', enShort: 'FRI' },
]

const STORAGE_PREFIX = 'duobible.discipline.weekly.v1'

/**
 * Build empty cells with `n` targets per cell.
 */
function emptyCells(n = 1): WeeklyCellsPayload {
  const out = {} as WeeklyCellsPayload
  for (const c of CATEGORIES) {
    out[c.key] = {
      sat: { targets: Array.from({ length: n }, () => false), note: '' },
      sun: { targets: Array.from({ length: n }, () => false), note: '' },
      mon: { targets: Array.from({ length: n }, () => false), note: '' },
      tue: { targets: Array.from({ length: n }, () => false), note: '' },
      wed: { targets: Array.from({ length: n }, () => false), note: '' },
      thu: { targets: Array.from({ length: n }, () => false), note: '' },
      fri: { targets: Array.from({ length: n }, () => false), note: '' },
    }
  }
  return out
}

type LegacyCell = { checked?: boolean; note?: string }

/**
 * Convert legacy v1 shape `{cat: {day: {checked, note}}}` to v2 shape
 * `{cat: {day: {targets: [checked], note}}}`. Tolerates missing keys.
 */
function migrateLegacyCells(raw: unknown): WeeklyCellsPayload | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  // v2 shape: { cat: { day: { targets: [bool], note } } }
  // Detect: any category with day shape having 'targets' array.
  for (const cat of CATEGORIES) {
    const cv = obj[cat.key]
    if (!cv || typeof cv !== 'object') continue
    const dayVals = cv as Record<string, unknown>
    for (const d of DAY_HEADERS) {
      const dv = dayVals[d.key]
      if (dv && typeof dv === 'object' && 'targets' in (dv as object)) {
        // already v2-ish; trust and return as-is
        return null
      }
    }
  }
  // Treat as legacy v1
  const out = emptyCells(1)
  let any = false
  for (const cat of CATEGORIES) {
    const cv = obj[cat.key] as
      | Record<string, LegacyCell>
      | undefined
      | null
    if (!cv || typeof cv !== 'object') continue
    for (const d of DAY_HEADERS) {
      const dv = cv[d.key]
      if (dv && typeof dv === 'object') {
        const checked = !!(dv as LegacyCell).checked
        const note =
          typeof (dv as LegacyCell).note === 'string'
            ? (dv as LegacyCell).note ?? ''
            : ''
        out[cat.key][d.key] = { targets: [checked], note }
        if (checked || note) any = true
      }
    }
  }
  return any ? out : null
}

function readLegacyCells(week: string): WeeklyCellsPayload | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}.${week}`)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as { cells?: unknown; form?: unknown }
    // v2 wrapper: { cells: {...}, savedAt }
    if (obj.cells && typeof obj.cells === 'object') {
      // If legacy key was already in v2 shape, don't try to convert
      const inner = obj.cells as Record<string, unknown>
      let looksV2 = false
      for (const cat of CATEGORIES) {
        const cv = inner[cat.key]
        if (!cv || typeof cv !== 'object') continue
        for (const d of DAY_HEADERS) {
          const dv = (cv as Record<string, unknown>)[d.key]
          if (dv && typeof dv === 'object' && 'targets' in (dv as object)) {
            looksV2 = true
            break
          }
        }
        if (looksV2) break
      }
      if (looksV2) return null
    }
    // v1 wrapper: { form: {cat:{day:{checked,note}}}, savedAt }
    if (obj.form && typeof obj.form === 'object') {
      const migrated = migrateLegacyCells(obj.form)
      if (migrated) return migrated
    }
    return migrateLegacyCells(parsed)
  } catch {
    return null
  }
}

/**
 * Build cells whose targets length matches goals[cat].length per cat.
 * If cells come from Supabase/localStorage, realign them; otherwise return
 * empty cells with the right shape.
 */
function buildCells(
  raw: WeeklyCellsPayload | null | undefined,
  goalLengths: Record<CategoryKey, number>
): WeeklyCellsPayload {
  if (!raw) return emptyCells(1) // will be realigned below
  const out = {} as WeeklyCellsPayload
  for (const cat of CATEGORIES) {
    const n = goalLengths[cat.key]
    out[cat.key] = {} as Record<DayKey, WeeklyCell>
    for (const d of DAY_HEADERS) {
      const existing = raw[cat.key]?.[d.key]
      const existingTargets = existing?.targets ?? []
      const next: boolean[] = []
      for (let i = 0; i < n; i++) {
        next.push(Boolean(existingTargets[i]))
      }
      out[cat.key][d.key] = {
        targets: next,
        note: existing?.note ?? '',
      }
    }
  }
  return out
}

export default function WeeklyPage() {
  const [currentWeek] = useState(() => isoWeekString(new Date()))
  const [week, setWeek] = useState(() => isoWeekString(new Date()))
  const [cells, setCells] = useState<WeeklyCellsPayload>(emptyCells(1))
  const [goalLengths, setGoalLengths] = useState<Record<CategoryKey, number>>({
    virtue: 1,
    knowledge: 1,
    self_control: 1,
    godliness: 1,
    love: 1,
  })
  const [hydrated, setHydrated] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [signInRequired, setSignInRequired] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let loadedCells: WeeklyCellsPayload | null = null
      let loadedLengths: Record<CategoryKey, number> = {
        virtue: 1,
        knowledge: 1,
        self_control: 1,
        godliness: 1,
        love: 1,
      }

      // 1) Supabase
      try {
        const res = await getDisciplineWeekly(week)
        if (cancelled) return
        if (res.ok) {
          if (res.cells) {
            loadedCells = res.cells
          }
          setSavedAt(res.savedAt ?? null)
          if (res.error === 'not signed in') {
            setSignInRequired(true)
          }
        }
      } catch {
        /* fall through */
      }

      // 2) LocalStorage fallback
      if (!loadedCells && !cancelled) {
        const legacy = readLegacyCells(week)
        if (legacy) loadedCells = legacy
      }

      // 3) Goals are read from goals action separately to determine
      // per-category target count.
      try {
        const goalsRes = await (
          await import('@/lib/disciplineActions')
        ).getDisciplineGoals()
        if (cancelled) return
        if (goalsRes.ok && goalsRes.goals) {
          for (const cat of CATEGORIES) {
            const arr = goalsRes.goals[cat.key]
            if (Array.isArray(arr) && arr.length > 0) {
              loadedLengths[cat.key] = Math.min(2, arr.length)
            }
          }
        }
      } catch {
        /* ignore — defaults to 1 */
      }

      if (!cancelled) {
        const aligned = buildCells(loadedCells, loadedLengths)
        setCells(aligned)
        setGoalLengths(loadedLengths)
        setHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [week])

  // If goalLengths ever changes after hydration (e.g. user adds a 2nd
  // target via /goals and comes back), realign cells.
  useEffect(() => {
    if (!hydrated) return
    setCells((c) => {
      const out = {} as WeeklyCellsPayload
      for (const cat of CATEGORIES) {
        const n = goalLengths[cat.key]
        out[cat.key] = {} as Record<DayKey, WeeklyCell>
        for (const d of DAY_HEADERS) {
          const existing = c[cat.key]?.[d.key]
          const existingTargets = existing?.targets ?? []
          const next: boolean[] = []
          for (let i = 0; i < n; i++) {
            next.push(Boolean(existingTargets[i]))
          }
          out[cat.key][d.key] = {
            targets: next,
            note: existing?.note ?? '',
          }
        }
      }
      return out
    })
  }, [goalLengths, hydrated])

  function toggle(cat: CategoryKey, day: DayKey, targetIdx: number) {
    setCells((c) => {
      const cell = c[cat][day]
      const targets = cell.targets.map((v, i) =>
        i === targetIdx ? !v : v
      )
      return {
        ...c,
        [cat]: { ...c[cat], [day]: { ...cell, targets } },
      }
    })
  }

  function setNote(cat: CategoryKey, day: DayKey, note: string) {
    setCells((c) => {
      const cell = c[cat][day]
      return {
        ...c,
        [cat]: { ...c[cat], [day]: { ...cell, note } },
      }
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
      const res = await upsertDisciplineWeekly({ isoWeek: week, cells })
      if (res.ok && res.savedAt) {
        setSavedAt(res.savedAt)
        setStatusMsg('已儲存')
        try {
          localStorage.setItem(
            `${STORAGE_PREFIX}.${week}`,
            JSON.stringify({ cells, savedAt: res.savedAt })
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

  const dates = useMemo(() => weekDates(week), [week])
  const filename = `weekly-${week}.png`

  return (
    <div className="page page-discipline-weekly">
      <header className="page-header">
        <h1 className="h1">每週操練</h1>
        <p className="page-subtitle">
          記錄本週 7 天的操練表現（完成日期打✓ + 備註，每個範疇 1-2 個目標）
        </p>
      </header>

      <WeekSelector value={week} onChange={setWeek} />
      {!hydrated && <p className="discipline-loading">載入中…</p>}

      {currentWeek !== week && (
        <p className="discipline-week-warning">
          ⚠️ 你正在補填 <strong>{week}</strong> 的紀錄（本週是 {currentWeek}）
        </p>
      )}

      <DisciplineCard accent="streak" title={`${week} 操練紀錄`}>
        <div id="discipline-weekly-export" className="discipline-export-frame">
          <div className="discipline-template-header">
            <h2 className="discipline-template-title">WEEKLY PATIENCE RECORD</h2>
            <p className="discipline-template-sub">成全追求 · 操練追蹤</p>
          </div>

          <div className="discipline-weekly-table">
            <div className="discipline-weekly-row discipline-weekly-head">
              <div className="discipline-weekly-cell discipline-weekly-cat">
                範疇
              </div>
              {DAY_HEADERS.map((d, i) => (
                <div
                  key={d.key}
                  className="discipline-weekly-cell discipline-weekly-day"
                >
                  <span className="discipline-weekly-day-en">{d.enShort}</span>
                  <span className="discipline-weekly-day-num">
                    {dates[i]?.getDate() ?? ''}
                  </span>
                </div>
              ))}
            </div>

            {CATEGORIES.map((cat) => {
              const n = goalLengths[cat.key]
              return (
                <div key={cat.key} className="discipline-weekly-row">
                  <div className="discipline-weekly-cell discipline-weekly-cat">
                    <span className="discipline-cat-en">{cat.label}</span>
                    <span className="discipline-cat-zh">
                      {cat.zh}
                      {n > 1 && (
                        <span className="discipline-goal-target-index">
                          {` ×${n}`}
                        </span>
                      )}
                    </span>
                  </div>
                  {DAY_HEADERS.map((d) => {
                    const cell = cells[cat.key][d.key]
                    const allChecked = cell.targets.every(Boolean)
                    return (
                      <div
                        key={d.key}
                        className={`discipline-weekly-cell ${
                          allChecked && cell.targets.length > 0
                            ? 'is-checked'
                            : ''
                        }`}
                      >
                        {hydrated ? (
                          <>
                            <div className="discipline-weekly-checks">
                              {cell.targets.map((checked, ti) => (
                                <button
                                  key={ti}
                                  type="button"
                                  className="discipline-check-btn"
                                  aria-label={`${cat.label} ${d.enShort} 目標 ${ti + 1} ${
                                    checked ? '取消打勾' : '打勾'
                                  }`}
                                  aria-pressed={checked}
                                  onClick={() => toggle(cat.key, d.key, ti)}
                                >
                                  {checked ? '✓' : ''}
                                </button>
                              ))}
                            </div>
                            <input
                              type="text"
                              className="discipline-note-input"
                              value={cell.note}
                              onChange={(e) =>
                                setNote(cat.key, d.key, e.target.value)
                              }
                              placeholder="備註"
                              aria-label={`${cat.label} ${d.enShort} 備註`}
                              maxLength={50}
                            />
                          </>
                        ) : (
                          <div className="discipline-weekly-cell-skeleton" />
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {savedAt && (
            <p className="discipline-saved-stamp">
              ✓ {week} 已儲存於 {new Date(savedAt).toLocaleString('zh-HK')}
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
            {saving ? '儲存中…' : '💾 儲存本週紀錄'}
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
        <p>
          {week === currentWeek ? '本週' : `${week} 補填`}
          完成後，匯出圖片並透過 WhatsApp 傳給導師。
        </p>
        <ExportButton
          targetSelector="#discipline-weekly-export"
          filename={filename}
        />
        <details className="discipline-week-nav">
          <summary>其他週次快速跳轉</summary>
          <div className="discipline-week-nav-list">
            {[-2, -1, 0, 1, 2].map((delta) => (
              <button
                key={delta}
                type="button"
                className="btn-secondary"
                onClick={() => setWeek(shiftWeek(currentWeek, delta))}
              >
                {delta === 0
                  ? '本週'
                  : delta > 0
                    ? `+${delta} 週`
                    : `${delta} 週`}
              </button>
            ))}
          </div>
        </details>
      </DisciplineCard>
    </div>
  )
}