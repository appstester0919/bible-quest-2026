'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { subscribeToPush, unsubscribeFromPush, getPushPermissionStatus } from '@/lib/push'
import { updateDisplayName } from '@/lib/groupActions'
import { getRequiredDays } from '@/lib/bible/scope'
import type { Scope } from '@/lib/bible/scope'

// Reminder time constraints — minute granularity is 15 min to avoid cron
// running every minute (free Cloudflare plan stays within quota). Hour is
// 0-23 because Cloudflare Cron Triggers are hourly at best; the minute
// pick controls which quarter-hour inside that hour the push fires.
const HOURS = Array.from({ length: 24 }, (_, h) => ({ value: h, label: `${h.toString().padStart(2, '0')}時` }))
const MINUTES = [0, 15, 30, 45].map((m) => ({ value: m, label: `${m.toString().padStart(2, '0')}分` }))

// Friendly "晚/早/中" labelling for hour — Cantonese reader gets a quick read.
function hourLabel(h: number): string {
  if (h < 6) return `凌晨 ${h} 時`
  if (h < 12) return `早上 ${h} 時`
  if (h === 12) return '中午 12 時'
  if (h < 18) return `下午 ${h} 時`
  return `晚上 ${h} 時`
}

export default function SettingsPage() {
  const router = useRouter()
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  // Default = 8pm @ 0min — matches the legacy '20:00' default and the DB default.
  const [reminderHour, setReminderHour] = useState<number>(20)
  const [reminderMinute, setReminderMinute] = useState<number>(0)
  const [currentEnrollment, setCurrentEnrollment] = useState<{
    id: string; scope: string; chapters_per_day: number; total_days: number;
    reading_order?: string | null;
    start_book_index?: number | null; start_chapter?: number | null;
    nt_start_book_index?: number | null; ot_start_book_index?: number | null;
    nt_start_chapter?: number | null; ot_start_chapter?: number | null;
  } | null>(null)
  const [completedPlans, setCompletedPlans] = useState(0)
  const [updatingPlan, setUpdatingPlan] = useState(false)
  const [confirmShow, setConfirmShow] = useState(false)
  const [pendingPlan, setPendingPlan] = useState<{ scope: string; chaptersPerDay: number; totalDays: number } | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [nameSaved, setNameSaved] = useState(false)

  useEffect(() => {
    setPushPermission(getPushPermissionStatus())
    // Optimistic localStorage check — run before SW promise chain so the
    // hour+minute picker renders on first paint, even before service worker
    // registration resolves. SW registration can take 1-2s on slow networks.
    if (localStorage.getItem('bq_push_subscription')) {
      setIsSubscribed(true)
    }
    // Then reconcile with the SW state for accuracy (e.g., user revoked
    // permission in browser settings — localStorage stale but SW reflects truth).
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((reg) => reg.pushManager.getSubscription())
        .then((sub) => {
          if (sub) {
            setIsSubscribed(true)
          } else if (!localStorage.getItem('bq_push_subscription')) {
            // SW says no subscription AND localStorage is empty — definitely not subscribed
            setIsSubscribed(false)
          }
          // else: localStorage had something but SW says no — keep optimistic true
          // so the user can see the picker and click "Disable" to clean up.
        })
        .catch((err) => console.error('[push] sub check failed:', err))
    }
    fetchEnrollment()
    fetchDisplayName()
    fetchReminderSchedule()
  }, [])

  async function fetchReminderSchedule() {
    // Hydrate the hour/minute dropdowns from the user's most recent active
    // subscription row. We read MAX(reminder_hour) because lib/push.ts upserts
    // the same value to every device row, so any row gives the truth.
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase
      .from('web_push_subscriptions')
      .select('reminder_hour, reminder_minute')
      .eq('user_id', user.id)
      .eq('active', true)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (data) {
      if (typeof data.reminder_hour === 'number' && data.reminder_hour >= 0 && data.reminder_hour <= 23) {
        setReminderHour(data.reminder_hour)
      }
      if (typeof data.reminder_minute === 'number' && [0, 15, 30, 45].includes(data.reminder_minute)) {
        setReminderMinute(data.reminder_minute)
      }
    }
  }

  async function fetchDisplayName() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data } = await supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle()
    if (data?.display_name) setDisplayName(data.display_name)
  }

  async function fetchEnrollment() {
    const supabase = createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return
    const { data: enrollment } = await supabase
      .from('user_plan_enrollments')
      .select('id, scope, chapters_per_day, total_days, status, reading_order, start_book_index, start_chapter, nt_start_book_index, ot_start_book_index, nt_start_chapter, ot_start_chapter')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .maybeSingle()
    setCurrentEnrollment(enrollment)
    const { data: stats } = await supabase
      .from('user_stats')
      .select('completed_plans')
      .eq('user_id', user.id)
      .maybeSingle()
    setCompletedPlans(stats?.completed_plans ?? 0)
  }

  async function handleChangePlan() {
    if (!currentEnrollment) {
      router.push('/onboarding')
      return
    }
    setUpdatingPlan(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // Mark old enrollment as abandoned, create new active one
      await supabase
        .from('user_plan_enrollments')
        .update({ status: 'abandoned' })
        .eq('id', currentEnrollment.id)

      // Re-derive total_days from scope + chapters_per_day so legacy data
      // (which may have wrong total_days) doesn't get copied forward.
      // For nt_ot we also need to validate the reading_order against the
      // current DB CHECK constraint.
      const scope = currentEnrollment.scope as 'nt' | 'ot' | 'nt_ot'
      const cpd = currentEnrollment.chapters_per_day
      const properTotalDays =
        scope === 'nt'   ? Math.ceil(260 / cpd) :
        scope === 'ot'   ? Math.ceil(929 / cpd) :
        /* nt_ot */        cpd   // legacy fallback — will be re-derived by generator

      // For nt_ot scope, reading_order is REQUIRED by the DB CHECK constraint.
      // If the old enrollment has a valid value, copy it; otherwise compute a
      // sensible default based on chapters_per_day.
      let readingOrder: string | null = null
      if (scope === 'nt_ot') {
        const old = (currentEnrollment as { reading_order?: string | null }).reading_order
        if (old && /^[0-9]+-[0-9]+$|^nt_then_ot$|^ot_then_nt$/.test(old)) {
          readingOrder = old
        } else {
          // Legacy nt_ot row without reading_order — synthesize a parallel split
          // that matches the cpd. Use ~20% NT, 80% OT ratio as a sane default.
          const ntCh = Math.max(1, Math.ceil(cpd * 0.2))
          const otCh = cpd - ntCh
          readingOrder = `${ntCh}-${otCh}`
        }
      }

      // Create new enrollment. Copy per-testament start position from the old
      // enrollment so users who started mid-Bible (e.g. 帖前 / 約伯記) keep that
      // starting point across restarts. Without this, generateReadingPlan
      // falls back to chapter 1 and the new plan begins at 太1 / 創1.
      const oldEnr = currentEnrollment as {
        start_book_index?: number | null
        start_chapter?: number | null
        nt_start_book_index?: number | null
        ot_start_book_index?: number | null
        nt_start_chapter?: number | null
        ot_start_chapter?: number | null
      }
      const { error } = await supabase
        .from('user_plan_enrollments')
        .insert({
          user_id: user.id,
          scope,
          chapters_per_day: cpd,
          total_days: properTotalDays,
          reading_order: readingOrder,
          start_book_index: oldEnr.start_book_index ?? null,
          start_chapter: oldEnr.start_chapter ?? null,
          nt_start_book_index: oldEnr.nt_start_book_index ?? null,
          ot_start_book_index: oldEnr.ot_start_book_index ?? null,
          nt_start_chapter: oldEnr.nt_start_chapter ?? null,
          ot_start_chapter: oldEnr.ot_start_chapter ?? null,
          status: 'active',
          started_at: new Date().toISOString(),
        })
      if (error) {
        alert('更新計劃失敗：' + error.message)
        return
      }
      await fetchEnrollment()
      setConfirmShow(false)
      alert('✅ 已開始新一週目！加油 💪')
      router.push('/calendar')
    } finally {
      setUpdatingPlan(false)
    }
  }

  async function handleTogglePush() {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        alert('請先登入')
        return
      }
      if (isSubscribed) {
        await unsubscribeFromPush()
        setIsSubscribed(false)
        // Mark reminder disabled so the cron stops sending pushes
        await supabase
          .from('web_push_subscriptions')
          .update({ enabled_reminder: false })
          .eq('user_id', user.id)
      } else {
        const sub = await subscribeToPush()
        setIsSubscribed(!!sub)
        if (sub) {
          // Persist reminder time so the cron picks us up on next tick
          const hour = reminderHour
          const minute = reminderMinute
          await supabase
            .from('web_push_subscriptions')
            .update({
              reminder_hour: hour,
              reminder_minute: minute,
              timezone: 'Asia/Hong_Kong',
              enabled_reminder: true,
            })
            .eq('user_id', user.id)
            .eq('active', true)
        }
      }
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveReminder() {
    setLoading(true)
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        alert('請先登入')
        return
      }
      const hour = reminderHour
      const minute = reminderMinute
      // Update reminder schedule on every active device row for this user.
      // The Worker cron reads these columns to decide when to send pushes.
      const { error } = await supabase
        .from('web_push_subscriptions')
        .update({
          reminder_hour: hour,
          reminder_minute: minute,
          timezone: 'Asia/Hong_Kong',
        })
        .eq('user_id', user.id)
        .eq('active', true)
      if (error) {
        alert('儲存失敗: ' + error.message)
        return
      }
      // Keep legacy 'bq_reminder_time' key in sync as "HH:MM" so any
      // subscribeToPush() call happening concurrently reads the same time.
      const hh = reminderHour.toString().padStart(2, '0')
      const mm = reminderMinute.toString().padStart(2, '0')
      localStorage.setItem('bq_reminder_time', `${hh}:${mm}`)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setLoading(false)
    }
  }

  async function handleSignOut() {
    if (!confirm('確定要登出嗎？')) return
    setLoading(true)
    try {
      const supabase = createClient()
      await supabase.auth.signOut()
      router.push('/login')
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveDisplayName() {
    if (displayName.trim().length === 0 || displayName.trim().length > 3) {
      alert('顯示名稱必須為 1-3 字')
      return
    }
    setSavingName(true)
    try {
      const result = await updateDisplayName(displayName.trim())
      if (result.success) {
        setNameSaved(true)
        setTimeout(() => setNameSaved(false), 2000)
      } else {
        alert('保存失敗：' + (result.error || '未知錯誤'))
      }
    } finally {
      setSavingName(false)
    }
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <header className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
        <a href="/dashboard" className="text-2xl">←</a>
        <h1 className="text-xl font-bold text-[var(--color-primary)]">設定</h1>
      </header>

      <main className="max-w-sm mx-auto px-4 py-6 space-y-4">
        {/* Display Name */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--color-primary)] mb-1">👤 顯示名稱</h2>
          <p className="text-sm text-[var(--color-muted)] mb-4">
            用在群組裡顯示，最多 3 個中文字
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={3}
              placeholder="如：小明"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-base"
            />
            <button
              onClick={handleSaveDisplayName}
              disabled={savingName}
              className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-medium disabled:opacity-50"
            >
              {savingName ? '...' : nameSaved ? '✓' : '保存'}
            </button>
          </div>
        </div>

        {/* Push Notifications — daily reminder via Web Push */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--color-primary)] mb-1">🔔 讀經提醒</h2>
          <p className="text-sm text-[var(--color-muted)] mb-3">
            每日提醒你完成讀經
          </p>

          {/* Status banner */}
          {pushPermission === 'unsupported' && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-800 mb-3">
              你嘅瀏覽器不支援推送通知。請用最新版 Chrome、Edge 或 Firefox。
            </div>
          )}
          {pushPermission === 'denied' && (
            <div className="bg-red-50 border border-red-200 rounded-xl p-3 text-sm text-red-800 mb-3">
              通知權限已被拒絕。請喺瀏覽器設定入面重新允許。
            </div>
          )}

          {/* Enable / disable toggle */}
          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium">
                {isSubscribed ? '✅ 已啟用推送通知' : '啟用推送通知'}
              </p>
              <p className="text-xs text-[var(--color-muted)] mt-0.5">
                {isSubscribed
                  ? '到時會自動彈出通知提醒你'
                  : '點擊下方按鈕以開啟瀏覽器權限'}
              </p>
            </div>
            <button
              onClick={handleTogglePush}
              disabled={loading || pushPermission === 'unsupported' || pushPermission === 'denied'}
              className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-medium disabled:opacity-50"
            >
              {isSubscribed ? '關閉' : '啟用'}
            </button>
          </div>

          {/* Reminder time picker — only shown if subscribed */}
          {isSubscribed && (
            <div className="border-t border-gray-100 pt-3 mt-3">
              <label className="block text-sm font-medium mb-2">
                提醒時間（香港時間）
              </label>
              <div className="flex gap-2">
                <select
                  value={reminderHour}
                  onChange={(e) => setReminderHour(Number(e.target.value))}
                  disabled={loading}
                  aria-label="小時"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-base bg-white"
                >
                  {HOURS.map((h) => (
                    <option key={h.value} value={h.value}>{h.label}</option>
                  ))}
                </select>
                <select
                  value={reminderMinute}
                  onChange={(e) => setReminderMinute(Number(e.target.value))}
                  disabled={loading}
                  aria-label="分鐘"
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-base bg-white"
                >
                  {MINUTES.map((m) => (
                    <option key={m.value} value={m.value}>{m.label}</option>
                  ))}
                </select>
                <button
                  onClick={handleSaveReminder}
                  disabled={loading}
                  className="px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-medium disabled:opacity-50"
                >
                  {saved ? '✓' : '保存'}
                </button>
              </div>
              <p className="text-xs text-[var(--color-muted)] mt-2">
                你揀咗：
                <span className="font-bold text-[var(--color-primary)] ml-1">
                  {hourLabel(reminderHour)} {reminderMinute.toString().padStart(2, '0')} 分
                </span>
              </p>
              <p className="text-xs text-[var(--color-muted)] mt-1">
                提醒會喺你揀嘅時間發送。如果當日已完成讀經，就唔會重複提醒。
              </p>
              <p className="text-xs text-[var(--color-muted)] mt-1">
                分鐘只能揀 00／15／30／45。雲端排程每 15 分鐘只可跑一次，所以呢個限制可避免額外收費。
              </p>
            </div>
          )}
        </div>

        {/* Plan Management */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--color-primary)] mb-1">📖 讀經計劃</h2>
          <p className="text-sm text-[var(--color-muted)] mb-4">
            查看或修改你的讀經計劃
          </p>

          {currentEnrollment ? (
            <>
              <div className="bg-[var(--color-background)] rounded-xl p-4 mb-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--color-muted)]">當前範圍</span>
                  <span className="font-bold text-[var(--color-primary)]">
                    {currentEnrollment.scope === 'nt' ? '新約' : currentEnrollment.scope === 'ot' ? '舊約' : '新舊約'}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--color-muted)]">每日章數</span>
                  <span className="font-bold text-[var(--color-primary)]">{currentEnrollment.chapters_per_day} 章</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--color-muted)]">總天數</span>
                  <span className="font-bold text-[var(--color-primary)]">
                    {getRequiredDays(currentEnrollment.scope as Scope, currentEnrollment.chapters_per_day)} 天
                  </span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-[var(--color-muted)]/10">
                  <span className="text-[var(--color-muted)]">已完成週目</span>
                  <span className="font-bold text-[var(--color-success)]">
                    🏆 {completedPlans} 次
                  </span>
                </div>
              </div>

              {/* Redesign plan — change scope or daily chapters */}
              <a
                href="/onboarding?mode=redesign"
                className="block w-full py-2.5 px-4 bg-[var(--color-success)] text-white rounded-xl font-bold text-sm text-center hover:bg-[#46A302] transition-all"
              >
                ⚙️ 重新設計計劃
              </a>
              <p className="text-xs text-[var(--color-muted)] mt-1.5 text-center">
                改變範圍或每日章數
              </p>

              <button
                onClick={() => setConfirmShow(true)}
                disabled={updatingPlan}
                className="mt-3 w-full py-2.5 px-4 bg-[var(--color-primary)] text-white rounded-xl font-bold text-sm hover:bg-[#374151] active:translate-y-0.5 transition-all disabled:opacity-50"
              >
                🔄 重新開始新一週目
              </button>
              <p className="text-xs text-[var(--color-muted)] mt-1.5 text-center">
                同樣計劃重新讀一次
              </p>
            </>
          ) : completedPlans > 0 ? (
            <>
              <div className="bg-[var(--color-background)] rounded-xl p-4 mb-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-[var(--color-muted)]">當前狀態</span>
                  <span className="font-bold text-[var(--color-success)]">✅ 計劃已完成</span>
                </div>
                <div className="flex justify-between text-sm pt-2 border-t border-[var(--color-muted)]/10">
                  <span className="text-[var(--color-muted)]">已完成週目</span>
                  <span className="font-bold text-[var(--color-success)]">
                    🏆 {completedPlans} 次
                  </span>
                </div>
              </div>

              <a
                href="/onboarding"
                className="block w-full py-2.5 px-4 bg-[var(--color-primary)] text-white rounded-xl font-bold text-sm text-center hover:bg-[#374151] transition-all"
              >
                🔄 開始新一週目
              </a>
              <p className="text-xs text-[var(--color-muted)] mt-2 text-center">
                按上方按鈕開始新一週目
              </p>
            </>
          ) : (
            <a
              href="/onboarding"
              className="block w-full py-2.5 px-4 bg-[var(--color-success)] text-white rounded-xl font-bold text-sm text-center hover:bg-[#46A302] transition-all"
            >
              ➕ 建立讀經計劃
            </a>
          )}
        </div>

        {/* Confirm dialog */}
        {confirmShow && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl p-6 max-w-sm w-full">
              <h3 className="text-xl font-bold text-[var(--color-primary)] mb-2">
                確認重新開始？
              </h3>
              <p className="text-sm text-[var(--color-muted)] mb-4">
                將會把當前計劃標記為「已放棄」，並開始一個全新的讀經計劃。你嘅歷史完成次數會保留。
              </p>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmShow(false)}
                  disabled={updatingPlan}
                  className="flex-1 py-2.5 px-4 bg-[var(--color-muted)]/20 text-[var(--color-primary)] rounded-xl font-bold text-sm disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleChangePlan}
                  disabled={updatingPlan}
                  className="flex-1 py-2.5 px-4 bg-[var(--color-primary)] text-white rounded-xl font-bold text-sm disabled:opacity-50"
                >
                  {updatingPlan ? '處理中...' : '確認'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Sign Out */}
        <button
          onClick={handleSignOut}
          disabled={loading}
          className="w-full bg-white rounded-2xl p-5 shadow-sm text-left hover:shadow-md transition-shadow disabled:opacity-50"
        >
          <div className="flex items-center gap-3">
            <span className="text-2xl">🚪</span>
            <div>
              <p className="text-lg font-bold text-[var(--color-danger)]">登出</p>
              <p className="text-xs text-[var(--color-muted)] mt-0.5">
                清除登入狀態，重新登入可修復異常問題
              </p>
            </div>
          </div>
        </button>

        {/* App Info */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--color-primary)] mb-3">ℹ️ 關於</h2>
          <div className="space-y-2 text-sm text-[var(--color-muted)]">
            <p>版本：1.0.0</p>
            <p>Bible Quest 2026</p>
            <p className="text-xs mt-2">為大專基督徒而設的讀經計劃應用</p>
          </div>
        </div>
      </main>
    </div>
  )
}
