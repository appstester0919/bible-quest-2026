'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getIncompleteGroupMembersToday } from '@/lib/groupActions'
import { NudgeDialog } from './NudgeDialog'

/**
 * v0.5 (2026-08-15) — NudgeButton: "📣 提醒組員" CTA.
 *
 * Visibility rules (all 3 must hold):
 *   1. Current user has completed today's reading (HKT ±14h grace window,
 *      matching server action's reading_sessions grace window).
 *   2. Current user has NOT used today's sender quota (no row in group_nudges
 *      where sender_id=me AND nudge_date_local=today).
 *   3. Current user has ≥1 group membership (otherwise nothing to nudge).
 *
 * Visibility polls every 30s. Click → loads incomplete recipients via
 * `getIncompleteGroupMembersToday()` and opens <NudgeDialog>. If the list is
 * empty, show an inline celebratory message instead.
 */
export function NudgeButton() {
  const [hasCompletedToday, setHasCompletedToday] = useState(false)
  const [quotaUsed, setQuotaUsed] = useState(false)
  const [hasMembership, setHasMembership] = useState(false)
  const [senderName, setSenderName] = useState('')
  const [showDialog, setShowDialog] = useState(false)
  const [members, setMembers] = useState<Array<{ user_id: string; display_name: string; group_id: string }>>([])
  const [loadingMembers, setLoadingMembers] = useState(false)
  const [inlineMessage, setInlineMessage] = useState<string | null>(null)

  // ── Visibility refresh ────────────────────────────────────────────────────
  const refreshVisibility = useCallback(async () => {
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setHasCompletedToday(false)
        setQuotaUsed(false)
        setHasMembership(false)
        return
      }

      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
      const graceStart = new Date(Date.now() - 14 * 60 * 60 * 1000).toISOString()

      // Run all 4 reads in parallel — they're independent.
      const [sessionsResult, nudgesResult, membershipsResult, profileResult] = await Promise.all([
        supabase
          .from('reading_sessions')
          .select('id')
          .eq('user_id', user.id)
          .gte('created_at', graceStart)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('group_nudges')
          .select('id')
          .eq('sender_id', user.id)
          .eq('nudge_date_local', today)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('group_members')
          .select('group_id')
          .eq('user_id', user.id)
          .limit(1)
          .maybeSingle(),
        supabase
          .from('profiles')
          .select('display_name')
          .eq('id', user.id)
          .maybeSingle(),
      ])

      setHasCompletedToday(!!sessionsResult.data)
      setQuotaUsed(!!nudgesResult.data)
      setHasMembership(!!membershipsResult.data)

      // Sender name: profile.display_name, fallback to email-prefix, fallback to '組員'.
      const raw = profileResult.data?.display_name?.trim()
      if (raw) {
        setSenderName(raw.length <= 3 ? raw : raw.slice(0, 3))
      } else {
        setSenderName(user.email?.split('@')[0]?.slice(0, 3) || '組員')
      }
    } catch (err) {
      console.error('[NudgeButton] visibility refresh failed:', err)
    }
  }, [])

  useEffect(() => {
    refreshVisibility()
    const id = setInterval(refreshVisibility, 30_000)
    return () => clearInterval(id)
  }, [refreshVisibility])

  // ── Click handler ─────────────────────────────────────────────────────────
  const handleClick = async () => {
    setShowDialog(true)
    setInlineMessage(null)
    setMembers([])
    setLoadingMembers(true)
    try {
      const res = await getIncompleteGroupMembersToday()
      if (res.error) {
        console.error('[NudgeButton] getIncompleteGroupMembersToday:', res.error)
        setInlineMessage('⚠️ 載入失敗，請稍後再試')
        return
      }
      if (res.members.length === 0) {
        setInlineMessage('🎉 全部組員今日已完成！')
        return
      }
      setMembers(res.members)
    } catch (err) {
      console.error('[NudgeButton] unexpected:', err)
      setInlineMessage('⚠️ 載入失敗，請稍後再試')
    } finally {
      setLoadingMembers(false)
    }
  }

  const handleDialogClose = () => {
    setShowDialog(false)
    setMembers([])
    setInlineMessage(null)
    // Refresh visibility so quota flag updates immediately after send.
    refreshVisibility()
  }

  // ── Visibility gate ───────────────────────────────────────────────────────
  const visible = hasCompletedToday && !quotaUsed && hasMembership
  if (!visible) return null

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <button
        onClick={handleClick}
        aria-label="提醒組員"
        className="
          w-full flex items-center justify-center gap-2
          px-4 py-3
          bg-orange-500 hover:bg-orange-600 active:scale-[0.98]
          text-white font-extrabold text-base
          rounded-2xl shadow-lg
          transition-all
        "
      >
        <span className="text-xl">📣</span>
        <span>提醒組員</span>
      </button>

      {/* Inline empty-state — only when dialog is open AND 0 incomplete members */}
      {showDialog && inlineMessage && !loadingMembers && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4"
          onClick={handleDialogClose}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-2xl mb-2">{inlineMessage.startsWith('⚠️') ? '⚠️' : '🎉'}</p>
            <p className="text-base font-bold text-[var(--color-primary)]">{inlineMessage.replace(/^[⚠️🎉]\s*/, '')}</p>
            <button
              onClick={handleDialogClose}
              className="mt-4 w-full px-4 py-2 bg-[var(--color-primary)] text-white rounded-xl font-bold"
            >
              好
            </button>
          </div>
        </div>
      )}

      {/* Loading state */}
      {showDialog && loadingMembers && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full text-center">
            <p className="text-2xl mb-2">⏳</p>
            <p className="text-sm text-muted">載入組員中...</p>
          </div>
        </div>
      )}

      {/* Main dialog */}
      {showDialog && !inlineMessage && !loadingMembers && members.length > 0 && (
        <NudgeDialog
          members={members}
          senderName={senderName}
          onClose={handleDialogClose}
        />
      )}
    </>
  )
}