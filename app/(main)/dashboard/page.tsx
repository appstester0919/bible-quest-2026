'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { getBooksMeta, type BookMeta } from '@/lib/bible/lookup'
import { getRequiredDays, type Scope } from '@/lib/bible/scope'
import { generateReadingPlan } from '@/lib/bible/planGenerator'
import {
  getMyGroups,
  getPendingRequestsForMyAdminGroups,
  getMyPendingRequests,
  approveJoinRequest,
  rejectJoinRequest,
  cancelJoinRequest,
  createGroup,
  leaveGroup,
  deleteGroup,
  renameGroup,
  type GroupWithProgress,
  type PendingRequestInfo,
} from '@/lib/groupActions'

interface Profile {
  id: string
  email: string
  current_streak: number
  total_xp: number
  level: number
  completed_plans: number
}

interface Enrollment {
  id: string
  scope: 'nt' | 'ot' | 'nt_ot'
  chapters_per_day: number
  total_days: number
  status: string
  started_at?: string
  created_at?: string
  reading_order?: string | null
  // Issue #6: custom start position fields
  start_book_index?: number
  start_chapter?: number
  nt_start_book_index?: number
  ot_start_book_index?: number
}

interface ReadingSession {
  id: string
  chapter_ref: string
  date_local: string
}

interface GlobalStats {
  total_chapters_read: number
  active_readers: number
  total_plans_completed: number
}

function getHKTDate(): string {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
    .toISOString().split('T')[0]
}

function getScopeLabel(scope: string) {
  if (scope === 'nt') return '新約聖經'
  if (scope === 'ot') return '舊約聖經'
  return '新舊約聖經'
}

function getRateColor(rate: number): string {
  if (rate === 0) return '#9CA3AF'      // 灰色
  if (rate <= 0.25) return '#F59E0B'    // 橙黃
  if (rate <= 0.5) return '#84CC16'     // 淺綠
  if (rate <= 0.75) return '#22C55E'    // 深綠
  return '#10B981'                       // 亮綠
}

function getGreeting(): string {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早安'
  if (h < 18) return '午安'
  return '晚安'
}

// ─── Compute today's reading href from enrollment + books (client-only) ─────
// Uses shared generateReadingPlan() so dashboard's today link matches the
// actual plan schedule (especially for nt_ot with per-testament start
// books/chapters and parallel/nt_then_ot/ot_then_nt reading orders).
function computeTodayHref(enrollment: Enrollment | null, books: BookMeta[]): string {
  if (!enrollment || books.length === 0) return '#'
  const planMap = generateReadingPlan(enrollment, books, 730)
  const hkt = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
  const todayRefs = planMap.get(hkt) ?? []
  if (todayRefs.length === 0) return '#'
  const refsParam = encodeURIComponent(todayRefs.join(','))
  return `/read?today=1&refs=${refsParam}`
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<{ id?: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [sessions, setSessions] = useState<ReadingSession[]>([])
  const [globalStats, setGlobalStats] = useState<GlobalStats>({
    total_chapters_read: 0, active_readers: 0, total_plans_completed: 0,
  })
  const [books, setBooks] = useState<BookMeta[]>([])
  // Computed client-side only — avoids SSR hydration mismatch
  const [todayHref, setTodayHref] = useState('#')
  const [todayRefsCount, setTodayRefsCount] = useState(0)
  const [totalPlanDays, setTotalPlanDays] = useState(0)
  const [loading, setLoading] = useState(true)
  const [fetchErrors, setFetchErrors] = useState<string[]>([])
  // Group feature state
  const [myGroups, setMyGroups] = useState<GroupWithProgress[]>([])
  const [groupFontSize, setGroupFontSize] = useState<number>(14)
  const [pendingAdminRequests, setPendingAdminRequests] = useState<PendingRequestInfo[]>([])
  const [myPendingRequests, setMyPendingRequests] = useState<Array<{ id: string; group_id: string; group_name: string; created_at: string }>>([])
  const [renameFor, setRenameFor] = useState<{ id: string; name: string } | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [renaming, setRenaming] = useState(false)
  const [showCreateGroup, setShowCreateGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [creatingGroup, setCreatingGroup] = useState(false)
  const [showInviteFor, setShowInviteFor] = useState<{ id: string; code: string; name: string } | null>(null)
  const [pendingAction, setPendingAction] = useState<string | null>(null)
  useEffect(() => {
    const fetchData = async () => {
      try {
        const supabase = createClient()
        const { data: { user: authUser } } = await supabase.auth.getUser()
        if (!authUser) { router.push('/login'); return }
        setUser(authUser)

        const errors: string[] = []

        const { data: profileData, error: profileErr } = await supabase
          .from('profiles').select('*').eq('id', authUser.id).single()
        if (profileErr) errors.push(`profiles: ${profileErr.message}`)

        const { data: statsData, error: statsErr } = await supabase
          .from('user_stats')
          .select('current_streak, total_xp, level, completed_plans')
          .eq('user_id', authUser.id)
          .maybeSingle()
        console.log('[dashboard] user_stats query result:', JSON.stringify({ statsData, statsErr }))
        if (statsErr) errors.push(`user_stats: ${statsErr.message}`)

        if (profileData || statsData) {
          setProfile({ id: authUser.id, email: profileData?.email || authUser.email || '', ...profileData, ...statsData } as Profile)
        }

        console.log('[dashboard] merged profile:', JSON.stringify({
          id: authUser.id,
          current_streak: statsData?.current_streak,
          total_xp: statsData?.total_xp,
          level: statsData?.level,
          completed_plans: statsData?.completed_plans
        }))

        const { data: enrollmentsData, error } = await supabase
          .from('user_plan_enrollments')
          .select('id, scope, chapters_per_day, total_days, status, started_at, reading_order, start_book_index, start_chapter, nt_start_book_index, ot_start_book_index')
          .eq('user_id', authUser.id)
          .eq('status', 'active')
          .order('started_at', { ascending: false })
          .limit(1)
          .maybeSingle()
        if (error) errors.push(`enrollment: ${error.message}`)
        setEnrollment(error ? null : enrollmentsData)

        const { data: sessionsData, error: sessionsErr } = enrollmentsData
          ? await supabase.from('reading_sessions').select('id, chapter_ref, date_local').eq('enrollment_id', enrollmentsData.id)
          : { data: null, error: null }
        if (sessionsErr) errors.push(`sessions: ${sessionsErr.message}`)
        setSessions(sessionsData ?? [])

        // Use global_stats view for server-calculated values
        const { data: gsData } = await supabase.from('global_stats').select('*').single()
        if (gsData) {
          setGlobalStats({
            total_chapters_read: gsData.total_chapters_read ?? 0,
            active_readers: gsData.active_readers ?? 0,
            total_plans_completed: gsData.total_plans_completed ?? 0,
          })
        }

        // Load bible data for plan computation
        const res = await fetch('/bible-data.json')
        const bibleJson = await res.json()
        const booksMeta = getBooksMeta(bibleJson)
        setBooks(booksMeta)

        // Compute today's reading href from enrollment + books (all client-side, no SSR mismatch)
        const href = computeTodayHref(error ? null : enrollmentsData, booksMeta)
        setTodayHref(href)

        // Count today's refs for display
        if (!error && enrollmentsData && booksMeta.length > 0) {
          // Use shared plan generator so all views (dashboard / calendar / lesson card)
          // see the SAME chapter schedule — especially for nt_ot plans with
          // parallel / nt_then_ot / ot_then_nt reading orders.
          const planMap = generateReadingPlan(enrollmentsData, booksMeta, 400)
          const hkt = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
          setTodayRefsCount((planMap.get(hkt) ?? []).length)
          setTotalPlanDays(planMap.size)
        }

        if (errors.length > 0) {
          console.error('[dashboard fetch errors]', errors)
          setFetchErrors(errors)
        }
      } catch (err) {
        console.error('[dashboard fatal]', err)
        setFetchErrors([String(err)])
      } finally {
        setLoading(false)
      }
    }
    // Kick off fetchData AND refreshGroups in PARALLEL — no reason to wait for
    // user/profile/enrollment before loading group data (they are independent).
    fetchData()
    refreshGroups()
  }, [router])

  async function refreshGroups() {
    const [gRes, aRes, pRes] = await Promise.all([
      getMyGroups(),
      getPendingRequestsForMyAdminGroups(),
      getMyPendingRequests(),
    ])
    if (!gRes.error) setMyGroups(gRes.groups)
    setPendingAdminRequests(aRes)
    setMyPendingRequests(pRes)
  }

  async function handleCreateGroup() {
    const name = newGroupName.trim()
    if (!name) return
    setCreatingGroup(true)
    try {
      const res = await createGroup(name)
      if (res.success && res.groupId && res.inviteCode) {
        setShowInviteFor({ id: res.groupId, code: res.inviteCode, name })
        setShowCreateGroup(false)
        setNewGroupName('')
        await refreshGroups()
      } else {
        alert('建立失敗：' + (res.error || '未知錯誤'))
      }
    } finally {
      setCreatingGroup(false)
    }
  }

  async function handleApprove(reqId: string) {
    setPendingAction(reqId)
    try {
      const res = await approveJoinRequest(reqId)
      if (!res.success) alert('審批失敗：' + (res.error || ''))
      await refreshGroups()
    } finally {
      setPendingAction(null)
    }
  }

  async function handleReject(reqId: string) {
    setPendingAction(reqId)
    try {
      const res = await rejectJoinRequest(reqId)
      if (!res.success) alert('拒絕失敗：' + (res.error || ''))
      await refreshGroups()
    } finally {
      setPendingAction(null)
    }
  }

  async function handleCancelRequest(reqId: string) {
    if (!confirm('確定取消申請？')) return
    setPendingAction(reqId)
    try {
      const res = await cancelJoinRequest(reqId)
      if (!res.success) alert('取消失敗：' + (res.error || ''))
      await refreshGroups()
    } finally {
      setPendingAction(null)
    }
  }

  async function handleLeaveGroup(groupId: string, groupName: string) {
    if (!confirm(`確定離開「${groupName}」？`)) return
    const res = await leaveGroup(groupId)
    if (!res.success) {
      alert('退出失敗：' + (res.error || ''))
    } else {
      await refreshGroups()
    }
  }

  async function handleDeleteGroup(groupId: string, groupName: string) {
    if (!confirm(`⚠️ 確定刪除「${groupName}」？\n\n此操作無法復原。所有組員、check-in 記錄將一併刪除。`)) return
    if (!confirm(`再確認：刪除群組「${groupName}」？`)) return
    const res = await deleteGroup(groupId)
    if (!res.success) {
      alert('刪除失敗：' + (res.error || ''))
    } else {
      await refreshGroups()
    }
  }

  async function handleRenameSubmit() {
    if (!renameFor) return
    const trimmed = renameDraft.trim()
    if (!trimmed || trimmed.length > 30) {
      alert('群組名稱必須為 1-30 字')
      return
    }
    if (trimmed === renameFor.name) {
      setRenameFor(null)
      return
    }
    setRenaming(true)
    try {
      const res = await renameGroup(renameFor.id, trimmed)
      if (!res.success) {
        alert('更改失敗：' + (res.error || ''))
      } else {
        await refreshGroups()
        setRenameFor(null)
        setRenameDraft('')
      }
    } finally {
      setRenaming(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-muted">載入中...</div>
      </div>
    )
  }

  // XP needed for the CURRENT level cap is hard-coded; instead compute the
  // next-level threshold using the canonical formula:
  //   level N = floor(sqrt(total_xp / 100)) + 1
  //   total_xp_for_level(N) = (N-1)² × 100
  // So XP needed to reach the NEXT level = (level)² × 100
  const xpForNextLevel = profile ? profile.level * profile.level * 100 : 100
  const xpForCurrentLevel = profile ? (profile.level - 1) * (profile.level - 1) * 100 : 0
  const xpInCurrent = profile ? profile.total_xp - xpForCurrentLevel : 0
  const xpNeeded = xpForNextLevel - xpForCurrentLevel
  const hktToday = getHKTDate()
  const todayCompleted = sessions.some(s => s.date_local === hktToday)
  const totalDays = totalPlanDays > 0 ? totalPlanDays : (enrollment ? getRequiredDays(enrollment.scope as Scope, enrollment.chapters_per_day) : 0)
  const completedDays = new Set(sessions.map(s => s.date_local)).size
  const planProgress = totalDays > 0 ? Math.round((completedDays / totalDays) * 100) : 0
  const userInitial = (profile?.email || user?.email || '?').charAt(0).toUpperCase()

  return (
    <div className="min-h-screen bg-[var(--color-background)] pb-24">
      {/* Header */}
      <header className="bg-[var(--color-surface)] px-4 py-3 shadow-sm sticky top-0 z-10">
        <div className="max-w-sm mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-[var(--color-success)] text-white flex items-center justify-center font-extrabold text-lg">
              {userInitial}
            </div>
            <div>
              <p className="text-xs text-muted">{getGreeting()}！</p>
              <p className="text-sm font-extrabold text-[var(--color-primary)]">
                {profile?.email?.split('@')[0] ?? '讀經者'}
              </p>
            </div>
          </div>
          {profile && (
            <div className="xp-token">
              <span>⭐</span>
              <span>Lv.{profile.level}</span>
              <span className="text-xs opacity-70">{profile.total_xp} XP</span>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-sm mx-auto px-4 py-6 space-y-4">
        {/* Debug: fetch errors visible to user */}
        {fetchErrors.length > 0 && (
          <div className="bg-[var(--color-danger)]/10 border border-[var(--color-danger)]/30 rounded-2xl p-4">
            <p className="text-sm font-bold text-[var(--color-danger)] mb-2">
              ⚠️ 載入錯誤 ({fetchErrors.length})
            </p>
            <ul className="text-xs text-[var(--color-danger)]/90 space-y-1 font-mono">
              {fetchErrors.map((e, i) => <li key={i}>• {e}</li>)}
            </ul>
            <p className="text-xs text-[var(--color-muted)] mt-2">
              請重新登入或聯絡管理員
            </p>
          </div>
        )}

        {/* Streak Hero */}
        <div className="card-streak">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <span className="text-4xl animate-flame">🔥</span>
              <div>
                <p className="text-xs opacity-90 uppercase tracking-wider font-bold">連續學習</p>
                <p className="text-3xl font-extrabold leading-none mt-1">
                  {profile?.current_streak ?? 0}<span className="text-lg ml-1 opacity-90">日</span>
                </p>
              </div>
            </div>
            {profile && profile.completed_plans > 0 && (
              <div className="text-right">
                <p className="text-xs opacity-90">已完成計劃</p>
                <p className="text-2xl font-extrabold">🏆 {profile.completed_plans}</p>
              </div>
            )}
          </div>
        </div>

        {/* Today's Lesson Card — href computed entirely in useEffect, no SSR mismatch */}
        <a
          href={todayHref}
          className="card block hover:scale-[1.01] active:scale-[0.99] transition-transform"
          style={{
            background: todayCompleted
              ? 'linear-gradient(135deg, #D7FFB8 0%, #A8E66B 100%)'
              : 'linear-gradient(135deg, #58CC02 0%, #46A302 100%)',
            color: todayCompleted ? '#2D7A01' : '#FFFFFF',
          }}
        >
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-extrabold uppercase tracking-wider opacity-90">
                今日功課
              </p>
              <p className="text-xl font-extrabold mt-1">
                {todayCompleted ? '已完成今日讀經！' : '點擊開始今日讀經'}
              </p>
              {!todayCompleted && enrollment && todayRefsCount > 0 && (
                <p className="text-xs opacity-90 mt-1">
                  {getScopeLabel(enrollment.scope)} · {todayRefsCount}章
                  {enrollment.chapters_per_day > todayRefsCount ? ` · 目標${enrollment.chapters_per_day}章` : ''}
                </p>
              )}
            </div>
            <div className="text-5xl">{todayCompleted ? '✓' : '▶'}</div>
          </div>
        </a>

        {/* Plan Progress */}
        {enrollment && (
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="h-eyebrow">當前計劃</p>
                <p className="font-extrabold text-[var(--color-primary)] mt-1">
                  {getScopeLabel(enrollment.scope)}
                </p>
              </div>
              <span className="badge badge-success">{enrollment.chapters_per_day}章/日</span>
            </div>
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${planProgress}%` }} />
            </div>
            <div className="flex justify-between mt-2">
              <span className="text-xs text-muted">{completedDays} / {totalDays} 天</span>
              <span className="text-xs font-bold text-success">{planProgress}%</span>
            </div>
          </div>
        )}

        {/* XP / Level Progress */}
        {profile && (
          <div className="card-xp">
            <div className="flex items-center justify-between mb-2">
              <span className="font-extrabold">等級 {profile.level}</span>
              <span className="font-extrabold">{profile.total_xp} XP</span>
            </div>
            <div className="progress-track" style={{ backgroundColor: 'rgba(0,0,0,0.15)' }}>
              <div
                className="progress-fill"
                style={{ width: `${(xpInCurrent / xpNeeded) * 100}%`, background: '#1F2937' }}
              />
            </div>
            <p className="text-xs mt-2 opacity-80 text-right">
              {xpNeeded - xpInCurrent} XP 升級
            </p>
          </div>
        )}

        {/* Global Community Stats */}
        <div className="card-gem">
          <div className="flex items-center gap-2 mb-3">
            <span className="text-2xl">🌍</span>
            <p className="h-section" style={{ color: 'white' }}>社群統計</p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
            <div className="text-center">
              <p className="text-2xl font-extrabold">{globalStats.total_chapters_read.toLocaleString()}</p>
              <p className="text-xs opacity-80 mt-1">總章數</p>
            </div>
            <div className="text-center" style={{ borderLeft: '1px solid rgba(255,255,255,0.25)', borderRight: '1px solid rgba(255,255,255,0.25)' }}>
              <p className="text-2xl font-extrabold">{globalStats.active_readers}</p>
              <p className="text-xs opacity-80 mt-1">活躍讀者</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-extrabold">{globalStats.total_plans_completed}</p>
              <p className="text-xs opacity-80 mt-1">完成計劃</p>
            </div>
          </div>
        </div>

        {/* Groups */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="text-2xl">👥</span>
              <p className="h-section">讀經群組</p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setGroupFontSize(s => Math.max(12, s - 2))}
                title="縮小字體"
                className="w-7 h-7 rounded-full bg-gray-100 text-gray-700 font-bold text-xs flex items-center justify-center"
              >A−</button>
              <button
                onClick={() => setGroupFontSize(s => Math.min(24, s + 2))}
                title="放大字體"
                className="w-7 h-7 rounded-full bg-gray-100 text-gray-700 font-bold text-xs flex items-center justify-center"
              >A+</button>
              <button
                onClick={() => setShowCreateGroup(true)}
                className="text-xs px-3 py-1.5 bg-[var(--color-primary)] text-white rounded-full font-bold"
              >
                + 建立
              </button>
            </div>
          </div>

          {/* Admin pending requests */}
          {pendingAdminRequests.length > 0 && (
            <div className="mb-3 p-3 bg-amber-50 rounded-xl border border-amber-200">
              <p className="text-xs font-bold text-amber-800 mb-2">
                📥 等待審批 ({pendingAdminRequests.length})
              </p>
              <div className="space-y-2">
                {pendingAdminRequests.map((req) => (
                  <div key={req.request_id} className="flex items-center justify-between text-sm bg-white p-2 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <span className="font-bold">{req.display_name}</span>
                      <span className="text-xs text-muted"> 想加入 {req.group_name}</span>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => handleApprove(req.request_id)}
                        disabled={pendingAction === req.request_id}
                        className="px-2 py-1 bg-green-500 text-white text-xs rounded font-bold disabled:opacity-50"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => handleReject(req.request_id)}
                        disabled={pendingAction === req.request_id}
                        className="px-2 py-1 bg-red-500 text-white text-xs rounded font-bold disabled:opacity-50"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* My pending requests */}
          {myPendingRequests.length > 0 && (
            <div className="mb-3 p-3 bg-blue-50 rounded-xl border border-blue-200">
              <p className="text-xs font-bold text-blue-800 mb-2">
                ⏳ 等待審批中
              </p>
              <div className="space-y-2">
                {myPendingRequests.map((req) => (
                  <div key={req.id} className="flex items-center justify-between text-sm bg-white p-2 rounded-lg">
                    <span>
                      <span className="font-bold">{req.group_name}</span>
                      <span className="text-xs text-muted ml-2">等待組長批准</span>
                    </span>
                    <button
                      onClick={() => handleCancelRequest(req.id)}
                      disabled={pendingAction === req.id}
                      className="px-2 py-1 bg-gray-200 text-gray-700 text-xs rounded font-bold disabled:opacity-50"
                    >
                      取消
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* My groups list */}
          {myGroups.length === 0 ? (
            <p className="text-sm text-muted text-center py-4">
              尚未加入任何群組<br/>
              <span className="text-xs">點擊「+ 建立」或從邀請連結加入</span>
            </p>
          ) : (
            <div className="space-y-3">
              {myGroups.map((g) => (
                <div key={g.id} className="border border-gray-100 rounded-xl p-3" style={{ fontSize: groupFontSize }}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <p className="font-bold text-[var(--color-primary)] truncate">
                          {g.name} {g.my_role === 'admin' && <span className="text-xs ml-1">⭐</span>}
                        </p>
                        {g.my_role === 'admin' && (
                          <button
                            onClick={() => { setRenameFor({ id: g.id, name: g.name }); setRenameDraft(g.name) }}
                            className="text-xs px-1.5 py-0.5 text-gray-500 hover:text-[var(--color-primary)]"
                            title="更改群組名稱"
                          >
                            ✏️
                          </button>
                        )}
                      </div>
                      <p className="text-xs text-muted mt-0.5">
                        今日 <span className="font-bold text-[var(--color-primary)]">{g.today_count}</span>/{g.today_total}
                        {g.member_count < g.today_total && (
                          <span className="ml-1">· {g.member_count} 組員</span>
                        )}
                      </p>
                    </div>
                    <button
                      onClick={() => setShowInviteFor({ id: g.id, code: g.invite_code, name: g.name })}
                      className="text-xs px-2 py-1 bg-gray-100 text-gray-700 rounded-lg"
                      title="邀請連結"
                    >
                      🔗
                    </button>
                  </div>
                  {/* Last 5 days progress lights */}
                  <div className="flex gap-1.5 mb-2">
                    {g.last_5_days.map((d, i) => (
                      <div
                        key={i}
                        className="h-6 flex-1 rounded flex items-center justify-center text-[10px] font-bold text-white"
                        style={{ backgroundColor: getRateColor(d.rate) }}
                        title={`${d.date}: ${Math.round(d.rate * 100)}%`}
                      >
                        {Math.round(d.rate * 100)}%
                      </div>
                    ))}
                  </div>
                  {/* Today's completed names */}
                  {g.today_completed_names.length > 0 && (
                    <p className="text-xs text-muted">
                      <span className="font-bold text-[var(--color-success)]">✓</span> {g.today_completed_names.join('、')}
                    </p>
                  )}
                  {/* Leave / Delete group buttons */}
                  <div className="mt-2 flex justify-end gap-3 text-[10px]">
                    {g.my_role === 'admin' ? (
                      <button
                        onClick={() => handleDeleteGroup(g.id, g.name)}
                        className="text-red-600 underline font-bold"
                        title="刪除群組（包含所有組員及 check-in 記錄，無法復原）"
                      >
                        刪除群組
                      </button>
                    ) : (
                      <button
                        onClick={() => handleLeaveGroup(g.id, g.name)}
                        className="text-red-500 underline"
                      >
                        退出群組
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Join group via link */}
          <div className="mt-4 pt-3 border-t border-gray-100">
            <p className="text-xs text-muted mb-2 text-center">或從邀請連結加入：</p>
            <input
              type="text"
              placeholder="輸入邀請碼"
              id="group-code-input"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-center"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const v = e.currentTarget.value.trim()
                  if (v) router.push(`/join/${v}`)
                }
              }}
            />
          </div>
        </div>
      </main>

      {/* Rename Group Modal (admin only) */}
      {renameFor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-3">更改群組名稱</h3>
            <p className="text-xs text-muted mb-3">只有組長（⭐）可以更改群組名稱</p>
            <input
              type="text"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              placeholder="新群組名稱"
              maxLength={30}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base mb-4"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameSubmit()
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setRenameFor(null); setRenameDraft('') }}
                className="flex-1 px-4 py-2 bg-gray-100 rounded-lg font-medium"
              >
                取消
              </button>
              <button
                onClick={handleRenameSubmit}
                disabled={renaming || !renameDraft.trim()}
                className="flex-1 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-bold disabled:opacity-50"
              >
                {renaming ? '儲存中...' : '儲存'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Create Group Modal */}
      {showCreateGroup && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-3">建立新群組</h3>
            <p className="text-xs text-muted mb-3">為你和你的好友建立讀經群組</p>
            <input
              type="text"
              value={newGroupName}
              onChange={(e) => setNewGroupName(e.target.value)}
              placeholder="例如：主內小組"
              maxLength={30}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-base mb-4"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={() => { setShowCreateGroup(false); setNewGroupName('') }}
                className="flex-1 px-4 py-2 bg-gray-100 rounded-lg font-medium"
              >
                取消
              </button>
              <button
                onClick={handleCreateGroup}
                disabled={creatingGroup || !newGroupName.trim()}
                className="flex-1 px-4 py-2 bg-[var(--color-primary)] text-white rounded-lg font-bold disabled:opacity-50"
              >
                {creatingGroup ? '建立中...' : '建立'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invite Link Modal */}
      {showInviteFor && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-sm p-6">
            <h3 className="text-lg font-bold mb-3">邀請連結</h3>
            <p className="text-xs text-muted mb-3">
              分享以下連結給朋友，他們加入後你可以批准：
            </p>
            <div className="bg-gray-50 rounded-lg p-3 mb-3 break-all font-mono text-sm">
              {typeof window !== 'undefined' ? `${window.location.origin}/join/${showInviteFor.code}` : `/join/${showInviteFor.code}`}
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  const url = `${window.location.origin}/join/${showInviteFor.code}`
                  navigator.clipboard.writeText(url)
                  alert('已複製邀請連結')
                }}
                className="flex-1 px-4 py-2 bg-gray-100 rounded-lg font-medium"
              >
                複製
              </button>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`一起加入「${showInviteFor.name}」讀經群組：${typeof window !== 'undefined' ? window.location.origin : ''}/join/${showInviteFor.code}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 px-4 py-2 bg-green-500 text-white rounded-lg font-bold text-center"
              >
                WhatsApp
              </a>
            </div>
            <button
              onClick={() => setShowInviteFor(null)}
              className="w-full mt-2 px-4 py-2 text-muted"
            >
              關閉
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
