'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

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

function getGreeting(): string {
  const hour = new Date().getHours()
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早安'
  if (hour < 18) return '午安'
  return '晚安'
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
  const [loading, setLoading] = useState(true)
  const [fetchErrors, setFetchErrors] = useState<string[]>([])

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
          .select('id, scope, chapters_per_day, total_days, status')
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

        const { data: global, error: globalErr } = await supabase
          .from('global_stats')
          .select('total_chapters_read, active_readers, total_plans_completed')
          .maybeSingle()
        if (globalErr) errors.push(`global_stats: ${globalErr.message}`)
        if (global) setGlobalStats(global as GlobalStats)

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
    fetchData()
  }, [router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-muted">載入中...</div>
      </div>
    )
  }

  const xpInCurrent = profile ? (profile.total_xp % 100) : 0
  const xpNeeded = 100
  const hktToday = getHKTDate()
  const todayCompleted = sessions.some(s => s.date_local === hktToday)
  const totalDays = enrollment?.total_days ?? 0
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

        {/* Today's Lesson Card */}
        <a
          href="/read"
          className="card block hover:scale-[1.01] active:scale-[0.99] transition-transform"
          style={{ background: todayCompleted
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
              {!todayCompleted && enrollment && (
                <p className="text-xs opacity-90 mt-1">
                  {getScopeLabel(enrollment.scope)} · {enrollment.chapters_per_day}章/日
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

        {/* Quick actions */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
          <a href="/calendar" className="card hover:scale-[1.02] active:scale-[0.98] transition-transform text-center">
            <span className="text-3xl">📅</span>
            <p className="font-extrabold text-[var(--color-primary)] mt-2">讀經日曆</p>
            <p className="text-xs text-muted mt-1">查看每日進度</p>
          </a>
          <a href="/read" className="card hover:scale-[1.02] active:scale-[0.98] transition-transform text-center">
            <span className="text-3xl">📖</span>
            <p className="font-extrabold text-[var(--color-primary)] mt-2">開始讀經</p>
            <p className="text-xs text-muted mt-1">聆聽今日經文</p>
          </a>
        </div>

        {/* Partner card */}
        <a href="/partner" className="card flex items-center gap-3 hover:scale-[1.01] active:scale-[0.99] transition-transform">
          <div className="w-12 h-12 rounded-full bg-[var(--color-gem)] text-white flex items-center justify-center text-2xl flex-shrink-0">
            👥
          </div>
          <div className="flex-1">
            <p className="font-extrabold text-[var(--color-primary)]">讀經夥伴</p>
            <p className="text-xs text-muted mt-0.5">查看夥伴進度或邀請朋友</p>
          </div>
          <span className="text-muted text-xl">›</span>
        </a>
      </main>
    </div>
  )
}