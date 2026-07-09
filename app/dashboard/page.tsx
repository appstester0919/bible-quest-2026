'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { markLessonComplete } from './actions'
import { useRouter } from 'next/navigation'
import { getChapter, getAudioUrl, type BookMeta } from '@/lib/bible/lookup'
import { AudioPlayer } from '@/components/AudioPlayer'
import { FontSizeControl } from '@/components/FontSizeControl'
import { getFontSize } from '@/lib/user-prefs'
import { getXpForLevel, getXpProgress } from '@/lib/xp'

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
  preview: string       // first verse text
  verses: Array<[number, string]> // [verseNum, text]
  audioUrl: string
}

function parseChapterRef(ref: string): { book: string; chapter: number } | null {
  // e.g. "創世記 1" -> { book: "創", chapter: 1 }
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
  // Move to next book
  const next = allBooks[idx + 1]
  return next ? { book: next, chapter: 1 } : null
}

function getTodayReading(
  enrollment: Enrollment,
  sessions: ReadingSession[],
  books: BookMeta[]
): TodayReading | null {
  // Build ordered book list for this scope
  let scopeBooks = books
  if (enrollment.scope === 'nt') {
    scopeBooks = books.filter(b => {
      const o = books.indexOf(b)
      return o >= 39 // Matthew onwards (0-indexed)
    })
  } else if (enrollment.scope === 'ot') {
    scopeBooks = books.filter((_, i) => i < 39)
  }
  // else nt_ot = all books in canonical order

  // Find last completed chapter
  let lastBook: BookMeta | null = null
  let lastChapter = 0

  // Sort sessions by created_at to get chronological order
  const sorted = [...sessions].sort((a, b) => a.id.localeCompare(b.id))

  for (const session of sorted) {
    const parsed = parseChapterRef(session.chapter_ref)
    if (!parsed) continue
    const bookIdx = scopeBooks.findIndex(b => b.name === parsed.book || b.abbr === parsed.book)
    if (bookIdx === -1) {
      // Try by full name
      const fullMatch = books.find(b => b.name === parsed.book)
      if (fullMatch) {
        const fullIdx = books.indexOf(fullMatch)
        const lastBookIdx2 = lastBook ? books.indexOf(lastBook) : -1
        if (fullIdx > lastBookIdx2) {
          lastBook = fullMatch
          lastChapter = parsed.chapter
        } else if (fullIdx === lastBookIdx2 && parsed.chapter > lastChapter) {
          lastChapter = parsed.chapter
        }
      }
      continue
    }
    const b = scopeBooks[bookIdx]
    const lastBookIdx = lastBook ? scopeBooks.indexOf(lastBook) : -1
    if (!lastBook || bookIdx > lastBookIdx) {
      lastBook = b
      lastChapter = parsed.chapter
    } else if (bookIdx === lastBookIdx && parsed.chapter > lastChapter) {
      lastChapter = parsed.chapter
    }
  }

  // Determine today's reading
  let target: { book: BookMeta; chapter: number }
  if (!lastBook) {
    // First reading — start at beginning of scope
    target = { book: scopeBooks[0], chapter: 1 }
  } else {
    const next = nextChapterAfter(lastBook, lastChapter, scopeBooks)
    if (!next) return null // Completed all
    target = next
  }

  // Placeholder preview (actual verses loaded async)
  return {
    book: target.book,
    chapterStart: target.chapter,
    preview: '',
    verses: [],
    audioUrl: getAudioUrl(target.book.abbr, target.chapter),
  }
}

export default function DashboardPage() {
  const router = useRouter()
  const [user, setUser] = useState<{ id?: string; email?: string } | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [levelUp, setLevelUp] = useState<number | null>(null) // null = no animation
  const [showConfetti, setShowConfetti] = useState(false)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [todaySession, setTodaySession] = useState<ReadingSession | null>(null)
  const [todayReading, setTodayReading] = useState<TodayReading | null>(null)
  const [loading, setLoading] = useState(true)
  const [isCompleting, setIsCompleting] = useState(false)
  const [books, setBooks] = useState<BookMeta[]>([])
  const [fontSize, setFontSize] = useState(20)

  useEffect(() => {
    // Register service worker
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {})
    }

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

      setProfile({ ...profileData, ...statsData } as Profile)

      // Fetch active enrollment
      const { data: enrollmentData } = await supabase
        .from('user_plan_enrollments')
        .select('*')
        .eq('user_id', authUser.id)
        .eq('status', 'active')
        .single()

      setEnrollment(enrollmentData)

      // Fetch all reading sessions for this enrollment
      const { data: sessionsData } = enrollmentData
        ? await supabase
            .from('reading_sessions')
            .select('*')
            .eq('enrollment_id', enrollmentData.id)
            .order('created_at', { ascending: true })
        : { data: null }

      // Fetch today's session
      const now = new Date()
      const hktDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
      const dateLocal = hktDate.toISOString().split('T')[0]

      const todaySess = sessionsData
        ? sessionsData.find((s: ReadingSession) => s.date_local === dateLocal) ?? null
        : null
      setTodaySession(todaySess)

      // Load bible data
      const res = await fetch('/bible-data.json')
      const bibleJson = await res.json()
      setBooks(bibleJson.books)

      // Compute today's reading
      if (enrollmentData && sessionsData) {
        const reading = getTodayReading(enrollmentData, sessionsData, bibleJson.books)
        setTodayReading(reading)
      }

      setLoading(false)
    }

    fetchData()
  }, [router])

  // Load verses when today's reading changes
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayReading?.book.abbr, todayReading?.chapterStart])

  // Load font size preference on mount
  useEffect(() => {
    setFontSize(getFontSize())
  }, [])

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
  }

  const handleComplete = async () => {
    if (!enrollment || !todayReading || !profile) return

    setIsCompleting(true)
    try {
      const xpEarned = 10
      const oldLevel = profile?.level ?? 1
      await markLessonComplete(
        enrollment.id,
        `${todayReading.book.name} ${todayReading.chapterStart}`,
        xpEarned
      )

      const now = new Date()
      const newXp = (profile?.total_xp ?? 0) + xpEarned
      // Compute new level: same formula as DB trigger
      const newLevel = Math.floor(Math.sqrt(newXp / 100)) + 1

      // Fire confetti + optional level-up
      setShowConfetti(true)
      setTimeout(() => setShowConfetti(false), 3000)
      if (newLevel > oldLevel) {
        setLevelUp(newLevel)
        setTimeout(() => setLevelUp(null), 3000)
      }

      const hktDate = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
      const dateLocal = hktDate.toISOString().split('T')[0]
      setTodaySession({
        id: 'new',
        enrollment_id: enrollment.id,
        chapter_ref: `${todayReading.book.name} ${todayReading.chapterStart}`,
        date_local: dateLocal,
      })

      if (profile) {
        setProfile({
          ...profile,
          total_xp: newXp,
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
  const xpProgress = profile ? getXpProgress(profile.total_xp, profile.level) : 0

  return (
    <div className="min-h-screen bg-[var(--color-background)]">
      {/* Top Bar */}
      <header className="bg-white px-4 py-3 flex items-center justify-between shadow-sm">
        <h1 className="text-xl font-extrabold text-[var(--color-primary)]">Bible Quest</h1>
        <div className="flex items-center gap-3">
          {/* XP + Level badge */}
          {profile && (
            <div className="flex items-center gap-1.5 bg-[var(--color-xp)]/10 px-2.5 py-1 rounded-full">
              <span className="text-sm font-extrabold text-[var(--color-xp)]">Lv.{profile.level}</span>
              <div className="w-16 h-1.5 bg-[var(--color-muted)]/20 rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--color-xp)] rounded-full transition-all"
                  style={{ width: `${xpProgress}%` }}
                />
              </div>
            </div>
          )}
          <FontSizeControl
            value={fontSize}
            onChange={(size) => {
              setFontSize(size)
              localStorage.setItem('bq_font_size', String(size))
            }}
          />
          <a href="/settings" className="text-xl" aria-label="設定">⚙️</a>
          <button onClick={handleSignOut} className="text-sm font-bold text-[var(--color-muted)] hover:text-[var(--color-primary)]" aria-label="登出">登出</button>
        </div>
      </header>
      <main className="max-w-sm mx-auto px-4 py-6 space-y-4">
        {/* Streak Card */}
        <div className="bg-[var(--color-streak)] text-white rounded-2xl p-5 shadow-lg" role="region" aria-label="連續天數">
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

        {/* Today's Lesson Card */}
        <div className="bg-white rounded-2xl p-5 shadow-sm">
          <h2 className="text-lg font-bold text-[var(--color-primary)] mb-3">
            今日功課
          </h2>

          {todayReading ? (
            <>
              <div className="mb-2">
                <p className="text-2xl font-bold text-[var(--color-primary)]">
                  {todayReading.book.name} {todayReading.chapterStart}
                </p>
                <p className="text-sm text-[var(--color-muted)]">
                  {enrollment?.scope === 'nt' ? '新約' : enrollment?.scope === 'ot' ? '舊約' : '新舊約'}
                  {' · '}{todayReading.book.abbr}{todayReading.chapterStart}.mp3
                </p>
              </div>

              {/* Audio player toolbar */}
              {todayReading && (
                <div className="mb-4">
                  <AudioPlayer
                    src={todayReading.audioUrl}
                    onEnded={() => {}}
                  />
                </div>
              )}

              {/* Verse preview */}
              {todayReading.verses.length > 0 ? (
                <div className="mb-4 scripture-text" style={{ fontSize: `${fontSize}px` }}>
                  {todayReading.verses.slice(0, 3).map(([num, text]) => (
                    <p key={num} className="leading-[1.8]">
                      <span className="text-[var(--color-xp)] font-bold mr-2 align-text-top" style={{ fontSize: '0.875rem' }}>{num}</span>
                      {text}
                    </p>
                  ))}
                  {todayReading.verses.length > 3 && (
                    <p className="text-xs text-[var(--color-muted)]">
                      ... 共 {todayReading.verses.length} 節
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-[var(--color-muted)] text-sm mb-4">載入經文...</p>
              )}

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
            <p className="text-[var(--color-muted)]">
              🎉 恭喜！你已完成全部閱讀計劃！
            </p>
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
            {profile ? (100 - (profile.total_xp % 100)) : 100} XP 到下一級
          </p>
        </div>

        {/* Partner Card */}
        <a href="/partner" className="block bg-white rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow">
          <h2 className="text-lg font-bold text-[var(--color-primary)] mb-3">
            👥 讀經夥伴
          </h2>
          <p className="text-[var(--color-muted)] text-sm">
            查看夥伴進度或邀請新朋友
          </p>
        </a>
      </main>

      {/* ── Level-up animation overlay ───────────────────────────────── */}
      {levelUp && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black/50 animate-fade-in"
          onClick={() => setLevelUp(null)}
          role="dialog"
          aria-modal="true"
          aria-label={`升級到Lv${levelUp}`}
        >
          <div className="bg-white rounded-3xl p-8 text-center shadow-2xl animate-level-up">
            <div className="text-6xl mb-3">⬆️</div>
            <div className="text-xs font-bold text-[var(--color-gem)] uppercase tracking-widest mb-1">
              Level Up!
            </div>
            <div className="text-5xl font-extrabold text-[var(--color-gem)]">
              Lv.{levelUp}
            </div>
            <p className="text-sm text-[var(--color-muted)] mt-2">
              繼續努力！
            </p>
          </div>
        </div>
      )}

      {/* ── Confetti overlay ──────────────────────────────────────────── */}
      {showConfetti && (
        <div className="fixed inset-0 z-40 pointer-events-none" aria-hidden="true">
          {Array.from({ length: 24 }).map((_, i) => (
            <div
              key={i}
              className="confetti-piece"
              style={{
                left: `${(i * 4.17) % 100}%`,
                animationDelay: `${(i * 0.07) % 0.5}s`,
                backgroundColor: ['#58CC02', '#FF9600', '#FFC800', '#1CB0F6', '#CE82FF'][i % 5],
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
