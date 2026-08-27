'use client'

/**
 * /discipline/weekly — Weekly Patience Record.
 *
 * Mirrors the printed worksheet:
 *   5 rows (categories) × 7 columns (Sat..Fri)
 *   Each cell = checkbox + optional note
 *
 * Default to current ISO week, but user can navigate to past weeks
 * for late fill-in.
 */

import { useEffect, useMemo, useState } from 'react'
import DisciplineCard from '../components/DisciplineCard'
import ExportButton from '../components/ExportButton'
import WeekSelector, {
  isoWeekString,
  weekDates,
  shiftWeek,
} from '../components/WeekSelector'

const CATEGORIES = [
  { key: 'virtue', label: 'VIRTUE', zh: '品德' },
  { key: 'knowledge', label: 'KNOWLEDGE', zh: '知識' },
  { key: 'self_control', label: 'SELF-CONTROL', zh: '節制' },
  { key: 'godliness', label: 'GODLINESS', zh: '敬虔' },
  { key: 'love', label: 'LOVE', zh: '愛心' },
] as const

type CategoryKey = (typeof CATEGORIES)[number]['key']
type DayKey = 'sat' | 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri'

const DAY_HEADERS: { key: DayKey; label: string; enShort: string }[] = [
  { key: 'sat', label: '六', enShort: 'SAT' },
  { key: 'sun', label: '日', enShort: 'SUN' },
  { key: 'mon', label: '一', enShort: 'MON' },
  { key: 'tue', label: '二', enShort: 'TUE' },
  { key: 'wed', label: '三', enShort: 'WED' },
  { key: 'thu', label: '四', enShort: 'THU' },
  { key: 'fri', label: '五', enShort: 'FRI' },
]

type WeeklyForm = Record<
  CategoryKey,
  Record<DayKey, { checked: boolean; note: string }>
>
const EMPTY_CELL = (): { checked: boolean; note: string } => ({
  checked: false,
  note: '',
})
function emptyWeekly(): WeeklyForm {
  const out = {} as WeeklyForm
  for (const c of CATEGORIES) {
    out[c.key] = {
      sat: EMPTY_CELL(),
      sun: EMPTY_CELL(),
      mon: EMPTY_CELL(),
      tue: EMPTY_CELL(),
      wed: EMPTY_CELL(),
      thu: EMPTY_CELL(),
      fri: EMPTY_CELL(),
    }
  }
  return out
}

const STORAGE_PREFIX = 'duobible.discipline.weekly.v1'

export default function WeeklyPage() {
  const [currentWeek] = useState(() => isoWeekString(new Date()))
  const [week, setWeek] = useState(() => isoWeekString(new Date()))
  const [form, setForm] = useState<WeeklyForm>(emptyWeekly())
  const [hydrated, setHydrated] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}.${week}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          setForm({ ...emptyWeekly(), ...parsed.form })
          setSavedAt(parsed.savedAt ?? null)
        }
      } else {
        setForm(emptyWeekly())
        setSavedAt(null)
      }
    } catch {
      setForm(emptyWeekly())
    }
    setHydrated(true)
  }, [week])

  function toggle(cat: CategoryKey, day: DayKey) {
    setForm((f) => ({
      ...f,
      [cat]: {
        ...f[cat],
        [day]: { ...f[cat][day], checked: !f[cat][day].checked },
      },
    }))
  }

  function setNote(cat: CategoryKey, day: DayKey, note: string) {
    setForm((f) => ({
      ...f,
      [cat]: {
        ...f[cat],
        [day]: { ...f[cat][day], note },
      },
    }))
  }

  function save() {
    const payload = { form, savedAt: new Date().toISOString() }
    try {
      localStorage.setItem(
        `${STORAGE_PREFIX}.${week}`,
        JSON.stringify(payload)
      )
      setSavedAt(payload.savedAt)
    } catch {
      /* localStorage full — silent */
    }
  }

  const dates = useMemo(() => weekDates(week), [week])
  const filename = `weekly-${week}.png`

  return (
    <div className="page page-discipline-weekly">
      <header className="page-header">
        <h1 className="h1">每週操練</h1>
        <p className="page-subtitle">
          記錄本週 7 天的操練表現（完成日期打✓ + 備註）
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

            {CATEGORIES.map((cat) => (
              <div key={cat.key} className="discipline-weekly-row">
                <div className="discipline-weekly-cell discipline-weekly-cat">
                  <span className="discipline-cat-en">{cat.label}</span>
                  <span className="discipline-cat-zh">{cat.zh}</span>
                </div>
                {DAY_HEADERS.map((d) => {
                  const cell = form[cat.key][d.key]
                  return (
                    <div
                      key={d.key}
                      className={`discipline-weekly-cell ${
                        cell.checked ? 'is-checked' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="discipline-check-btn"
                        aria-label={`${cat.label} ${d.enShort} ${
                          cell.checked ? '取消打勾' : '打勾'
                        }`}
                        aria-pressed={cell.checked}
                        onClick={() => toggle(cat.key, d.key)}
                      >
                        {cell.checked ? '✓' : ''}
                      </button>
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
                    </div>
                  )
                })}
              </div>
            ))}
          </div>

          {savedAt && (
            <p className="discipline-saved-stamp">
              ✓ {week} 已儲存於 {new Date(savedAt).toLocaleString('zh-HK')}
            </p>
          )}
        </div>

        <div className="discipline-actions">
          <button type="button" className="btn-primary" onClick={save}>
            💾 儲存本週紀錄
          </button>
        </div>
      </DisciplineCard>

      <DisciplineCard accent="gem" title="提交給導師">
        <p>
          {week === currentWeek ? '本週' : `${week} 補填`}
          完成後，匯出圖片並透過 WhatsApp 傳給導師。
        </p>
        <ExportButton
          targetSelector="#discipline-weekly-export"
          filename={filename}
          shareTitle={`成全操練週報 ${week}`}
          shareText={`這是 ${week} 的操練週報，請導師過目。`}
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