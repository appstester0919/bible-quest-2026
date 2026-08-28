'use client'

/**
 * /discipline/sharing — Sharing Your Faith.
 *
 * Mirrors the printed worksheet:
 *   Two text boxes per week: MESSAGE (the gospel summary) and
 *   DAILY SHARING (conversations / acts of witness during the week).
 *
 * One entry per week. Default to current ISO week, allow switching
 * for late fill-in (same pattern as weekly).
 */

import { useEffect, useState } from 'react'
import DisciplineCard from '../components/DisciplineCard'
import ExportButton from '../components/ExportButton'
import WeekSelector, {
  isoWeekString,
  shiftWeek,
} from '../components/WeekSelector'

const STORAGE_PREFIX = 'duobible.discipline.sharing.v1'

type SharingForm = { message: string; daily: string }

const EMPTY: SharingForm = { message: '', daily: '' }

export default function SharingPage() {
  const [currentWeek] = useState(() => isoWeekString(new Date()))
  const [week, setWeek] = useState(() => isoWeekString(new Date()))
  const [form, setForm] = useState<SharingForm>(EMPTY)
  const [hydrated, setHydrated] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`${STORAGE_PREFIX}.${week}`)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          setForm({ ...EMPTY, ...parsed.form })
          setSavedAt(parsed.savedAt ?? null)
        }
      } else {
        setForm(EMPTY)
        setSavedAt(null)
      }
    } catch {
      setForm(EMPTY)
    }
    setHydrated(true)
  }, [week])

  function save() {
    const payload = { form, savedAt: new Date().toISOString() }
    try {
      localStorage.setItem(
        `${STORAGE_PREFIX}.${week}`,
        JSON.stringify(payload)
      )
      setSavedAt(payload.savedAt)
    } catch {
      /* ignore */
    }
  }

  const filename = `sharing-${week}.png`

  return (
    <div className="page page-discipline-sharing">
      <header className="page-header">
        <h1 className="h1">分享信仰</h1>
        <p className="page-subtitle">
          記錄本週的福音信息要點（MESSAGE）與日常分享（DAILY SHARING）
        </p>
      </header>

      <WeekSelector value={week} onChange={setWeek} />
      {!hydrated && <p className="discipline-loading">載入中…</p>}

      {currentWeek !== week && (
        <p className="discipline-week-warning">
          ⚠️ 你正在補填 <strong>{week}</strong> 的紀錄（本週是 {currentWeek}）
        </p>
      )}

      <DisciplineCard accent="gem" title={`${week} 分享紀錄`}>
        <div id="discipline-sharing-export" className="discipline-export-frame">
          <div className="discipline-template-header">
            <h2 className="discipline-template-title">SHARING YOUR FAITH</h2>
            <p className="discipline-template-sub">成全追求 · 信仰分享</p>
          </div>

          <div className="discipline-sharing-block">
            <div className="discipline-sharing-label">MESSAGE</div>
            <p className="discipline-sharing-hint">
              用 3-5 句話總結你會如何向人介紹福音
            </p>
            <textarea
              className="discipline-sharing-textarea"
              value={form.message}
              onChange={(e) =>
                setForm((f) => ({ ...f, message: e.target.value }))
              }
              placeholder="福音的核心信息…"
              rows={5}
              aria-label={`${week} MESSAGE`}
            />
          </div>

          <div className="discipline-sharing-block">
            <div className="discipline-sharing-label">DAILY SHARING</div>
            <p className="discipline-sharing-hint">
              本週與哪些人分享過信仰？結果如何？
            </p>
            <textarea
              className="discipline-sharing-textarea"
              value={form.daily}
              onChange={(e) => setForm((f) => ({ ...f, daily: e.target.value }))}
              placeholder="週一：與同事午飯時分享耶穌的愛…"
              rows={7}
              aria-label={`${week} DAILY SHARING`}
            />
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

      <DisciplineCard accent="streak" title="提交給導師">
        <p>
          {week === currentWeek ? '本週' : `${week} 補填`}
          完成後，匯出圖片並透過 WhatsApp 傳給導師。
        </p>
        <ExportButton
          targetSelector="#discipline-sharing-export"
          filename={filename}
        />
        <details className="discipline-week-nav">
          <summary>其他週次快速跳轉</summary>
          <div className="discipline-week-nav-list">
            {[-2, -1, 0, 1, 2].map((delta) => (
              <button
                key={delta}
                className="btn-secondary"
                type="button"
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