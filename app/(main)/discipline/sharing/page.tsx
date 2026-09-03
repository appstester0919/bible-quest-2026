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
 *
 * Persistence: Supabase via the upsertDisciplineSharing server action
 * (lib/disciplineActions.ts). On first load, if no Supabase row yet,
 * falls back to localStorage 'duobible.discipline.sharing.v1.<isoWeek>'
 * — that legacy data already has the same {message, daily, savedAt}
 * shape as the new server action, so no field conversion is needed.
 * After a successful Supabase save the legacy key is removed.
 */

import { useEffect, useState } from 'react'
import DisciplineCard from '../components/DisciplineCard'
import ExportButton from '../components/ExportButton'
import AutoTextarea from '../components/AutoTextarea'
import FontSizeControl from '../components/FontSizeControl'
import WeekSelector, {
  isoWeekString,
  shiftWeek,
} from '../components/WeekSelector'
import {
  getDisciplineSharing,
  upsertDisciplineSharing,
} from '@/lib/disciplineActions'

const LEGACY_STORAGE_PREFIX = 'duobible.discipline.sharing.v1'

type SharingForm = { message: string; daily: string }

const EMPTY: SharingForm = { message: '', daily: '' }

/**
 * Read the legacy v1 localStorage payload. The legacy shape
 * {message, daily, savedAt} is identical to the new server-action shape
 * for the same week, so we can copy it through directly.
 */
function readLegacy(week: string): SharingForm | null {
  try {
    const raw = localStorage.getItem(`${LEGACY_STORAGE_PREFIX}.${week}`)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as { message?: unknown; daily?: unknown }
    return {
      message: typeof obj.message === 'string' ? obj.message : '',
      daily: typeof obj.daily === 'string' ? obj.daily : '',
    }
  } catch {
    return null
  }
}

export default function SharingPage() {
  const [currentWeek] = useState(() => isoWeekString(new Date()))
  const [week, setWeek] = useState(() => isoWeekString(new Date()))
  const [form, setForm] = useState<SharingForm>(EMPTY)
  const [hydrated, setHydrated] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [signInRequired, setSignInRequired] = useState(false)
  const [saving, setSaving] = useState(false)
  const [statusMsg, setStatusMsg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let loadedForm: SharingForm | null = null
      let loadedSavedAt: string | null = null

      // 1) Supabase
      try {
        const res = await getDisciplineSharing(week)
        if (cancelled) return
        if (res.ok) {
          // Server action returns `undefined` for missing fields when the
          // row doesn't exist. Treat the row existing only when BOTH text
          // fields come back (mirrors how the migration's default '' is
          // echoed — never undefined when the row exists).
          if (
            typeof res.message === 'string' &&
            typeof res.daily === 'string'
          ) {
            loadedForm = { message: res.message, daily: res.daily }
          }
          loadedSavedAt = res.savedAt ?? null
          if (res.error === 'not signed in') {
            setSignInRequired(true)
          }
        }
      } catch {
        /* fall through */
      }

      // 2) Legacy localStorage fallback
      if (!loadedForm && !cancelled) {
        const legacy = readLegacy(week)
        if (legacy) loadedForm = legacy
      }

      if (!cancelled) {
        setForm(loadedForm ?? EMPTY)
        setSavedAt(loadedSavedAt)
        setHydrated(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [week])

  async function save() {
    if (signInRequired) {
      setStatusMsg('請先登入才能儲存到雲端')
      return
    }
    setSaving(true)
    setStatusMsg(null)
    try {
      const res = await upsertDisciplineSharing({
        isoWeek: week,
        message: form.message,
        daily: form.daily,
      })
      if (res.ok && res.savedAt) {
        setSavedAt(res.savedAt)
        setStatusMsg('已儲存')
        // Once a successful Supabase write happens, the legacy localStorage
        // key is redundant — clear it so we don't re-migrate on next load.
        try {
          localStorage.removeItem(`${LEGACY_STORAGE_PREFIX}.${week}`)
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

  const filename = `sharing-${week}.png`

  return (
    <div className="page page-discipline-sharing">
      <header className="page-header">
        <h1 className="h1">分享信仰</h1>
        <FontSizeControl />
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
              聽完本週成全操練課程的講台訊息後，記下你的啟發和得著
            </p>
            <AutoTextarea
              className="discipline-sharing-textarea"
              value={form.message}
              onChange={(e) =>
                setForm((f) => ({ ...f, message: e.target.value }))
              }
              placeholder="本週講台訊息給我的啟發…"
              minHeight={110}
              rows={5}
              aria-label={`${week} MESSAGE`}
            />
          </div>

          <div className="discipline-sharing-block">
            <div className="discipline-sharing-label">DAILY SHARING</div>
            <p className="discipline-sharing-hint">
              與導師分享本週生活：近況、信仰經歷、感恩或代禱事項
            </p>
            <AutoTextarea
              className="discipline-sharing-textarea"
              value={form.daily}
              onChange={(e) => setForm((f) => ({ ...f, daily: e.target.value }))}
              placeholder="本週生活分享：近況 / 信仰經歷 / 代禱事項…"
              minHeight={150}
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
