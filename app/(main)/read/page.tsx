'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { markLessonComplete } from '@/lib/actions'
import { useRouter } from 'next/navigation'
import { getChapter, getAudioUrl, getBooksMeta, type BookMeta } from '@/lib/bible/lookup'
import { AudioPlayer } from '@/components/AudioPlayer'
import { FontSizeControl } from '@/components/FontSizeControl'
import { celebrate } from '@/lib/confetti'

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
  created_at: string
}

interface ReadingSession {
  id: string
  enrollment_id: string
  chapter_ref: string
  date_local: string
}

interface TodayReading {
  book: BookMeta
  chapterStart: number
  preview: string
  verses: Array<[number, string]>
  audioUrl: string
}

function parseChapterRef(ref: string): { book: string; chapter: number } | null {
  const match = ref.match(/^(.+?)\s+(\d+)$/)
  if (!match) return null
  return { book: match[1], chapter: parseInt(match[2]) }
}

function nextChapterAfter(
  book: BookMeta,
  currentChapter: number,
  allBooks: BookMeta[]
): { book: BookMeta; chapter: number } | null {
  const idx = allBooks.findIndex(b => b.abbr === book.abbr)
  if (idx === -1) return null
  if (currentChapter < book.chapters) {
    return { book, chapter: currentChapter + 1 }
  }
  const next = allBooks[idx + 1]
  return next ? { book: next, chapter: 1 } : null
}

function getTodayReading(
  enrollment: Enrollment,
  sessions: ReadingSession[],
  books: BookMeta[]
): TodayReading | null {
  let scopeBooks = books
  if (enrollment.scope === 'nt') {
    scopeBooks = books.filter((_, i) => i >= 39)
  } else if (enrollment.scope === 'ot') {
    scopeBooks = books.filter((_, i) => i < 39)
  }

  let lastBook: BookMeta | null = null
  let lastChapter = 0
  const sorted = [...sessions].sort((a, b) => a.id.localeCompare(b.id))

  for (const session of sorted) {
    const parsed = parseChapterRef(session.chapter_ref)
    if (!parsed) continue
    const bookIdx = scopeBooks.findIndex(b => b.name === parsed.book || b.abbr === parsed.book)
    if (bookIdx === -1) continue
    const b = scopeBooks[bookIdx]
    const lastBookIdx = lastBook ? scopeBooks.indexOf(lastBook) : -1
    if (!lastBook || bookIdx > lastBookIdx) {
      lastBook = b
      lastChapter = parsed.chapter
    } else if (bookIdx === lastBookIdx && parsed.chapter > lastChapter) {
      lastChapter = parsed.chapter
    }
  }

  let target: { book: BookMeta; chapter: number }
  if (!lastBook) {
    target = { book: scopeBooks[0], chapter: 1 }
  } else {
    const next = nextChapterAfter(lastBook, lastChapter, scopeBooks)
    if (!next) return null
    target = next
  }

  return {
    book: target.book,
    chapterStart: target.chapter,
    preview: '',
    verses: [],
    audioUrl: getAudioUrl(target.book.abbr, target.chapter),
  }
}

export default function ReadPage() {
  const router = useRouter()
  const [user, setUser] = useState<{ id?: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [sessions, setSessions] = useState<ReadingSession[]>([])
  const [todaySession, setTodaySession] = useState<ReadingSession | null>(null)
  const [todayReading, setTodayReading] = useState<TodayReading | null>(null)
  const [loading, setLoading] = useState(true)
  const [isCompleting, setIsCompleting] = useState(false)
  const [fontSize, setFontSize] = useState(20)

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
        .select('current_streak, total_xp, level')
        .eq('user_id', authUser.id)
        .single()

      setProfile({ ...profileData, ...statsData } as Profile)

      const { data: enrollmentData, error: enrollmentError } = await supabase
        .from('user_plan_enrollments')
        .select('*')
        .eq('user_id', authUser.id)
        .eq('status', 'active')
        .maybeSingle()

      if (enrollmentError) console.error('Enrollment query failed:', enrollmentError)
      setEnrollment(enrollmentError ? null : enrollmentData)

      const { data: sessionsData } = enrollmentData
        ? await supabase.from('reading_sessions').select('*').eq('enrollment_id', enrollmentData.id)
        : { data: null as ReadingSession[] | null }
      setSessions(sessionsData ?? [])

      const now = new Date()
      const hktDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
      const dateLocal = hktDate.toISOString().split('T')[0]

      const todaySess = sessionsData?.find((s: ReadingSession) => s.date_local === dateLocal) ?? null
      setTodaySession(todaySess)

      const res = await fetch('/bible-data.json')
      const bibleJson = await res.json()
      const books = getBooksMeta(bibleJson)

      if (enrollmentData && sessionsData !== null) {
        const reading = getTodayReading(enrollmentData, sessionsData, books)
        setTodayReading(reading)
      }

      setLoading(false)
    }

    fetchData()
  }, [router])

  useEffect(() => {
    if (!todayReading) return
    const loadVerses = async () => {
      try {
        const verses = await getChapter(todayReading.book.abbr, todayReading.chapterStart)
        setTodayReading(prev => prev ? { ...prev, verses, preview: verses[0]?.[1] ?? '' } : null)
      } catch (e) {
        console.error('Failed to load verses', e)
      }
    }
    loadVerses()
  }, [todayReading?.book.abbr, todayReading?.chapterStart])

  useEffect(() => {
    const saved = localStorage.getItem('bq_font_size')
    if (saved) setFontSize(Number(saved))
  }, [])

  const handleComplete = async () => {
    if (!enrollment || !todayReading || !profile) return
    setIsCompleting(true)
    try {
      const xpEarned = 10
      await markLessonComplete(
        enrollment.id,
        `${todayReading.book.name} ${todayReading.chapterStart}`,
        xpEarned
      )

      celebrate({ type: 'burst', particleCount: 120 })

      const now = new Date()
      const hktDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
      const dateLocal = hktDate.toISOString().split('T')[0]
      setTodaySession({
        id: 'new',
        enrollment_id: enrollment.id,
        chapter_ref: `${todayReading.book.name} ${todayReading.chapterStart}`,
        date_local: dateLocal,
      })

      if (profile) {
        const newXp = (profile.total_xp ?? 0) + xpEarned
        const newLevel = Math.floor(Math.sqrt(newXp / 100)) + 1
        setProfile({ ...profile, total_xp: newXp, level: newLevel })
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

  const xpForNext = profile ? (profile.level * profile.level * 100) : 100
  const xpInCurrent = profile ? (profile.total_xp % 100) : 0
  const xpNeeded = 100

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* Header */}
      <header className="bg-white px-4 py-3 flex items-center justify-between shadow-sm">
        <h1 className="text-xl font-extrabold text-[var(--color-primary)]">📖 讀經</h1>
        <div className="flex items-center gap-3">
          {profile && (
            <div className="flex items-center gap-1.5 bg-[var(--color-xp)]/10 px-2.5 py-1 rounded-full">
              <span className="text-sm font-extrabold text-[var(--color-xp)]">Lv.{profile.level}</span>
              <div className="w-16 h-1.5 bg-[var(--color-muted)]/20 rounded-full overflow-hidden">
                <div className="h-full bg-[var(--color-xp)] rounded-full transition-all" style={{ width: `${(xpInCurrent / xpNeeded) * 100}%` }} />
              </div>
            </div>
          )}
          <FontSizeControl
            value={fontSize}
            onChange={(size) => { setFontSize(size); localStorage.setItem('bq_font_size', String(size)) }}
          />
        </div>
      </header>

      <main className="max-w-sm mx-auto px-4 py-6 space-y-4">
        {/* Streak */}
        <div className="bg-[var(--color-streak)] text-white rounded-2xl p-5 shadow-lg">
          <div className="flex items-center gap-3">
            <span className="text-3xl">🔥</span>
            <div>
              <p className="text-sm opacity-90">連續學習</p>
              <p className="text-3xl font-bold">{profile?.current_streak ?? 0}<span className="text-lg ml-1">日</span></p>
            </div>
          </div>
        </div>

        {/* Reading Card */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--color-primary)] mb-1">今日功課</h2>
          {enrollment && (
            <p className="text-xs text-[var(--color-muted)] mb-3">
              {enrollment.scope === 'nt' ? '新約' : enrollment.scope === 'ot' ? '舊約' : '新舊約'}
              {' · '}{enrollment.chapters_per_day}章/日
            </p>
          )}

          {todayReading ? (
            <>
              <p className="text-3xl font-extrabold text-[var(--color-primary)] mb-1">
                {todayReading.book.name} {todayReading.chapterStart}
              </p>
              <p className="text-sm text-[var(--color-muted)] mb-4">
                {todayReading.book.abbr}{todayReading.chapterStart}.mp3
              </p>

              {/* Audio */}
              <div className="mb-4">
                <AudioPlayer src={todayReading.audioUrl} onEnded={() => {}} />
              </div>

              {/* Scripture */}
              {todayReading.verses.length > 0 ? (
                <div className="mb-4 scripture-text" style={{ fontSize: `${fontSize}px` }}>
                  {todayReading.verses.slice(0, 5).map(([num, text]) => (
                    <p key={num} className="leading-[1.8]">
                      <span className="text-[var(--color-xp)] font-bold mr-2 align-text-top" style={{ fontSize: '0.875rem' }}>{num}</span>
                      {text}
                    </p>
                  ))}
                  {todayReading.verses.length > 5 && (
                    <p className="text-xs text-[var(--color-muted)] mt-2">... 共 {todayReading.verses.length} 節</p>
                  )}
                </div>
              ) : (
                <p className="text-[var(--color-muted)] text-sm mb-4">載入經文...</p>
              )}

              {/* Complete Button */}
              <button
                onClick={handleComplete}
                disabled={!!todaySession || isCompleting}
                className={`w-full py-4 px-4 rounded-2xl font-extrabold text-white text-lg transition-all shadow-sm ${
                  todaySession
                    ? 'bg-[var(--color-success)] cursor-default'
                    : 'bg-[var(--color-success)] hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50'
                }`}
              >
                {todaySession ? '✓ 已完成讀經' : isCompleting ? '處理中...' : '完成讀經 ✓'}
              </button>
            </>
          ) : (
            <div className="text-center py-8">
              <p className="text-4xl mb-3">🎉</p>
              <p className="text-xl font-bold text-[var(--color-success)]">恭喜！</p>
              <p className="text-[var(--color-muted)] mt-1">你已完成全部閱讀計劃！</p>
            </div>
          )}
        </div>

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
      </main>
    </div>
  )
}
