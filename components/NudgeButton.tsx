'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getIncompleteGroupMembersToday } from '@/lib/groupActions'
import { NudgeDialog } from './NudgeDialog'

/**
 * Visibility poll interval. The three flags below (completedToday / quotaUsed /
 * hasMembership) each change at most once or twice per calendar day, so a
 * minutes-long poll is plenty. Freshness when the user actually *looks* at the
 * page is handled by the focus / visibilitychange listeners instead.
 */
const POLL_INTERVAL_MS = 180_000

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
 * Visibility polls every 3 min, and immediately on window focus /
 * tab visibilitychange. Click → loads incomplete recipients via
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
  // In-flight guard: timer / focus ticks skip while a run is active instead of
  // stacking concurrent query batches. `pendingRef` re-runs once at the end so a
  // state change landing mid-run is never dropped.
  const inFlightRef = useRef(false)
  const pendingRef = useRef(false)

  // Plain function, deliberately not useCallback: it self-references (the
  // `pendingRef` re-run in the finally block) and React Compiler rejects manual
  // memoization it cannot preserve.
  //
  // The effect below must therefore NOT list it as a dependency. A plain
  // function has a fresh identity on every render, so `[refreshVisibility]`
  // would tear down and re-attach the interval + both listeners on every
  // render — reintroducing exactly the churn the poll reduction removed. The
  // function only touches refs and setState (both stable), so mounting the
  // effect once is correct. `eslint-disable-next-line` documents the intent.
  async function refreshVisibility() {
    if (inFlightRef.current) {
      pendingRef.current = true
      return
    }
    inFlightRef.current = true
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setHasCompletedToday(false)
        setQuotaUsed(false)
        setHasMembership(false)
        return
      }

      // Check if user completed today's reading using HKT date_local.
      // Uses date_local (not created_at) to match markDayCompleteBatch's insert
      // date, which is the HKT calendar day — timezone-safe, no grace window
      // edge cases.
      // ── Parallel reads for: today's reading, quota, membership, profile ──────────
      const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
      const [
        { data: todaySession },
        { data: nudgeRow },
        { data: memberRow },
        { data: profile },
      ] = await Promise.all([
        supabase.from('reading_sessions').select('id').eq('user_id', user.id).eq('date_local', today).limit(1).maybeSingle(),
        supabase.from('group_nudges').select('id').eq('sender_id', user.id).eq('nudge_date_local', today).limit(1).maybeSingle(),
        supabase.from('group_members').select('group_id').eq('user_id', user.id).limit(1).maybeSingle(),
        supabase.from('profiles').select('display_name').eq('id', user.id).maybeSingle(),
      ])

      setHasCompletedToday(!!todaySession)
      setQuotaUsed(!!nudgeRow)
      setHasMembership(!!memberRow)

      // Sender name: profile.display_name, fallback to email-prefix, fallback to '組員'.
      const raw = profile?.display_name?.trim()
      if (raw) {
        setSenderName(raw.length <= 3 ? raw : raw.slice(0, 3))
      } else {
        setSenderName(user.email?.split('@')[0]?.slice(0, 3) || '組員')
      }
    } catch (err) {
      console.error('[NudgeButton] visibility refresh failed:', err)
    } finally {
      inFlightRef.current = false
      // Re-run once if a tick arrived while this run was in flight.
      if (pendingRef.current) {
        pendingRef.current = false
        void refreshVisibility()
      }
    }
  }

  useEffect(() => {
    void refreshVisibility()
    const id = setInterval(() => { void refreshVisibility() }, POLL_INTERVAL_MS)
    const onFocus = () => { void refreshVisibility() }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refreshVisibility()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearInterval(id)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
    // Intentionally empty: refreshVisibility is a plain function (new identity
    // every render). Including it would re-run this effect on every render and
    // re-attach the interval + both listeners each time. It closes over only
    // refs and setState setters, both of which are stable, so a once-only mount
    // is correct. See the note on the function above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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