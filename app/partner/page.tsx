'use client'

import { useState, useEffect } from 'react'
import { createPartnerInvite, getPartnerInfo } from './actions'

interface PartnerData {
  partner_id: string
  paired_at: string
  partner: { id: string; display_name: string | null; avatar_url: string | null } | null
  partner_stats: { current_streak: number; longest_streak: number; last_completed_date: string | null; total_xp: number; level: number } | null
}

export default function PartnerPage() {
  const [partner, setPartner] = useState<PartnerData | null>(null)
  const [inviteToken, setInviteToken] = useState<string | null>(null)
  const [inviteUrl, setInviteUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => { getPartnerInfo().then(setPartner) }, [])

  async function handleCreateInvite() {
    setLoading(true)
    setError('')
    try {
      const { token } = await createPartnerInvite()
      setInviteToken(token)
      setInviteUrl(`https://bible-quest-2026.vercel.app/invite/${token}`)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : '發生錯誤')
    } finally {
      setLoading(false)
    }
  }

  function handleCopyLink() {
    if (!inviteUrl) return
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleWhatsAppShare() {
    if (!inviteUrl) return
    const text = `我喺度用「聖經任務」讀經！一齊嚟做我嘅讀經拍檔：${inviteUrl}`
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank')
  }

  const today = new Date().toLocaleDateString('zh-Hant', { timeZone: 'Asia/Hong_Kong' }).replace(/\//g, '-')

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      <header className="bg-white px-4 py-3 flex items-center gap-3 shadow-sm">
        <a href="/dashboard" className="text-2xl">←</a>
        <h1 className="text-xl font-bold text-[var(--color-primary)]">讀經夥伴</h1>
      </header>

      <main className="max-w-sm mx-auto px-4 py-6 space-y-4">
        {error && (
          <div className="p-3 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 rounded-xl text-sm text-[var(--color-danger)] text-center">
            {error}
          </div>
        )}

        {partner ? (
          <>
            <div className="bg-white rounded-2xl p-5 shadow-sm">
              <h2 className="text-lg font-bold text-[var(--color-primary)] mb-3">👥 你的讀經夥伴</h2>
              <div className="flex items-center gap-3 mb-4">
                <div className="w-12 h-12 rounded-full bg-[var(--color-accent)]/20 flex items-center justify-center text-2xl">
                  {partner.partner?.display_name?.[0] ?? '?'}
                </div>
                <div>
                  <p className="font-bold text-[var(--color-primary)]">{partner.partner?.display_name ?? '未知用戶'}</p>
                  <p className="text-sm text-[var(--color-muted)]">
                    Level {partner.partner_stats?.level ?? 1} · {partner.partner_stats?.total_xp ?? 0} XP
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                <div className="bg-[var(--color-background)] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[var(--color-streak)]">🔥 {partner.partner_stats?.current_streak ?? 0}</p>
                  <p className="text-xs text-[var(--color-muted)]">連續日數</p>
                </div>
                <div className="bg-[var(--color-background)] rounded-xl p-3 text-center">
                  <p className="text-2xl font-bold text-[var(--color-gem)]">🏆 {partner.partner_stats?.longest_streak ?? 0}</p>
                  <p className="text-xs text-[var(--color-muted)]">最長streak</p>
                </div>
              </div>
              <div className={`p-3 rounded-xl text-sm font-bold text-center ${partner.partner_stats?.last_completed_date === today ? 'bg-[var(--color-success)]/10 text-[var(--color-success)]' : 'bg-[var(--color-muted)]/10 text-[var(--color-muted)]'}`}>
                {partner.partner_stats?.last_completed_date === today ? '✓ 今日已完成讀經' : '今日尚未讀經'}
              </div>
            </div>
          </>
        ) : (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <h2 className="text-lg font-bold text-[var(--color-primary)] mb-3">👥 讀經夥伴</h2>
            <p className="text-[var(--color-muted)] text-sm mb-4">邀請朋友一起讀經，互相督促！</p>

            {!inviteToken ? (
              <button
                onClick={handleCreateInvite}
                disabled={loading}
                className="w-full py-3 px-4 bg-[var(--color-success)] text-white rounded-xl font-extrabold text-base shadow-[var(--shadow-button)] hover:bg-[#46A302] active:translate-y-0.5 active:shadow-none transition-all disabled:opacity-60"
              >
                {loading ? '建立中...' : '建立邀請連結'}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="p-3 bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 rounded-xl text-sm text-[var(--color-success)] text-center font-bold">
                  ✓ 邀請連結已建立！
                </div>
                <button onClick={handleCopyLink}
                  className="w-full py-3 px-4 bg-[var(--color-primary)] text-white rounded-xl font-bold text-base hover:bg-[#374151] active:translate-y-0.5 transition-all">
                  📋 {copied ? '已複製！' : '複製連結'}
                </button>
                <button onClick={handleWhatsAppShare}
                  className="w-full py-3 px-4 bg-[#25D366] text-white rounded-xl font-bold text-base hover:bg-[#1ebe5d] active:translate-y-0.5 transition-all">
                  💬 用 WhatsApp 分享
                </button>
              </div>
            )}
          </div>
        )}

        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h3 className="font-bold text-[var(--color-primary)] mb-3">📖 夥伴制度說明</h3>
          <ul className="space-y-2 text-sm text-[var(--color-muted)]">
            <li>• 配對成功後，你可以看到夥伴的 streak 和今日進度</li>
            <li>• 夥伴只能看到你是否完成讀經，<strong className="text-[var(--color-primary)]">無法看到你閱讀的章節</strong></li>
            <li>• 每次你和夥伴完成讀經，都會收到通知</li>
            <li>• 目前只支援單一夥伴</li>
          </ul>
        </div>
      </main>
    </div>
  )
}
