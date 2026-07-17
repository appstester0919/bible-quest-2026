'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { markLessonComplete, recalcUserStatsAfterCompletion } from '@/lib/actions'
import { checkInAllMyGroups } from '@/lib/groupActions'
import { useRouter } from 'next/navigation'
import { getChapter, getBooksMeta, type BookMeta } from '@/lib/bible/lookup'
import { celebrate } from '@/lib/confetti'

// ─── Bible Read Aloud color scheme ─────────────────────────────────────────
const C = {
  bgPrimary: '#F5F0E8',
  bgSecondary: '#EDE5D8',
  bgCard: '#FAF7F2',
  bgInput: '#E8E0D0',
  textPrimary: '#3D2914',
  textSecondary: '#6B5344',
  textMuted: '#9C7B5E',
  accentGold: '#C9A84C',
  accentGoldHover: '#B8943F',
  chapterTitle: '#8B5E3C',
  verseNumber: '#9C7B5E',
  borderColor: '#D4C4A8',
  borderLight: '#E0D5C0',
  success: '#16a34a',
}

// ─── Book categories ─────────────────────────────────────────────────────────
const BOOK_CATEGORIES = {
  pentateuch: { name: '摩西五經', bg: '#E8DCC8', text: '#5D4C37', books: ['創','出','利','民','申'] },
  history: { name: '歷史書', bg: '#D4E0ED', text: '#2A4A6D', books: ['書','士','得','撒上','撒下','王上','王下','代上','代下','拉','尼','斯'] },
  wisdom: { name: '智慧書', bg: '#EDE8D4', text: '#5C4D1A', books: ['伯','詩','箴','傳','歌'] },
  majorProphets: { name: '大先知書', bg: '#E8D8EC', text: '#5C2A6D', books: ['賽','耶','哀','結','但'] },
  minorProphets: { name: '小先知書', bg: '#D4EDE0', text: '#1A5C3A', books: ['何','珥','摩','俄','拿','彌','鴻','哈','番','該','亞','瑪'] },
  gospels: { name: '福音書', bg: '#F0DCD4', text: '#6D2A2A', books: ['太','可','路','約','徒'] },
  pauline: { name: '保羅書信', bg: '#F0E8D4', text: '#6D4A1A', books: ['羅','林前','林後','加','弗','腓','西','帖前','帖後','提前','提後','多','門'] },
  general: { name: '一般書信', bg: '#D4EEF0', text: '#1A5C6D', books: ['來','雅','彼前','彼後','約壹','約貳','約參','猶','啟'] },
}

const bookToCategory: Record<string, keyof typeof BOOK_CATEGORIES> = {}
for (const [cat, data] of Object.entries(BOOK_CATEGORIES)) {
  for (const abbr of data.books) {
    bookToCategory[abbr] = cat as keyof typeof BOOK_CATEGORIES
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface Enrollment { id: string; user_id: string; scope: 'nt' | 'ot' | 'nt_ot'; total_days: number; chapters_per_day: number; status: string; started_at?: string; created_at?: string }
interface ReadingSession { id: string; enrollment_id: string; chapter_ref: string; date_local: string }
interface ChapterData { bookAbbr: string; bookName: string; chapter: number; verses: [number, string][] }
interface Profile { current_streak: number; total_xp: number; level: number }

// ─── Speed options ────────────────────────────────────────────────────────────
const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function ReadPage() {
  const router = useRouter()
  const audioRef = useRef<HTMLAudioElement>(null)

  // Auth & data
  const [profile, setProfile] = useState<Profile | null>(null)
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null)
  const [sessions, setSessions] = useState<ReadingSession[]>([])
  const [loading, setLoading] = useState(true)

  // Books
  const [books, setBooks] = useState<BookMeta[]>([])

  // Scripture selection
  const [startBook, setStartBook] = useState<BookMeta | null>(null)
  const [startChapter, setStartChapter] = useState<number | null>(null)
  const [endBook, setEndBook] = useState<BookMeta | null>(null)
  const [endChapter, setEndChapter] = useState<number | null>(null)

  // UI state
  const [showStartBookGrid, setShowStartBookGrid] = useState(false)
  const [showStartChapterGrid, setShowStartChapterGrid] = useState(false)
  const [showEndBookGrid, setSetShowEndBookGrid] = useState(false)
  const [showEndChapterGrid, setSetShowEndChapterGrid] = useState(false)

  // Scripture display
  const [chapters, setChapters] = useState<ChapterData[]>([])
  const [showVerseNumbers, setShowVerseNumbers] = useState(true)
  const [fontSize, setFontSize] = useState(20)
  const [scriptureLoading, setScriptureLoading] = useState(false)

  // Audio
  const [audioQueue, setAudioQueue] = useState<{ book: BookMeta; chapter: number }[]>([])
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  // Ref mirrors playbackRate so we can read current value inside useEffect without adding it to the dep array
  const playbackRateRef = useRef(1)

  // Today reading
  const [todaySession, setTodaySession] = useState<ReadingSession | null>(null)
  const [isCompleting, setIsCompleting] = useState(false)
  // Auto-load refs from URL (?today=1&refs=創 1,創 2)
  const [autoLoadedRefs, setAutoLoadedRefs] = useState<string[] | null>(null)

  // Load data
  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      const { data: { user: authUser } } = await supabase.auth.getUser()
      if (!authUser) { router.push('/login'); return }

      const { data: statsData } = await supabase.from('user_stats').select('current_streak, total_xp, level').eq('user_id', authUser.id).single()
      const { data: enrollmentData } = await supabase.from('user_plan_enrollments').select('*').eq('user_id', authUser.id).eq('status', 'active').maybeSingle()
      const sessionsData = enrollmentData
        ? await supabase.from('reading_sessions').select('*').eq('enrollment_id', enrollmentData.id)
        : null

      setProfile(statsData as Profile)
      setEnrollment(enrollmentData as Enrollment)
      const sessions = sessionsData?.data as ReadingSession[] | null
      if (sessions) setSessions(sessions)

      // Load bible data
      const res = await fetch('/bible-data.json')
      const bibleJson = await res.json()
      setBooks(getBooksMeta(bibleJson))

      // Parse URL params for auto-loading (?today=1&refs=創 1,創 2)
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        const refsParam = params.get('refs')
        const isToday = params.get('today') === '1'
        if (refsParam && isToday) {
          const refList = refsParam.split(',').map(r => r.trim()).filter(Boolean)
          if (refList.length > 0) setAutoLoadedRefs(refList)
        }
      }

      // Today session
      if (enrollmentData && sessionsData) {
        const now = new Date()
        const hkt = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
        const dateLocal = hkt.toISOString().split('T')[0]
        setTodaySession((sessions ?? []).find((s: ReadingSession) => s.date_local === dateLocal) ?? null)
      }

      setLoading(false)
    }
    fetchData()
  }, [router])

  // Auto-load today's reading from URL params once books are available.
  // Queue-based: refs may span multiple books (e.g. NT+OT parallel plan),
  // so we expand the entire refs array into a chapter queue, NOT a start/end range.
  useEffect(() => {
    if (!autoLoadedRefs || books.length === 0 || chapters.length > 0) return
    console.log('[read] auto-loading:', autoLoadedRefs)

    // Expand refs into per-chapter queue (handles cross-book ranges)
    const queue: { book: BookMeta; chapter: number }[] = []
    for (const ref of autoLoadedRefs) {
      const parts = ref.trim().split(/\s+/)
      const bookName = parts[0]
      const chapter = parseInt((parts[1] || '1').replace(/:\d+$/, ''), 10) || 1
      const book = books.find(b => b.name === bookName)
      if (!book) { console.warn('[read] book not found', bookName); continue }
      queue.push({ book, chapter })
    }
    if (queue.length === 0) return

    setStartBook(queue[0].book)
    setStartChapter(queue[0].chapter)
    setEndBook(queue[queue.length - 1].book)
    setEndChapter(queue[queue.length - 1].chapter)

    loadChapterQueue(queue)
  }, [autoLoadedRefs, books])

  // Expand a multi-book chapter queue into ChapterData + audioQueue (parallel fill)
  const loadChapterQueue = useCallback(async (queue: { book: BookMeta; chapter: number }[]) => {
    setScriptureLoading(true)
    // Parallel fetch all chapters — avoid N× roundtrip penalty on 22-chapter days
    const results = await Promise.all(queue.map(async (item) => {
      const verses = await getChapter(item.book.abbr, item.chapter)
      return { item, chapterData: { bookAbbr: item.book.abbr, bookName: item.book.name, chapter: item.chapter, verses } }
    }))
    // Re-order to match original queue order (preserves parallel/sequential NT/OT order)
    const ordered = results
      .map((r, i) => ({ ...r, originalIdx: i }))
      .sort((a, b) => a.originalIdx - b.originalIdx)
    setChapters(ordered.map(r => r.chapterData))
    setAudioQueue(queue)
    setCurrentChapterIdx(0)
    setIsPlaying(false)
    setScriptureLoading(false)
  }, [])

  // Audio setup
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.playbackRate = playbackRate
  }, [playbackRate])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    const onEnded = () => {
      if (currentChapterIdx < audioQueue.length - 1) {
        setCurrentChapterIdx(i => i + 1)
      } else {
        setIsPlaying(false)
        setCurrentChapterIdx(0)
      }
    }
    audio.addEventListener('ended', onEnded)
    return () => audio.removeEventListener('ended', onEnded)
  }, [currentChapterIdx, audioQueue])

  // Auto-play when queue changes
  useEffect(() => {
    if (audioQueue.length === 0) return
    const item = audioQueue[currentChapterIdx]
    if (!item) return
    const audio = audioRef.current
    if (!audio) return
    audio.src = `/audio/${item.book.abbr}/${item.book.abbr}${item.chapter}.mp3`
    audio.playbackRate = playbackRateRef.current
    if (isPlaying) {
      audio.play().catch(() => setIsPlaying(false))
    }
  }, [currentChapterIdx, audioQueue])

  // ─── Computed helpers ─────────────────────────────────────────────────────
  const getAudioLabel = (book: BookMeta, chapter: number) => `${book.name} ${chapter} 章`

  const currentAudioItem = audioQueue[currentChapterIdx]

  // Build today's required reading list. Prefer URL-supplied refs (set by
  // dashboard via ?today=1&refs=...) since they account for reading_order
  // (parallel/nt_then_ot/ot_then_nt) and per-testament start positions.
  // Fall back to enrollment+chapters_per_day replay only when no URL refs.
  const todayRequiredRefs = (() => {
    if (autoLoadedRefs && autoLoadedRefs.length > 0) return autoLoadedRefs

    if (!enrollment || books.length === 0) return []
    const scopeBooks = enrollment.scope === 'nt'
      ? books.filter((_, i) => i >= 39)
      : enrollment.scope === 'ot'
      ? books.filter((_, i) => i < 39)
      : books
    const hktToday = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
    let start: Date
    if (enrollment.started_at) {
      const [y, m, d] = enrollment.started_at.split('T')[0].split('-').map(Number)
      start = new Date(y, m - 1, d)
    } else if (enrollment.created_at) {
      const [y, m, d] = enrollment.created_at.split('T')[0].split('-').map(Number)
      start = new Date(y, m - 1, d)
    } else {
      const [y, mo, da] = hktToday.split('-').map(Number)
      start = new Date(y, mo - 1, da)
    }
    // Count days from start to today
    const today = new Date(hktToday)
    const dayOffset = Math.floor((today.getTime() - start.getTime()) / 86400000)
    if (dayOffset < 0) return []
    // Replay plan to find today's refs
    let bookIdx = 0, chapterInBook = 1
    const current = new Date(start)
    for (let d = 0; d < dayOffset && bookIdx < scopeBooks.length; d++) {
      for (let i = 0; i < enrollment.chapters_per_day && bookIdx < scopeBooks.length; i++) {
        chapterInBook++
        if (chapterInBook > scopeBooks[bookIdx].chapters) { bookIdx++; chapterInBook = 1 }
      }
      current.setDate(current.getDate() + 1)
    }
    // Now collect today's chapters
    const refs: string[] = []
    for (let i = 0; i < enrollment.chapters_per_day && bookIdx < scopeBooks.length; i++) {
      const book = scopeBooks[bookIdx]
      refs.push(`${book.name} ${chapterInBook}`)
      chapterInBook++
      if (chapterInBook > book.chapters) { bookIdx++; chapterInBook = 1 }
    }
    return refs
  })()

  // Whether loaded audio chapters cover all today's required reading
  const loadedRefsSet = new Set(audioQueue.map(item => `${item.book.name} ${item.chapter}`))
  const allRequiredLoaded = todayRequiredRefs.length > 0 && todayRequiredRefs.every(ref => loadedRefsSet.has(ref))
  // Show complete button only if: today NOT completed AND (auto-loaded all required OR user manually selected exactly today's refs)
  const showComplete = audioQueue.length > 0 && !todaySession && allRequiredLoaded

  // ─── Book/Chapter selection ───────────────────────────────────────────────
  const handleStartBookClick = (book: BookMeta) => {
    setStartBook(book)
    setStartChapter(null)
    setEndBook(null)
    setEndChapter(null)
    setChapters([])
    setShowStartBookGrid(false)
    setShowStartChapterGrid(true)
  }

  const handleStartChapterClick = (ch: number) => {
    setStartChapter(ch)
    setShowStartChapterGrid(false)
    setSetShowEndBookGrid(true)
  }

  const handleEndBookClick = (book: BookMeta) => {
    if (startBook) {
      const startIdx = books.findIndex(b => b.abbr === startBook.abbr)
      const endIdx = books.findIndex(b => b.abbr === book.abbr)
      if (endIdx < startIdx) return // Can't select book before start
    }
    setEndBook(book)
    setEndChapter(null)
    setSetShowEndBookGrid(false)
    setSetShowEndChapterGrid(true)
  }

  const handleEndChapterClick = (ch: number) => {
    setEndChapter(ch)
    setSetShowEndChapterGrid(false)
  }

  const handleDisplay = async () => {
    if (!startBook || !startChapter || !endBook || !endChapter) return
    setScriptureLoading(true)

    const startIdx = books.findIndex(b => b.abbr === startBook.abbr)
    const endIdx = books.findIndex(b => b.abbr === endBook.abbr)

    const loaded: ChapterData[] = []
    const queue: { book: BookMeta; chapter: number }[] = []

    for (let bi = startIdx; bi <= endIdx; bi++) {
      const book = books[bi]
      const cStart = bi === startIdx ? startChapter : 1
      const cEnd = bi === endIdx ? endChapter : book.chapters
      for (let ch = cStart; ch <= cEnd; ch++) {
        const verses = await getChapter(book.abbr, ch)
        loaded.push({ bookAbbr: book.abbr, bookName: book.name, chapter: ch, verses })
        queue.push({ book, chapter: ch })
      }
    }

    setChapters(loaded)
    setAudioQueue(queue)
    setCurrentChapterIdx(0)
    setIsPlaying(false)
    setScriptureLoading(false)
  }

  // ─── Audio controls ───────────────────────────────────────────────────────
  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio || audioQueue.length === 0) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      if (!audio.src || audio.currentTime === audio.duration && audio.duration > 0) {
        // Reset, play from start
        audio.currentTime = 0
      }
      audio.play().catch(() => {})
      setIsPlaying(true)
    }
  }

  const goPrev = () => {
    if (audioQueue.length === 0) return
    const audio = audioRef.current
    if (audio) audio.pause()
    setCurrentChapterIdx(i => Math.max(0, i - 1))
    // Keep current play state so auto-play effect resumes playback
  }

  const goNext = () => {
    if (audioQueue.length === 0) return
    const audio = audioRef.current
    if (audio) audio.pause()
    setCurrentChapterIdx(i => Math.min(audioQueue.length - 1, i + 1))
    // Keep current play state so auto-play effect resumes playback
  }

  // ─── Complete today reading ──────────────────────────────────────────────
  const handleComplete = async () => {
    if (!enrollment || !profile || audioQueue.length === 0) {
      alert(`Debug: enrollment=${enrollment?.id} profile=${!!profile} audioQueue=${audioQueue.length}`)
      return
    }
    if (!enrollment.id) {
      alert('錯誤：enrollment.id 為空，請重新整理頁面')
      return
    }
    setIsCompleting(true)
    try {
      // Insert ALL queued chapters in PARALLEL for speed
      // First chapter gets xp_earned=10 (triggers daily XP award)
      // Subsequent chapters get xp_earned=0 (record only, no extra XP)
      const insertPromises = audioQueue.map((item, i) => {
        const chapterRef = `${item.book.name} ${item.chapter}`
        const xp = i === 0 ? 10 : 0
        return markLessonComplete(enrollment.id, chapterRef, xp).then(result => ({
          success: result.success, chapterRef, error: result.error
        }))
      })
      const insertResults = await Promise.all(insertPromises)
      const insertedCount = insertResults.filter(r => r.success).length
      const failedCount = insertResults.filter(r => !r.success).length
      const firstError = insertResults.find(r => !r.success)?.error || ''

      if (failedCount > 0 && insertedCount === 0) {
        alert(`全部寫入失敗：${firstError}`)
        setIsCompleting(false)
        return
      }

      if (insertedCount > 0) {
        // Recalculate stats ONCE after all inserts (not per-chapter)
        const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Hong_Kong' })
        const stats = await recalcUserStatsAfterCompletion(today)
        if (!stats.success) {
          console.error('[handleComplete] stats recalc failed:', stats.error)
        }
        // Sync group check-ins AFTER inserts + stats
        await checkInAllMyGroups(today)
        celebrate({ type: 'burst', particleCount: Math.min(insertedCount * 30, 180) })
        const now = new Date()
        const hkt = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Hong_Kong' }))
        setTodaySession({ id: 'new', enrollment_id: enrollment.id, chapter_ref: `${audioQueue[0].book.name} ${audioQueue[0].chapter}`, date_local: hkt.toISOString().split('T')[0] })
        // Update local profile state so XP/level/streak reflect server-calculated values immediately
        if (stats.success) {
          setProfile((prev: any) => prev ? {
            ...prev,
            total_xp: stats.totalXp,
            level: stats.level,
            current_streak: stats.currentStreak,
          } : prev)
        }
        if (failedCount > 0) {
          alert(`已記錄 ${insertedCount} 章，但有 ${failedCount} 章失敗：${firstError}`)
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      console.error('[handleComplete]', msg, e)
      alert(`失敗: ${msg}`)
    } finally {
      setIsCompleting(false)
    }
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: C.bgPrimary }}>
        <div style={{ color: C.textMuted }}>載入中...</div>
      </div>
    )
  }

  const canDisplay = startBook && startChapter && endBook && endChapter
  const catOf = (abbr: string) => bookToCategory[abbr] ?? null
  const catData = (abbr: string) => BOOK_CATEGORIES[catOf(abbr) ?? 'gospels']

  const todayBook = audioQueue[currentChapterIdx]?.book
  const todayChapter = audioQueue[currentChapterIdx]?.chapter

  return (
    <div style={{ minHeight: '100vh', background: C.bgPrimary, paddingTop: '72px', paddingBottom: '90px' }}>
      <audio ref={audioRef} />

      {/* ── Fixed Top Audio Bar ──────────────────────────────────────── */}
      <div id="audioBar" style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: '52px',
        background: 'rgba(245,240,232,0.97)', backdropFilter: 'blur(8px)',
        borderBottom: `1px solid ${C.borderColor}`,
        zIndex: 1000, boxShadow: '0 2px 12px rgba(61,41,20,0.06)',
        display: 'flex', alignItems: 'center',
        padding: '0 10px',
        gap: '8px',
        overflowX: 'auto', overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
        scrollbarWidth: 'none',
      }}>

        {/* Chapter display */}
        <div style={{
          minWidth: '80px', maxWidth: '96px', padding: '5px 8px',
          background: C.bgSecondary, border: `1px solid ${C.borderColor}`,
          borderRadius: '6px', fontFamily: 'Georgia, serif',
          fontSize: '0.8rem', color: C.textPrimary, flexShrink: 0,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {currentAudioItem ? getAudioLabel(currentAudioItem.book, currentAudioItem.chapter) : '馬太福音 1 章'}
        </div>

        {/* Prev — smaller icon button */}
        <button onClick={goPrev} title="上一章" className="ab-prev ab-btn" style={{
          width: '28px', height: '28px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent',
          border: `1px solid ${C.borderColor}`, borderRadius: '50%',
          color: C.textSecondary, cursor: 'pointer', fontSize: '0.8rem',
          transition: 'all 0.2s', padding: 0,
        }}>
          ◀
        </button>

        {/* Play/Pause */}
        <button onClick={togglePlay} title={isPlaying ? '暫停' : '播放'} className="ab-play ab-btn" style={{
          width: '38px', height: '38px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: isPlaying ? C.accentGold : C.bgCard,
          border: `1px solid ${isPlaying ? C.accentGold : C.borderColor}`,
          borderRadius: '50%',
          color: isPlaying ? 'white' : C.textPrimary,
          cursor: 'pointer', fontSize: '1rem',
          transition: 'all 0.2s', padding: 0,
        }}>
          {isPlaying ? '⏸' : '▶'}
        </button>

        {/* Next — smaller icon button */}
        <button onClick={goNext} title="下一章" className="ab-next ab-btn" style={{
          width: '28px', height: '28px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'transparent',
          border: `1px solid ${C.borderColor}`, borderRadius: '50%',
          color: C.textSecondary, cursor: 'pointer', fontSize: '0.8rem',
          transition: 'all 0.2s', padding: 0,
        }}>
          ▶
        </button>

        {/* Speed dropdown */}
        <select
          value={playbackRate}
          onChange={e => {
            const rate = parseFloat(e.target.value)
            setPlaybackRate(rate)
            playbackRateRef.current = rate
            if (audioRef.current) audioRef.current.playbackRate = rate
          }}
          className="ab-speed"
          style={{
            appearance: 'none', WebkitAppearance: 'none',
            background: `${C.bgCard} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236B5344' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E") no-repeat right 6px center`,
            border: `1px solid ${C.borderColor}`, borderRadius: '20px',
            padding: '5px 22px 5px 10px',
            fontSize: '0.78rem', fontFamily: 'inherit', color: C.textPrimary,
            cursor: 'pointer', minWidth: '54px', textAlign: 'center',
            flexShrink: 0, outline: 'none',
          }}
        >
          {SPEEDS.map(s => <option key={s} value={s}>{s}×</option>)}
        </select>

        {/* Font size A− */}
        <button onClick={() => setFontSize(f => Math.max(14, f - 2))} title="縮小字體" className="ab-font-dec ab-btn" style={{
          width: '26px', height: '26px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: C.bgCard, border: `1px solid ${C.borderColor}`,
          borderRadius: '50%', color: C.textSecondary,
          cursor: 'pointer', fontSize: '0.7rem', fontWeight: 700,
          transition: 'all 0.2s', padding: 0,
        }}>A−</button>

        {/* Font size A+ */}
        <button onClick={() => setFontSize(f => Math.min(36, f + 2))} title="放大字體" className="ab-font-inc ab-btn" style={{
          width: '26px', height: '26px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: C.bgCard, border: `1px solid ${C.borderColor}`,
          borderRadius: '50%', color: C.textSecondary,
          cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700,
          transition: 'all 0.2s', padding: 0,
        }}>A+</button>
      </div>

      {/* Audio bar button size CSS — injected once, no Tailwind override possible */}
      <style>{`
        .ab-btn { all: unset !important; box-sizing: border-box !important; min-width: unset !important; min-height: unset !important; }
        .ab-prev, .ab-next { width: 28px !important; height: 28px !important; }
        .ab-play { width: 38px !important; height: 38px !important; }
        .ab-font-dec, .ab-font-inc { width: 26px !important; height: 26px !important; }
        .ab-btn { display: flex !important; align-items: center !important; justify-content: center !important; border-radius: 50% !important; border: 1px solid ${C.borderColor} !important; color: ${C.textSecondary} !important; cursor: pointer !important; transition: all 0.2s !important; padding: 0 !important; flex-shrink: 0 !important; }
        .ab-play { background: ${C.bgCard} !important; border-color: ${C.borderColor} !important; color: ${C.textPrimary} !important; }
        .ab-font-dec, .ab-font-inc { background: ${C.bgCard} !important; font-size: 0.7rem !important; font-weight: 700 !important; }
        .ab-prev, .ab-next { background: transparent !important; font-size: 0.8rem !important; }
        .ab-speed { border: 1px solid ${C.borderColor} !important; border-radius: 20px !important; padding: 5px 22px 5px 10px !important; font-size: 0.78rem !important; color: ${C.textPrimary} !important; cursor: pointer !important; text-align: center !important; flex-shrink: 0 !important; outline: none !important; }
      `}</style>

      {/* ── Main content ──────────────────────────────────────────────── */}
      <div style={{ maxWidth: '900px', margin: '0 auto', padding: '20px 16px' }}>

        {/* ── Range Selector ─────────────────────────────────────── */}
        <div style={{
          background: C.bgCard, borderRadius: '10px', padding: '20px',
          boxShadow: '0 2px 12px rgba(61,41,20,0.06)',
          border: `1px solid ${C.borderLight}`, marginBottom: '20px',
        }}>
          <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.8rem', color: C.textPrimary, marginBottom: '4px', fontWeight: 600 }}>
            📖 聖經朗讀
          </div>
          <div style={{ color: C.textMuted, fontSize: '0.9rem', marginBottom: '20px' }}>
            選擇書卷和章節範圍，或直接使用今日功課
          </div>

          {/* Today reading hint */}
          {todaySession ? (
            <div style={{
              padding: '10px 14px', background: `${C.success}15`,
              border: `1px solid ${C.success}40`, borderRadius: '8px',
              color: C.success, fontSize: '0.9rem', fontWeight: 500,
              marginBottom: '16px', textAlign: 'center',
            }}>
              ✅ 今日讀經已完成：{todaySession.chapter_ref}
            </div>
          ) : audioQueue.length > 0 && (
            <div style={{
              padding: '10px 14px', background: `${C.accentGold}15`,
              border: `1px solid ${C.accentGold}40`, borderRadius: '8px',
              color: C.chapterTitle, fontSize: '0.9rem', fontWeight: 500,
              marginBottom: '16px', textAlign: 'center',
            }}>
              📖 今日功課：{todayRequiredRefs.length > 0 ? `${todayRequiredRefs.length}章` : `${todayBook?.name} ${todayChapter} 章`}{todayRequiredRefs.length > 0 && ` · ${todayRequiredRefs.join('、')}`}
            </div>
          )}

          {/* Start selector */}
          <div style={{ marginBottom: '16px' }}>
            <div style={{ fontSize: '0.85rem', color: C.textSecondary, marginBottom: '6px', fontWeight: 500 }}>
              起始書卷與章節
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {/* Start book dropdown */}
              <div style={{ position: 'relative', flex: 2 }}>
                <div
                  onClick={() => { setShowStartBookGrid(v => !v); setShowStartChapterGrid(false); setSetShowEndBookGrid(false); setSetShowEndChapterGrid(false) }}
                  style={{
                    padding: '10px 14px', background: C.bgInput,
                    border: `1px solid ${C.borderColor}`, borderRadius: '8px',
                    cursor: 'pointer', color: startBook ? C.textPrimary : C.textMuted,
                    fontSize: '0.95rem', minHeight: '44px', display: 'flex', alignItems: 'center',
                    justifyContent: 'space-between', userSelect: 'none',
                  }}
                >
                  <span>{startBook ? `${startBook.name}${startChapter ? ` 第${startChapter}章` : ''}` : '選擇起始書卷'}</span>
                  <span style={{ fontSize: '0.7rem', color: C.textMuted }}>▼</span>
                </div>
                {/* Book grid dropdown */}
                {showStartBookGrid && (
                  <div style={{
                    position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                    background: C.bgCard, border: `1px solid ${C.borderColor}`,
                    borderRadius: '8px', padding: '8px',
                    boxShadow: '0 4px 16px rgba(61,41,20,0.12)',
                    maxHeight: '300px', overflowY: 'auto',
                  }}>
                    {Object.entries(BOOK_CATEGORIES).map(([cat, data]) => (
                      <div key={cat}>
                        <div style={{ fontSize: '0.75rem', color: data.text, fontWeight: 600, padding: '4px 6px', marginTop: '6px', marginBottom: '4px', opacity: 0.8 }}>{data.name}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px' }}>
                          {data.books.map(abbr => (
                            <div key={abbr} onClick={() => { const b = books.find(x => x.abbr === abbr); if (b) handleStartBookClick(b) }}
                              style={{
                                padding: '6px 2px', textAlign: 'center', borderRadius: '5px',
                                cursor: 'pointer', fontSize: '0.8rem', fontWeight: 500,
                                background: data.bg, color: data.text,
                                border: startBook?.abbr === abbr ? `2px solid ${C.accentGold}` : '2px solid transparent',
                              }}>
                              {abbr}
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* End selector */}
          {startBook && startChapter && (
            <div style={{ marginBottom: '16px' }}>
              <div style={{ fontSize: '0.85rem', color: C.textSecondary, marginBottom: '6px', fontWeight: 500 }}>
                結束書卷與章節
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ position: 'relative', flex: 2 }}>
                  <div
                    onClick={() => { setSetShowEndBookGrid(v => !v); setSetShowEndChapterGrid(false); setShowStartBookGrid(false); setShowStartChapterGrid(false) }}
                    style={{
                      padding: '10px 14px', background: C.bgInput,
                      border: `1px solid ${C.borderColor}`, borderRadius: '8px',
                      cursor: 'pointer', color: endBook ? C.textPrimary : C.textMuted,
                      fontSize: '0.95rem', minHeight: '44px', display: 'flex', alignItems: 'center',
                      justifyContent: 'space-between', userSelect: 'none',
                    }}
                  >
                    <span>{endBook ? `${endBook.name}${endChapter ? ` 第${endChapter}章` : ''}` : '選擇結束書卷'}</span>
                    <span style={{ fontSize: '0.7rem', color: C.textMuted }}>▼</span>
                  </div>
                  {showEndBookGrid && (
                    <div style={{
                      position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200,
                      background: C.bgCard, border: `1px solid ${C.borderColor}`,
                      borderRadius: '8px', padding: '8px',
                      boxShadow: '0 4px 16px rgba(61,41,20,0.12)',
                      maxHeight: '300px', overflowY: 'auto',
                    }}>
                      {Object.entries(BOOK_CATEGORIES).map(([cat, data]) => {
                        const startIdx = books.findIndex(b => b.abbr === startBook.abbr)
                        const catBooks = data.books
                        return (
                          <div key={cat}>
                            <div style={{ fontSize: '0.75rem', color: data.text, fontWeight: 600, padding: '4px 6px', marginTop: '6px', marginBottom: '4px', opacity: 0.8 }}>{data.name}</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '4px' }}>
                              {catBooks.map(abbr => {
                                const idx = books.findIndex(b => b.abbr === abbr)
                                const disabled = idx < startIdx
                                return (
                                  <div key={abbr} onClick={() => { if (!disabled) { const b = books.find(x => x.abbr === abbr); if (b) handleEndBookClick(b) } }}
                                    style={{
                                      padding: '6px 2px', textAlign: 'center', borderRadius: '5px',
                                      cursor: disabled ? 'not-allowed' : 'pointer', fontSize: '0.8rem', fontWeight: 500,
                                      background: disabled ? C.bgSecondary : data.bg,
                                      color: disabled ? C.textMuted : data.text,
                                      opacity: disabled ? 0.4 : 1,
                                      border: endBook?.abbr === abbr ? `2px solid ${C.accentGold}` : '2px solid transparent',
                                    }}>
                                    {abbr}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Chapter grids */}
          {showStartChapterGrid && startBook && (
            <div style={{
              background: C.bgCard, border: `1px solid ${C.borderColor}`,
              borderRadius: '8px', padding: '10px', marginBottom: '12px',
              boxShadow: '0 2px 8px rgba(61,41,20,0.08)',
            }}>
              <div style={{ fontSize: '0.8rem', color: C.textSecondary, textAlign: 'center', paddingBottom: '8px', borderBottom: `1px solid ${C.borderColor}`, marginBottom: '8px' }}>
                {startBook.name} — 選擇起始章節
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '4px' }}>
                {Array.from({ length: startBook.chapters }, (_, i) => i + 1).map(ch => (
                  <div key={ch} onClick={() => handleStartChapterClick(ch)}
                    style={{
                      padding: '8px 4px', textAlign: 'center', borderRadius: '4px',
                      cursor: 'pointer', background: startChapter === ch ? C.accentGold : C.bgSecondary,
                      color: startChapter === ch ? 'white' : C.textPrimary,
                      fontSize: '0.88rem', transition: 'all 0.15s',
                      border: startChapter === ch ? `1px solid ${C.accentGold}` : '1px solid transparent',
                    }}>
                    {ch}
                  </div>
                ))}
              </div>
            </div>
          )}

          {showEndChapterGrid && endBook && (
            <div style={{
              background: C.bgCard, border: `1px solid ${C.borderColor}`,
              borderRadius: '8px', padding: '10px', marginBottom: '12px',
              boxShadow: '0 2px 8px rgba(61,41,20,0.08)',
            }}>
              <div style={{ fontSize: '0.8rem', color: C.textSecondary, textAlign: 'center', paddingBottom: '8px', borderBottom: `1px solid ${C.borderColor}`, marginBottom: '8px' }}>
                {endBook.name} — 選擇結束章節
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(10, 1fr)', gap: '4px' }}>
                {Array.from({ length: endBook.chapters }, (_, i) => i + 1).map(ch => {
                  const disabled = startBook?.abbr === endBook.abbr && ch < (startChapter ?? 0)
                  return (
                    <div key={ch} onClick={() => !disabled && handleEndChapterClick(ch)}
                      style={{
                        padding: '8px 4px', textAlign: 'center', borderRadius: '4px',
                        cursor: disabled ? 'not-allowed' : 'pointer',
                        background: disabled ? C.bgSecondary : endChapter === ch ? C.accentGold : C.bgSecondary,
                        color: disabled ? C.textMuted : endChapter === ch ? 'white' : C.textPrimary,
                        fontSize: '0.88rem', transition: 'all 0.15s',
                        opacity: disabled ? 0.4 : 1,
                        border: endChapter === ch ? `1px solid ${C.accentGold}` : '1px solid transparent',
                      }}>
                      {ch}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Display button */}
          <button
            onClick={handleDisplay}
            disabled={!canDisplay || scriptureLoading}
            style={{
              width: '100%', padding: '14px',
              background: canDisplay ? C.accentGold : `${C.borderColor}60`,
              border: 'none', borderRadius: '8px',
              color: canDisplay ? 'white' : C.textMuted,
              fontSize: '1.05rem', fontWeight: 600, cursor: canDisplay ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              boxShadow: canDisplay ? '0 4px 12px rgba(201,168,76,0.3)' : 'none',
            }}
          >
            {scriptureLoading ? '載入經文中...' : `📖 顯示經文${canDisplay ? `（${startBook?.name}${startChapter}章${startBook?.abbr !== endBook?.abbr ? ` - ${endBook?.name}${endChapter}章` : ` - 第${endChapter}章`}）` : ''}`}
          </button>

          {/* Verse number toggle */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
            <input
              type="checkbox"
              checked={showVerseNumbers}
              onChange={e => setShowVerseNumbers(e.target.checked)}
              style={{ accentColor: C.accentGold, width: '16px', height: '16px', cursor: 'pointer' }}
            />
            <span style={{ fontSize: '0.85rem', color: C.textSecondary }}>顯示經節號碼</span>
          </div>
        </div>

        {/* ── Scripture Display ─────────────────────────────────── */}
        {chapters.length > 0 && (
          <div>
            {chapters.map((chapter, idx) => {
              // Detect testament by book category (NT = gospels/pauline/general, OT = everything else)
              const isNT = ['gospels','pauline','general'].includes(bookToCategory[chapter.bookAbbr] || '')
              const testament = isNT ? 'NT' : 'OT'
              const testamentBg = isNT ? '#E8D5F0' : '#FFE5C2'
              const testamentText = isNT ? '#5C2A6D' : '#8B4513'
              const totalChapters = audioQueue.length
              return (
                <div key={`${chapter.bookAbbr}-${chapter.chapter}`} style={{
                  background: C.bgCard, borderRadius: '10px',
                  padding: '20px', marginBottom: '20px',
                  border: `1px solid ${C.borderLight}`,
                  borderLeft: `4px solid ${C.accentGold}`,
                  boxShadow: '0 2px 8px rgba(61,41,20,0.06)',
                  position: 'relative',
                }}>
                  <span style={{
                    position: 'absolute', top: '12px', right: '12px',
                    background: testamentBg, color: testamentText,
                    fontSize: '0.7rem', fontWeight: 700,
                    padding: '3px 8px', borderRadius: '6px',
                  }}>
                    {testament} · 第 {idx + 1}/{totalChapters} 章
                  </span>
                  <h2 style={{
                    fontFamily: 'Georgia, serif', fontSize: '1.3em',
                    fontWeight: 600, color: C.chapterTitle,
                    marginBottom: '16px', paddingBottom: '10px',
                    paddingRight: '90px', // leave room for badge
                    borderBottom: `1px solid ${C.borderColor}`,
                  }}>
                    {chapter.bookName} {chapter.chapter} 章
                  </h2>
                {chapter.verses.map(([num, text]) => (
                  <div key={num} style={{
                    marginBottom: '12px', display: 'flex', gap: '12px',
                    alignItems: 'flex-start',
                  }}>
                    {showVerseNumbers && (
                      <span style={{
                        fontFamily: 'Georgia, serif', color: C.verseNumber,
                        fontWeight: 500, fontSize: '0.75em',
                        minWidth: '2.5em', textAlign: 'right',
                        flexShrink: 0, paddingTop: '2px',
                      }}>
                        {num}
                      </span>
                    )}
                    <span style={{
                      flex: 1, color: C.textPrimary, lineHeight: 1.9,
                      fontSize: `${fontSize}px`,
                    }}>
                      {text}
                    </span>
                  </div>
                ))}
                </div>
              )
            })}

            {/* Complete button — only show when all today's required chapters are loaded */}
            {audioQueue.length > 0 && (
              <button
                onClick={handleComplete}
                disabled={!!todaySession || isCompleting || !allRequiredLoaded}
                style={{
                  width: '100%', padding: '16px',
                  background: todaySession ? C.success : allRequiredLoaded ? C.accentGold : C.borderColor,
                  border: 'none', borderRadius: '10px',
                  color: todaySession ? 'white' : allRequiredLoaded ? 'white' : C.textMuted,
                  fontSize: '1.1rem', fontWeight: 700,
                  cursor: todaySession || isCompleting || !allRequiredLoaded ? 'default' : 'pointer',
                  transition: 'all 0.2s', marginBottom: '20px',
                  boxShadow: allRequiredLoaded && !todaySession ? '0 4px 12px rgba(201,168,76,0.3)' : 'none',
                  opacity: isCompleting ? 0.7 : 1,
                }}
              >
                {todaySession
                  ? '✅ 今日讀經已完成'
                  : isCompleting
                  ? '處理中...'
                  : allRequiredLoaded
                  ? `完成讀經 ✓（+10 XP）`
                  : `需完成 ${todayRequiredRefs.length} 章才能標記完成`}
              </button>
            )}
          </div>
        )}

        {/* Empty state */}
        {chapters.length === 0 && !scriptureLoading && (
          <div style={{
            textAlign: 'center', padding: '40px 20px',
            color: C.textMuted, background: C.bgCard,
            borderRadius: '10px', border: `1px solid ${C.borderLight}`,
          }}>
            <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📖</div>
            <div style={{ fontSize: '1.1rem', fontWeight: 600, color: C.textSecondary, marginBottom: '8px' }}>
              選擇書卷和章節開始朗讀
            </div>
            <div style={{ fontSize: '0.9rem' }}>
              使用上方選擇器揀選聖經範圍，即可開始閱讀和聆聽
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
