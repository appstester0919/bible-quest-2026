'use client'

import { useState, useEffect } from 'react'
import { subscribeToPush, unsubscribeFromPush, getPushPermissionStatus } from '@/lib/push'

const REMINDER_TIMES = [
  { value: '07:00', label: '早上 7:00' },
  { value: '08:00', label: '早上 8:00' },
  { value: '09:00', label: '早上 9:00' },
  { value: '12:00', label: '中午 12:00' },
  { value: '20:00', label: '晚上 8:00 (默認)' },
  { value: '21:00', label: '晚上 9:00' },
]

export default function SettingsPage() {
  const [pushPermission, setPushPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [isSubscribed, setIsSubscribed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [saved, setSaved] = useState(false)
  const [reminderTime, setReminderTime] = useState('20:00')

  useEffect(() => {
    setPushPermission(getPushPermissionStatus())
    // Check SW subscription status
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready.then((reg) =>
        reg.pushManager.getSubscription().then((sub) => setIsSubscribed(!!sub))
      )
    }
  }, [])

  async function handleTogglePush() {
    setLoading(true)
    try {
      if (isSubscribed) {
        await unsubscribeFromPush()
        setIsSubscribed(false)
      } else {
        const sub = await subscribeToPush()
        setIsSubscribed(!!sub)
      }
    } finally {
      setLoading(false)
    }
  }

  function handleSaveReminder() {
    localStorage.setItem('bq_reminder_time', reminderTime)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <header className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
        <a href="/dashboard" className="text-2xl">←</a>
        <h1 className="text-xl font-bold text-[var(--color-primary)]">設定</h1>
      </header>

      <main className="max-w-sm mx-auto px-4 py-6 space-y-4">
        {/* Push Notifications */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--color-primary)] mb-1">🔔 讀經提醒</h2>
          <p className="text-sm text-[var(--color-muted)] mb-4">
            每日提醒你完成讀經
          </p>

          {pushPermission === 'unsupported' ? (
            <p className="text-sm text-[var(--color-danger)]">
              你的瀏覽器不支援推送通知
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-bold text-[var(--color-primary)]">推送通知</p>
                  <p className="text-sm text-[var(--color-muted)]">
                    狀態：{pushPermission === 'granted' ? '已允許' : pushPermission === 'denied' ? '已拒絕' : '未設定'}
                  </p>
                </div>
                <button
                  onClick={handleTogglePush}
                  disabled={loading || pushPermission === 'denied'}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${isSubscribed ? 'bg-[var(--color-success)]' : 'bg-[var(--color-muted)]/30'} disabled:opacity-50`}
                  aria-label={isSubscribed ? '關閉通知' : '開啟通知'}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${isSubscribed ? 'translate-x-6' : 'translate-x-1'}`} />
                </button>
              </div>

              <div className="border-t border-[var(--color-muted)]/10 pt-4">
                <label className="text-sm font-bold text-[var(--color-primary)] block mb-2">
                  提醒時間
                </label>
                <select
                  value={reminderTime}
                  onChange={(e) => setReminderTime(e.target.value)}
                  className="w-full p-3 rounded-xl border border-[var(--color-muted)]/20 bg-[var(--color-background)] text-[var(--color-primary)] text-sm"
                >
                  {REMINDER_TIMES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
                <button
                  onClick={handleSaveReminder}
                  className="mt-3 w-full py-2.5 px-4 bg-[var(--color-primary)] text-white rounded-xl font-bold text-sm hover:bg-[#374151] active:translate-y-0.5 transition-all"
                >
                  {saved ? '✓ 已儲存' : '儲存設定'}
                </button>
              </div>
            </>
          )}
        </div>

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
