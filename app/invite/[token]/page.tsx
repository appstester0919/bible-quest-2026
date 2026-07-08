'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { acceptPartnerInvite } from '../../partner/actions'

export default function InviteAcceptPage() {
  const params = useParams()
  const router = useRouter()
  const token = params.token as string

  const [inviterName, setInviterName] = useState<string>('')
  const [status, setStatus] = useState<'loading' | 'error' | 'success' | 'already' | 'ready'>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    async function checkInvite() {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()

      if (!user) {
        // Not logged in → redirect to signup with return URL
        router.push(`/signup?redirect=/invite/${token}`)
        return
      }

      const { data: invite } = await supabase
        .from('partner_invites')
        .select('id, inviter_id, status, inviter:profiles!inviter_id(display_name)')
        .eq('token', token)
        .single()

      if (!invite) {
        setStatus('error')
        setErrorMsg('邀請不存在或已過期')
        return
      }

      if (invite.status === 'accepted') {
        setStatus('already')
        return
      }

      const inviter = Array.isArray(invite.inviter) ? invite.inviter[0] : invite.inviter
      setInviterName(inviter?.display_name ?? '一位朋友')

      // Check if current user already has an active partner
      const { data: myPair } = await supabase
        .from('partner_pairs')
        .select('id')
        .eq('user_id', user.id)
        .eq('status', 'active')
        .single()

      if (myPair) {
        setStatus('already')
        return
      }

      setStatus('ready')
    }
    checkInvite()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  async function handleAccept() {
    setLoading(true)
    setErrorMsg('')
    try {
      await acceptPartnerInvite(token)
      setStatus('success')
    } catch (e: unknown) {
      setStatus('error')
      setErrorMsg(e instanceof Error ? e.message : '配對失敗')
    } finally {
      setLoading(false)
    }
  }

  if (status === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <p className="text-[var(--color-muted)]">載入中...</p>
      </div>
    )
  }

  if (status === 'success') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-background)] px-4">
        <div className="text-6xl mb-4">🎉</div>
        <h1 className="text-2xl font-extrabold text-[var(--color-primary)] mb-2">配對成功！</h1>
        <p className="text-[var(--color-muted)] mb-6 text-center">你和 {inviterName} 已成為讀經夥伴！</p>
        <a href="/dashboard"
          className="py-3 px-6 bg-[var(--color-success)] text-white rounded-xl font-extrabold text-base shadow-[var(--shadow-button)]">
          返去讀經 ✨
        </a>
      </div>
    )
  }

  if (status === 'already') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-background)] px-4">
        <div className="text-6xl mb-4">ℹ️</div>
        <h1 className="text-2xl font-extrabold text-[var(--color-primary)] mb-2">無需重複配對</h1>
        <p className="text-[var(--color-muted)] mb-6 text-center">你已經有讀經夥伴了！</p>
        <a href="/dashboard"
          className="py-3 px-6 bg-[var(--color-success)] text-white rounded-xl font-extrabold text-base shadow-[var(--shadow-button)]">
          返去讀經
        </a>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[var(--color-background)] px-4">
      <div className="text-6xl mb-4">🤝</div>
      <h1 className="text-2xl font-extrabold text-[var(--color-primary)] mb-2">
        {inviterName} 邀請你做讀經夥伴
      </h1>
      <p className="text-[var(--color-muted)] mb-6 text-center">
        接受後，你們可以看到彼此的 streak 和今日進度
      </p>

      {status === 'error' ? (
        <div className="p-4 bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/20 rounded-xl text-sm text-[var(--color-danger)] text-center mb-4 max-w-sm">
          {errorMsg}
        </div>
      ) : (
        <button
          onClick={handleAccept}
          disabled={loading}
          className="w-full max-w-sm py-3.5 px-4 bg-[var(--color-success)] text-white rounded-xl font-extrabold text-base shadow-[var(--shadow-button)] hover:bg-[#46A302] active:translate-y-0.5 active:shadow-none transition-all disabled:opacity-60"
        >
          {loading ? '處理中...' : '接受邀請 ✓'}
        </button>
      )}

      <a href="/dashboard" className="mt-4 text-sm text-[var(--color-muted)] underline">
        稍後再說
      </a>
    </div>
  )
}
