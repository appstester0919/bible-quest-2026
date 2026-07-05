'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { markLessonComplete } from './actions'
import { useRouter } from 'next/navigation'

interface Profile {
  id: string
  email: string
  current_streak: number
  total_xp: number
  level: number
  onboarding_done: boolean
}

interface Enrollment {
  id: string
  user_id: string
  scope: 'nt' | 'ot' | 'nt_ot'
  reading_order: string | null
  total_days: number
  chapters_per_day: number
  status: string
}

interface ReadingSession {
  id: string
  enrollment_id: string
  chapter_ref: string
  date_local: string
}

interface TodayReading {
  book: string
  chapterStart: number
  chapterEnd: number
  preview: string
}

const SCOPE_BOOKS = {
  nt: ['馬太福音', '馬可福音', '路加福音', '約翰福音', '使徒行傳', '羅馬書', '哥林多前書', '哥林多後書', '加拉太書', '以弗所書', '腓立比書', '歌羅西書', '帖撒羅尼迦前書', '帖撒羅尼迦後書', '提摩太前書', '提摩太後書', '提多書', '腓利門書', '希伯來書', '雅各書', '彼得前書', '彼得後書', '約翰一書', '約翰二書', '約翰三書', '猶大書', '啟示錄'],
  ot: ['創世記', '出埃及記', '利未記', '民數記', '申命記', '約書亞記', '士師記', '路得記', '撒母耳記上', '撒母耳記下', '列王紀上', '列王紀下', '歷代志上', '歷代志下', '以斯拉記', '尼希米記', '以斯帖記', '約伯記', '詩篇', '箴言', '傳道書', '雅歌', '以賽亞書', '耶利米書', '耶利米哀歌', '以西結書', '但以理書', '何西阿書', '約珥書', '阿摩司書', '俄巴底亞書', '約拿書', '彌迦書', '那鴻書', '哈巴谷書', '西番雅書', '哈該書', '撒迦利亞書', '瑪拉基書'],
  nt_ot: ['創世記', '出埃及記', '利未記', '民數記', '申命記', '約書亞記', '士師記', '路得記', '撒母耳記上', '撒母耳記下', '列王紀上', '列王紀下', '歷代志上', '歷代志下', '以斯拉記', '尼希米記', '以斯帖記', '約伯記', '詩篇', '箴言', '傳道書', '雅歌', '以賽亞書', '耶利米書', '耶利米哀歌', '以西結書', '但以理書', '何西阿書', '約珥書', '阿摩司書', '俄巴底亞書', '約拿書', '彌迦書', '那鴻書', '哈巴谷書', '西番雅書', '哈該書', '撒迦利亞書', '瑪拉基書', '馬太福音', '馬可福音', '路加福音', '約翰福音', '使徒行傳', '羅馬書', '哥林多前書', '哥林多後書', '加拉太書', '以弗所書', '腓立比書', '歌羅西書', '帖撒羅尼迦前書', '帖撒羅尼迦後書', '提摩太前書', '提摩太後書', '提多書', '腓利門書', '希伯來書', '雅各書', '彼得前書', '彼得後書', '約翰一書', '約翰二書', '約翰三書', '猶大書', '啟示錄'],
}

function getTodayReading(scope: string, chaptersPerDay: number, dayIndex: number): TodayReading {
  const books = SCOPE_BOOKS[scope as keyof typeof SCOPE_BOOKS] || SCOPE_BOOKS.nt
  const bookIndex = Math.floor(dayIndex / chaptersPerDay) % books.length
  const book = books[bookIndex]
  
  // Simplified chapter calculation - in real app would track actual chapters per book
  const chapterStart = 1
  const chapterEnd = Math.min(chaptersPerDay, 7) // max 7 chapters preview
  
  const preview = `「起初　神創造天地。地是空虛混沌，淵面黑暗；　神的靈運行在水面上。神說：要有光，就有了光。」`
  
  return { book, chapterStart, chapterEnd, preview }
}

function getXpForLevel(level: number): number {
  return level * 100
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<{ id?: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [todaySession, setTodaySession] = useState<ReadingSession | null>(null)
  const [todayReading, setTodayReading] = useState<TodayReading | null>(null)
  const [loading, setLoading] = useState(true)
  const [isCompleting, setIsCompleting] = useState(false)

  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      const { data: { user: authUser } } = await supabase.auth.getUser()
      
      if (!authUser) {
        router.push('/login')
        return
      }
      
      setUser(authUser)
      
      // Fetch profile
      const { data: profileData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authUser.id)
        .single()
      
      // Fetch user_stats
      const { data: statsData } = await supabase
        .from('user_stats')
        .select('current_streak, longest_streak, total_xp, level, last_completed_date')
        .eq('user_id', authUser.id)
        .single()
      
      // Merge stats into profile for the UI
      setProfile({ ...profileData, ...statsData } as Profile)
      
      // Fetch active enrollment
      const { data: enrollmentData } = await supabase
        .from('user_plan_enrollments')
        .select('*')
        .eq('user_id', authUser.id)
        .eq('status', 'active')
        .single()
      
      setEnrollment(enrollmentData)
      
      // Fetch today's reading session
      const now = new Date()
      const hktDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
      const dateLocal = hktDate.toISOString().split('T')[0]
      
      const { data: sessionData } = await supabase
        .from('reading_sessions')
        .select('*')
        .eq('user_id', authUser.id)
        .eq('date_local', dateLocal)
        .single()
      
      setTodaySession(sessionData)
      
      // Calculate today's reading
      if (enrollmentData) {
        const dayIndex = Math.floor(
          (new Date(dateLocal).getTime() - new Date(enrollmentData.created_at).getTime()) 
          / (1000 * 60 * 60 * 24)
        )
        setTodayReading(getTodayReading(enrollmentData.scope, enrollmentData.chapters_per_day, dayIndex))
      }
      
      setLoading(false)
    }
    
    fetchData()
  }, [router])

  const handleComplete = async () => {
    if (!enrollment || !todayReading || !profile) return
    
    setIsCompleting(true)
    try {
      const xpEarned = 10 // Base XP for completing a lesson
      await markLessonComplete(
        enrollment.id,
        `${todayReading.book} ${todayReading.chapterStart}-${todayReading.chapterEnd}`,
        xpEarned
      )
      
      // Update local state
      setTodaySession({
        id: 'new',
        enrollment_id: enrollment.id,
        chapter_ref: `${todayReading.book} ${todayReading.chapterStart}-${todayReading.chapterEnd}`,
        date_local: new Date().toISOString().split('T')[0],
      })
      
      // Update profile XP
      if (profile) {
        setProfile({
          ...profile,
          total_xp: profile.total_xp + xpEarned,
        })
      }
    } catch (error) {
      console.error('Error completing lesson:', error)
    } finally {
      setIsCompleting(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[var(--color-background)]">
        <div className="text-[var(--color-muted)]">載入中...</div>
      </div>
    )
  }

  const xpForNextLevel = profile ? getXpForLevel(profile.level + 1) : 100
  const xpProgress = profile ? (profile.total_xp % xpForNextLevel) / xpForNextLevel * 100 : 0

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* Top Bar */}
      <header className="bg-white px-4 py-3 flex items-center justify-between shadow-sm">
        <h1 className="text-xl font-bold text-[var(--color-primary)]">Bible Quest</h1>
        <button 
          className="p-2 text-[var(--color-muted)] hover:text-[var(--color-primary)] transition-colors"
          aria-label="Notifications"
        >
          🔔
        </button>
      </header>

      <main className="max-w-sm mx-auto px-4 py-6 space-y-4">
        {/* Streak Card */}
        <div 
          className="bg-[var(--color-streak)] text-white rounded-2xl p-5 shadow-lg"
          role="region"
          aria-label="連續天數"
        >
          <div className="flex items-center gap-3">
            <span className="text-3xl">🔥</span>
            <div>
              <p className="text-sm opacity-90">連續學習</p>
              <p className="text-3xl font-bold">
                {profile?.current_streak ?? 0}
                <span className="text-lg ml-1">日</span>
              </p>
            </div>
          </div>
        </div>

        {/* Today's Lesson Card */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--color-primary)] mb-3">
            今日功課
          </h2>
          {todayReading ? (
            <>
              <div className="mb-3">
                <p className="text-2xl font-bold text-[var(--color-primary)]">
                  {todayReading.book} {todayReading.chapterStart}-{todayReading.chapterEnd}
                </p>
              </div>
              <p className="text-[var(--color-muted)] text-sm mb-4 leading-relaxed">
                {todayReading.preview}
              </p>
              <button
                onClick={handleComplete}
                disabled={!!todaySession || isCompleting}
                className={`w-full py-3 px-4 rounded-xl font-bold text-white transition-all ${
                  todaySession
                    ? 'bg-[var(--color-success)] cursor-default'
                    : 'bg-[var(--color-success)] hover:shadow-lg disabled:opacity-50'
                }`}
              >
                {todaySession ? '✓ 已完成讀經' : isCompleting ? '處理中...' : '完成讀經 ✓'}
              </button>
            </>
          ) : (
            <p className="text-[var(--color-muted)]">暫無今日功課</p>
          )}
        </div>

        {/* XP/Level Card */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-[var(--color-primary)]">
              等級 {profile?.level ?? 1}
            </h2>
            <div className="flex items-center gap-1 text-[var(--color-xp)]">
              <span>⭐</span>
              <span className="font-bold">{profile?.total_xp ?? 0} XP</span>
            </div>
          </div>
          <div className="h-3 bg-[var(--color-muted)]/20 rounded-full overflow-hidden">
            <div 
              className="h-full bg-[var(--color-xp)] rounded-full transition-all duration-500"
              style={{ width: `${xpProgress}%` }}
            />
          </div>
          <p className="text-xs text-[var(--color-muted)] mt-2 text-right">
            {profile ? xpForNextLevel - (profile.total_xp % xpForNextLevel) : xpForNextLevel} XP 到下一級
          </p>
        </div>

        {/* Partner Card (placeholder) */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--color-primary)] mb-3">
            👥 讀經夥伴
          </h2>
          <p className="text-[var(--color-muted)] text-sm">
            還沒有配對夥伴。邀請朋友一起讀經！
          </p>
        </div>
      </main>
    </div>
  )
}
