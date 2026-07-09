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

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<{ id?: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [sessions, setSessions] = useState<ReadingSession[]>([])
  const [globalStats, setGlobalStats] = useState<GlobalStats>({ total_chapters_read: 0, active_readers: 0, total_plans_completed: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) { router.push('/login'); return }
      setUser(authUser)

      const { data: profileData } = await supabase
        .from('profiles').select('*').eq('id', authUser.id).single()
      const { data: statsData } = await supabase
        .from('user_stats')
        .select('current_streak, total_xp, level, completed_plans')
        .eq('user_id', authUser.id)
        .single()
      setProfile({ ...profileData, ...statsData } as Profile)

      const { data: enrollmentData, error } = await supabase
        .from('user_plan_enrollments')
        .select('id, scope, chapters_per_day, total_days, status')
        .eq('user_id', authUser.id)
        .eq('status', 'active')
        .maybeSingle()
      if (error) console.error('Enrollment error:', error)
      setEnrollment(error ? null : enrollmentData)

      const { data: sessionsData } = enrollmentData
        ? await supabase.from('reading_sessions').select('id, chapter_ref, date_local').eq('enrollment_id', enrollmentData.id)
        : { data: null as ReadingSession[] | null }
      setSessions(sessionsData ?? [])

      // Fetch global stats (independent of user)
      const { data: global } = await supabase
        .from('global_stats')
        .select('total_chapters_read, active_readers, total_plans_completed')
        .maybeSingle()
      if (global) setGlobalStats(global as GlobalStats)

      setLoading(false)
    }
    fetchData()
  }, [router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-[var(--color-muted)]">載入中...</div>
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

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* Header */}
      <header className="bg-white px-4 py-3 flex items-center justify-between shadow-sm">
        <h1 className="text-xl font-extrabold text-[var(--color-primary)]">Bible Quest</h1>
        {profile && (
          <div className="flex items-center gap-1.5 bg-[var(--color-xp)]/10 px-2.5 py-1 rounded-full">
            <span className="text-sm font-extrabold text-[var(--color-xp)]">Lv.{profile.level}</span>
            <div className="w-16 h-1.5 bg-[var(--color-muted)]/20 rounded-full overflow-hidden">
              <div className="h-full bg-[var(--color-xp)] rounded-full transition-all" style={{ width: `${(xpInCurrent / xpNeeded) * 100}%` }} />
            </div>
          </div>
        )}
      </header>

      <main className="max-w-sm mx-auto px-4 py-6 space-y-4">
        {/* Welcome */}
        {profile && (
          <div className="text-center py-2">
            <p className="text-sm text-[var(--color-muted)]">加油！</p>
            <p className="text-lg font-bold text-[var(--color-primary)]">
              {profile.email}
            </p>
            {profile.completed_plans > 0 && (
              <p className="text-xs text-[var(--color-success)] font-bold mt-1">
                🏆 你已完成 {profile.completed_plans} 次聖經計劃
              </p>
            )}
          </div>
        )}

        {/* Streak */}
        <div className="bg-[var(--color-streak)] text-white rounded-2xl p-5 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🔥</span>
            <div>
              <p className="text-sm opacity-90">連續學習</p>
              <p className="text-3xl font-bold">
                {profile?.current_streak ?? 0}<span className="text-lg ml-1">日</span>
              </p>
            </div>
          </div>
        </div>

        {/* Today's Status Card */}
        <a href="/read" className="block bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <h2 className="text-lg font-bold text-[var(--color-primary)] mb-3">📖 今日功課</h2>
          {todayCompleted ? (
            <div className="flex items-center gap-2 text-[var(--color-success)]">
              <span className="text-2xl">✓</span>
              <span className="font-bold">已完成今日讀經！</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-[var(--color-xp)]">
              <span className="text-2xl">▶️</span>
              <span className="font-bold">點擊開始今日讀經</span>
            </div>
          )}
        </a>

        {/* XP Card */}
        {profile && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-bold text-[var(--color-primary)]">等級 {profile.level}</h2>
              <div className="flex items-center gap-1 text-[var(--color-xp)]">
                <span>⭐</span>
                <span className="font-bold">{profile.total_xp} XP</span>
              </div>
            </div>
            <div className="h-3 bg-[var(--color-muted)]/20 rounded-full overflow-hidden">
              <div className="h-full bg-[var(--color-xp)] rounded-full transition-all" style={{ width: `${(xpInCurrent / xpNeeded) * 100}%` }} />
            </div>
            <p className="text-xs text-[var(--color-muted)] mt-2 text-right">
              {xpNeeded - xpInCurrent} XP 到下一級
            </p>
          </div>
        )}

        {/* Plan Progress */}
        {enrollment && (
          <div className="bg-white rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-bold text-[var(--color-primary)]">{getScopeLabel(enrollment.scope)}</h2>
              <span className="text-sm text-[var(--color-muted)]">{enrollment.chapters_per_day}章/日</span>
            </div>
            <div className="h-3 bg-[var(--color-muted)]/20 rounded-full overflow-hidden mb-2">
              <div className="h-full bg-[#22c55e] rounded-full transition-all" style={{ width: `${planProgress}%` }} />
            </div>
            <p className="text-sm text-[var(--color-muted)] text-right">
              {completedDays}/{totalDays} 天完成
            </p>
          </div>
        )}

        {/* Global Community Stats */}
        <div className="bg-gradient-to-br from-[var(--color-primary)] to-[#374151] text-white rounded-2xl p-5 shadow-lg">
          <h2 className="text-lg font-bold mb-3 flex items-center gap-2">
            <span>🌍</span> 社群統計
          </h2>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-2xl font-bold">{globalStats.total_chapters_read.toLocaleString()}</p>
              <p className="text-xs opacity-80 mt-1">總共讀咗</p>
              <p className="text-xs opacity-80">章聖經</p>
            </div>
            <div className="border-l border-r border-white/20">
              <p className="text-2xl font-bold">{globalStats.active_readers}</p>
              <p className="text-xs opacity-80 mt-1">活躍讀者</p>
            </div>
            <div>
              <p className="text-2xl font-bold">{globalStats.total_plans_completed}</p>
              <p className="text-xs opacity-80 mt-1">完成計劃</p>
            </div>
          </div>
        </div>

        {/* Quick Links */}
        <div className="grid grid-cols-2 gap-3">
          <a href="/calendar" className="bg-white rounded-2xl p-4 shadow-sm text-center hover:shadow-md transition-shadow">
            <span className="text-2xl">📅</span>
            <p className="text-sm font-bold text-[var(--color-primary)] mt-1">讀經日曆</p>
          </a>
          <a href="/read" className="bg-white rounded-2xl p-4 shadow-sm text-center hover:shadow-md transition-shadow">
            <span className="text-2xl">📖</span>
            <p className="text-sm font-bold text-[var(--color-primary)] mt-1">開始讀經</p>
          </a>
        </div>

        {/* Partner */}
        <a href="/partner" className="block bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <h2 className="text-lg font-bold text-[var(--color-primary)] mb-1">👥 讀經夥伴</h2>
          <p className="text-sm text-[var(--color-muted)]">查看夥伴進度或邀請新朋友</p>
        </a>
      </main>
    </div>
  )
}
