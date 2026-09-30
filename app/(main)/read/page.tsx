'use client'

import {
  useEffect,
  useState,
  useCallback,
  useMemo,
  useRef,
  type CSSProperties,
} from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  markDayCompleteBatch,
  recalcUserStatsAfterCompletion,
} from '@/lib/actions'
import { checkInAllMyGroups } from '@/lib/groupActions'
import { useRouter } from 'next/navigation'
import { getChapter, loadBible, type BookMeta } from '@/lib/bible/lookup'
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

// ─── Chapter-grid layout constants ─────────────────────────────────────────
// The chapter grid used to be a fixed repeat(10, 1fr), which on a 375px phone
// yields ~24.5px cells — far too small to hit. We now let the column count
// adapt, with a hard 44px floor so a cell can never be narrower than a
// thumb-friendly minimum on the narrowest phone we support:
//
//   available width ≈ 375 - 20 (card padding) - page padding ≈ 330px
//   → 7 columns of 44px + 6 gaps of 4px = 332px  (the 8th would not fit)
//   → cell width ≈ (330 - 24) / 7 ≈ 43.7px  ✔ ≥ 44px floor
//
// (The separate 56px+ touch-target task the user deferred would need a
// ~58px floor, i.e. 5 columns; deliberately NOT done here.)
const CHAPTER_GRID_MINMAX = 'minmax(44px, 1fr)'
// Cells are ~44px tall + 4px gap ≈ 48px per row, so 280px shows ~5-6 rows.
// That is enough to feel like a list you can scan by thumb while leaving the
// 顯示經文 button within thumb reach instead of pushed off-screen by 詩篇's
// 15 rows. A 1-chapter book (單節書: 俄巴底亞書 etc.) renders one ~44px cell
// inside this 280px box, so nothing is clipped and no scrollbar appears.
const CHAPTER_GRID_MAX_HEIGHT = '280px'

// ─── Book categories ─────────────────────────────────────────────────────────
const BOOK_CATEGORIES = {
  pentateuch: {
    name: '摩西五經',
    bg: '#E8DCC8',
    text: '#5D4C37',
    books: ['創', '出', '利', '民', '申'],
  },
  history: {
    name: '歷史書',
    bg: '#D4E0ED',
    text: '#2A4A6D',
    books: [
      '書',
      '士',
      '得',
      '撒上',
      '撒下',
      '王上',
      '王下',
      '代上',
      '代下',
      '拉',
      '尼',
      '斯',
    ],
  },
  wisdom: {
    name: '智慧書',
    bg: '#EDE8D4',
    text: '#5C4D1A',
    books: ['伯', '詩', '箴', '傳', '歌'],
  },
  majorProphets: {
    name: '大先知書',
    bg: '#E8D8EC',
    text: '#5C2A6D',
    books: ['賽', '耶', '哀', '結', '但'],
  },
  minorProphets: {
    name: '小先知書',
    bg: '#D4EDE0',
    text: '#1A5C3A',
    books: [
      '何',
      '珥',
      '摩',
      '俄',
      '拿',
      '彌',
      '鴻',
      '哈',
      '番',
      '該',
      '亞',
      '瑪',
    ],
  },
  gospels: {
    name: '福音書',
    bg: '#F0DCD4',
    text: '#6D2A2A',
    books: ['太', '可', '路', '約', '徒'],
  },
  pauline: {
    name: '保羅書信',
    bg: '#F0E8D4',
    text: '#6D4A1A',
    books: [
      '羅',
      '林前',
      '林後',
      '加',
      '弗',
      '腓',
      '西',
      '帖前',
      '帖後',
      '提前',
      '提後',
      '多',
      '門',
    ],
  },
  general: {
    name: '一般書信',
    bg: '#D4EEF0',
    text: '#1A5C6D',
    books: ['來', '雅', '彼前', '彼後', '約壹', '約貳', '約參', '猶', '啟'],
  },
}

const bookToCategory: Record<string, keyof typeof BOOK_CATEGORIES> = {}
for (const [cat, data] of Object.entries(BOOK_CATEGORIES)) {
  for (const abbr of data.books) {
    bookToCategory[abbr] = cat as keyof typeof BOOK_CATEGORIES
  }
}

// ─── Types ───────────────────────────────────────────────────────────────────
interface Enrollment {
  id: string
  user_id: string
  scope: 'nt' | 'ot' | 'nt_ot'
  total_days: number
  chapters_per_day: number
  status: string
  started_at?: string
  created_at?: string
}
interface ReadingSession {
  id: string
  enrollment_id: string
  chapter_ref: string
  date_local: string
}
interface ChapterData {
  bookAbbr: string
  bookName: string
  chapter: number
  verses: [number, string][]
}
interface Profile {
  current_streak: number
  total_xp: number
  level: number
}

// ─── Speed options ────────────────────────────────────────────────────────────
const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const

// ─── Scroll-driven chapter loading constants ─────────────────────────────────
// How far BEFORE the end sentinel becomes visible we append the next chapter.
// 500px is roughly one phone screen, so a normal flick-scroll lands on readable
// text rather than on an empty sentinel. NOTE: this appends text only — the
// whole 1189-chapter corpus is already in memory (loadBible) and getChapter is
// an in-memory lookup, so an append costs a React state push, never a request.
const END_SENTINEL_MARGIN = '500px 0px 0px 0px'
// The start sentinel uses NO positive top margin on purpose. This page scrolls
// the whole document (the range selector sits above the chapter list in the
// same scroller), so any top margin would make the observer fire while the
// reader is still looking at the selector — silently prepending chapters they
// never scrolled back to. The start sentinel must actually be seen to trigger.
const START_SENTINEL_MARGIN = '0px'
// Minimum gap between two appends. A fast flick-scroll on mobile can fire the
// sentinel observer many times in a row (the list re-renders on every append),
// so this rate-limits the append path; together with the in-flight
// `appendBusyRef` flag it caps growth to one chapter per window and stops the
// two ends from interleaving into a state thrash.
const APPEND_COOLDOWN_MS = 180
// The fixed audio bar is 52px tall, so from 72px down we treat everything as
// "off the top". A chapter card that is the topmost one still visible in this
// band is the chapter the reader is looking at. Deliberately not 0 — at 0 the
// fixed bar's own edge would decide, and the top of a card is often flush with
// it.
const TOP_CHAPTER_BAND_PX = 130

/** Stable identity for a chapter ref; used to de-duplicate appends at both ends. */
const chapterKey = (abbr: string, chapter: number) => `${abbr}:${chapter}`

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
  // Single-chapter jump (直接跳到) is the DEFAULT, because reading one chapter
  // is the overwhelmingly common case. When rangeMode is false the end-selector
  // is not rendered at all and handleDisplay reuses the exact start==end code
  // path, so audio / prefetch / 完成讀經 are byte-for-byte identical to a
  // 1-chapter range.
  const [rangeMode, setRangeMode] = useState(false)

  // UI state
  const [showStartBookGrid, setShowStartBookGrid] = useState(false)
  const [showStartChapterGrid, setShowStartChapterGrid] = useState(false)
  const [showEndBookGrid, setSetShowEndBookGrid] = useState(false)
  const [showEndChapterGrid, setSetShowEndChapterGrid] = useState(false)

  // Scripture display
  const [chapters, setChapters] = useState<ChapterData[]>([])
  const [showVerseNumbers, setShowVerseNumbers] = useState(true)
  // Font size is NOT component state: it is written straight onto the root
  // element as the --read-font-size custom property, so an A+/A− tap costs one
  // style recalc instead of a re-render + re-layout of every verse node
  // (Psalm 119 alone is 176 verse rows). fontSizeRef only exists to clamp the
  // next value, since the DOM is the single source of truth.
  const fontSizeRef = useRef(20)
  const rootRef = useRef<HTMLDivElement>(null)
  const setFontSize = useCallback((next: number) => {
    const clamped = Math.max(14, Math.min(36, next))
    fontSizeRef.current = clamped
    rootRef.current?.style.setProperty(
      '--read-font-size',
      `${clamped}px`,
    )
  }, [])
  const [scriptureLoading, setScriptureLoading] = useState(false)

  // Audio
  const [audioQueue, setAudioQueue] = useState<
    { book: BookMeta; chapter: number }[]
  >([])
  const [currentChapterIdx, setCurrentChapterIdx] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackRate, setPlaybackRate] = useState(1)
  // Ref mirrors playbackRate so we can read current value inside useEffect without adding it to the dep array
  const playbackRateRef = useRef(1)
  // Detached Audio used only to warm the HTTP cache for the next chapter's mp3.
  const prefetchRef = useRef<HTMLAudioElement | null>(null)

  // Today reading
  const [todaySession, setTodaySession] = useState<ReadingSession | null>(null)
  const [isCompleting, setIsCompleting] = useState(false)
  // Auto-load refs from URL (?today=1&refs=創 1,創 2)
  const [autoLoadedRefs, setAutoLoadedRefs] = useState<string[] | null>(null)

  // Load data
  useEffect(() => {
    const fetchData = async () => {
      const supabase = createClient()
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser()
      if (!authUser) {
        router.push('/login')
        return
      }

      const { data: statsData } = await supabase
        .from('user_stats')
        .select('current_streak, total_xp, level')
        .eq('user_id', authUser.id)
        .single()
      const { data: enrollmentData } = await supabase
        .from('user_plan_enrollments')
        .select('*')
        .eq('user_id', authUser.id)
        .eq('status', 'active')
        .maybeSingle()
      const sessionsData = enrollmentData
        ? await supabase
            .from('reading_sessions')
            .select('*')
            .eq('enrollment_id', enrollmentData.id)
        : null

      setProfile(statsData as Profile)
      setEnrollment(enrollmentData as Enrollment)
      const sessions = sessionsData?.data as ReadingSession[] | null
      if (sessions) setSessions(sessions)

      // Load bible data — reuse the shared cached loader so /bible-data.json is
      // downloaded and parsed exactly once (getChapter() uses the same cache).
      const bible = await loadBible()
      setBooks(bible.books)

      // Parse URL params for auto-loading (?today=1&refs=創 1,創 2)
      if (typeof window !== 'undefined') {
        const params = new URLSearchParams(window.location.search)
        const refsParam = params.get('refs')
        const isToday = params.get('today') === '1'
        if (refsParam && isToday) {
          const refList = refsParam
            .split(',')
            .map((r) => r.trim())
            .filter(Boolean)
          if (refList.length > 0) setAutoLoadedRefs(refList)
        }
      }

      // Today session
      if (enrollmentData && sessionsData) {
        // en-CA + HKT gives YYYY-MM-DD directly without a UTC round-trip.
        // The previous en-US + toISOString() pattern returned YESTERDAY's date
        // when the browser was in HKT between 00:00 and 08:00.
        const dateLocal = new Date().toLocaleDateString('en-CA', {
          timeZone: 'Asia/Hong_Kong',
        })
        setTodaySession(
          (sessions ?? []).find(
            (s: ReadingSession) => s.date_local === dateLocal,
          ) ?? null,
        )
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
      const book = books.find((b) => b.name === bookName)
      if (!book) {
        console.warn('[read] book not found', bookName)
        continue
      }
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
  const loadChapterQueue = useCallback(
    async (queue: { book: BookMeta; chapter: number }[]) => {
      setScriptureLoading(true)
      // Parallel fetch all chapters — avoid N× roundtrip penalty on 22-chapter days
      const results = await Promise.all(
        queue.map(async (item) => {
          const verses = await getChapter(item.book.abbr, item.chapter)
          return {
            item,
            chapterData: {
              bookAbbr: item.book.abbr,
              bookName: item.book.name,
              chapter: item.chapter,
              verses,
            },
          }
        }),
      )
      // Re-order to match original queue order (preserves parallel/sequential NT/OT order)
      const ordered = results
        .map((r, i) => ({ ...r, originalIdx: i }))
        .sort((a, b) => a.originalIdx - b.originalIdx)
      setChapters(ordered.map((r) => r.chapterData))
      setAudioQueue(queue)
      setCurrentChapterIdx(0)
      setIsPlaying(false)
      setScriptureLoading(false)
    },
    [],
  )

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
        setCurrentChapterIdx((i) => i + 1)
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

    // Best-effort warm of the next chapter's mp3 so `ended` → next src does not
    // stall on a cold network. Never throws, never awaited, never blocks playback.
    const next = audioQueue[currentChapterIdx + 1]
    if (next) {
      try {
        prefetchRef.current?.removeAttribute('src')
        prefetchRef.current?.load()
        const p = new Audio()
        p.preload = 'auto'
        p.src = `/audio/${next.book.abbr}/${next.book.abbr}${next.chapter}.mp3`
        prefetchRef.current = p
      } catch {
        /* prefetch is purely opportunistic */
      }
    }
  }, [currentChapterIdx, audioQueue])

  // ─── Computed helpers ─────────────────────────────────────────────────────
  const getAudioLabel = (book: BookMeta, chapter: number) =>
    `${book.abbr} ${chapter}章`

  const currentAudioItem = audioQueue[currentChapterIdx]

  // Build today's required reading list. Prefer URL-supplied refs (set by
  // dashboard via ?today=1&refs=...) since they account for reading_order
  // (parallel/nt_then_ot/ot_then_nt) and per-testament start positions.
  // Fall back to enrollment+chapters_per_day replay only when no URL refs.
  //
  // Memoised: the fallback branch replays the plan day-by-day (O(dayOffset ×
  // chapters_per_day) date arithmetic) and allocates a scopeBooks array, so it
  // is not free on every render. Dependencies are exactly what it reads:
  // autoLoadedRefs (early-return value), enrollment, books. Nothing else —
  // `new Date()` is read deliberately so this stays correct if the tab is left
  // open across HKT midnight; that costs at most one recompute per render
  // change, and the loop is only reached when the URL refs are absent.
  const todayRequiredRefs = useMemo<string[]>(() => {
    if (autoLoadedRefs && autoLoadedRefs.length > 0) return autoLoadedRefs

    if (!enrollment || books.length === 0) return []
    const scopeBooks =
      enrollment.scope === 'nt'
        ? books.filter((_, i) => i >= 39)
        : enrollment.scope === 'ot'
          ? books.filter((_, i) => i < 39)
          : books
    const hktToday = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Asia/Hong_Kong',
    })
    let start: Date
    if (enrollment.started_at) {
      const [y, m, d] = enrollment.started_at
        .split('T')[0]
        .split('-')
        .map(Number)
      start = new Date(y, m - 1, d)
    } else if (enrollment.created_at) {
      const [y, m, d] = enrollment.created_at
        .split('T')[0]
        .split('-')
        .map(Number)
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
    let bookIdx = 0,
      chapterInBook = 1
    const current = new Date(start)
    for (let d = 0; d < dayOffset && bookIdx < scopeBooks.length; d++) {
      for (
        let i = 0;
        i < enrollment.chapters_per_day && bookIdx < scopeBooks.length;
        i++
      ) {
        chapterInBook++
        if (chapterInBook > scopeBooks[bookIdx].chapters) {
          bookIdx++
          chapterInBook = 1
        }
      }
      current.setDate(current.getDate() + 1)
    }
    // Now collect today's chapters
    const refs: string[] = []
    for (
      let i = 0;
      i < enrollment.chapters_per_day && bookIdx < scopeBooks.length;
      i++
    ) {
      const book = scopeBooks[bookIdx]
      refs.push(`${book.name} ${chapterInBook}`)
      chapterInBook++
      if (chapterInBook > book.chapters) {
        bookIdx++
        chapterInBook = 1
      }
    }
    return refs
  }, [autoLoadedRefs, enrollment, books])

  // Whether loaded audio chapters cover all today's required reading.
  // Memoised on [audioQueue] — the Set is rebuilt from scratch on every
  // render otherwise, and audioQueue is a stable reference between
  // queue-setting events (setAudioQueue is only called from
  // loadChapterQueue / handleDisplay), so this recomputes exactly when the
  // queue changes rather than on every keystroke-sized state change.
  const allRequiredLoaded = useMemo(() => {
    const loadedRefsSet = new Set(
      audioQueue.map((item) => `${item.book.name} ${item.chapter}`),
    )
    return (
      todayRequiredRefs.length > 0 &&
      todayRequiredRefs.every((ref) => loadedRefsSet.has(ref))
    )
  }, [audioQueue, todayRequiredRefs])
  // Show complete button only if: today NOT completed AND (auto-loaded all required OR user manually selected exactly today's refs)
  const showComplete =
    audioQueue.length > 0 && !todaySession && allRequiredLoaded

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
    // In single-chapter mode there is no end selector, so do not force the
    // end-book grid open (that was the extra "pick the book again" step).
    if (rangeMode) setSetShowEndBookGrid(true)
  }

  // Turning range mode on/off invalidates the end selection, so clear it and
  // collapse any open end dropdown rather than leaving a stale end half-shown.
  const handleToggleRangeMode = () => {
    setRangeMode((v) => {
      const next = !v
      if (!next) {
        setEndBook(null)
        setEndChapter(null)
        setSetShowEndBookGrid(false)
        setSetShowEndChapterGrid(false)
      }
      return next
    })
  }

  const handleEndBookClick = (book: BookMeta) => {
    if (startBook) {
      const startIdx = books.findIndex((b) => b.abbr === startBook.abbr)
      const endIdx = books.findIndex((b) => b.abbr === book.abbr)
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
    if (!startBook || !startChapter) return
    // Single-chapter mode: synthesise end = start and fall through to the very
    // same loop below, so `chapters` / `audioQueue` are identical to a
    // start==end range (one target, one chapter) and audio, prefetch, the
    // 完成讀經 button and session tracking need no separate branch.
    const effEndBook = rangeMode && endBook ? endBook : startBook
    const effEndChapter = rangeMode && endChapter ? endChapter : startChapter
    setScriptureLoading(true)

    const startIdx = books.findIndex((b) => b.abbr === startBook.abbr)
    const endIdx = books.findIndex((b) => b.abbr === effEndBook.abbr)

    // Build the full (book, chapter) list first, then resolve the verses in
    // bounded-concurrency batches. A single 1189-wide Promise.all would, on a
    // cold cache, make every concurrent getChapter() miss loadBible()'s `_bibleCache`
    // and issue 1189 simultaneous 4.2 MB /bible-data.json fetches. 50 keeps the
    // warm-cache microtask path fast while capping the worst case.
    const targets: { book: BookMeta; chapter: number }[] = []
    for (let bi = startIdx; bi <= endIdx; bi++) {
      const book = books[bi]
      const cStart = bi === startIdx ? startChapter : 1
      const cEnd = bi === endIdx ? effEndChapter : book.chapters
      for (let ch = cStart; ch <= cEnd; ch++) {
        targets.push({ book, chapter: ch })
      }
    }

    const CHUNK = 50
    const loaded: ChapterData[] = []
    for (let i = 0; i < targets.length; i += CHUNK) {
      const batch = await Promise.all(
        targets.slice(i, i + CHUNK).map(async ({ book, chapter }) => {
          const verses = await getChapter(book.abbr, chapter)
          return {
            bookAbbr: book.abbr,
            bookName: book.name,
            chapter,
            verses,
          }
        }),
      )
      loaded.push(...batch)
    }

    setChapters(loaded)
    setAudioQueue(targets)
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
      if (
        !audio.src ||
        (audio.currentTime === audio.duration && audio.duration > 0)
      ) {
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
    setCurrentChapterIdx((i) => Math.max(0, i - 1))
    // Keep current play state so auto-play effect resumes playback
  }

  const goNext = () => {
    if (audioQueue.length === 0) return
    const audio = audioRef.current
    if (audio) audio.pause()
    setCurrentChapterIdx((i) => Math.min(audioQueue.length - 1, i + 1))
    // Keep current play state so auto-play effect resumes playback
  }

  // ─── Scroll-driven adjacent-chapter loading ─────────────────────────────
  // `chapters` is NOT a fetch cache — loadBible() already pulled the entire
  // 1189-chapter corpus into a module-scope cache before the user touched any
  // selector, and getChapter() is an in-memory lookup against it. So "loading
  // the next chapter" is a synchronous state push, not a network request; the
  // only async in the append path is awaiting the already-warm promise.
  //
  // Latest-value mirrors for the observer callbacks below. IntersectionObserver
  // callbacks are registered once per effect run and would otherwise close over
  // a stale render's state. Synced in a no-dep effect rather than during render
  // (the react-hooks/refs rule forbids the latter, and correctly so): IO
  // notifications are dispatched after the layout/effect pass for a frame, so
  // by the time any callback below fires, these refs already hold this render's
  // values.
  const chaptersRef = useRef<ChapterData[]>(chapters)
  const currentChapterIdxRef = useRef(currentChapterIdx)
  const isPlayingRef = useRef(isPlaying)
  useEffect(() => {
    chaptersRef.current = chapters
    currentChapterIdxRef.current = currentChapterIdx
    isPlayingRef.current = isPlaying
  })

  const startSentinelRef = useRef<HTMLDivElement>(null)
  const endSentinelRef = useRef<HTMLDivElement>(null)
  // Rate limiting: last append timestamp + in-flight flag. A flick-scroll can
  // fire the sentinel observer repeatedly, and every append re-renders the
  // list (and re-creates the observers), so without these the observer can
  // append a burst of chapters from a single fast swipe.
  const lastAppendAtRef = useRef(0)
  const appendBusyRef = useRef(false)
  // Chapter keys currently believed to be on screen, used by BEHAVIOUR 2 to
  // pick the topmost visible card. Keyed by chapterKey (not array index)
  // because prepending a previous chapter shifts every index below it.
  const visibleChapterKeysRef = useRef<Set<string>>(new Set())

  /**
   * Canonical neighbour of a loaded chapter — the SAME ordering the ◀ ▶
   * buttons, the `ended` handler and handleDisplay already use: `books` is the
   * canonical book array in Bible order (each BookMeta carries `index` and
   * `chapters`), and within a book chapters run 1..book.chapters. So "next"
   * is chapter+1, or the first chapter of the next book in `books` when we run
   * off the end of this one; "prev" mirrors that backwards. Returns null at
   * 創1 / 啟22 so the sentinels can render as "no more content".
   */
  const canonicalNeighbour = useCallback(
    (
      from: { abbr: string; chapter: number },
      dir: 1 | -1,
    ): { book: BookMeta; chapter: number } | null => {
      const bi = books.findIndex((b) => b.abbr === from.abbr)
      if (bi < 0) return null
      const book = books[bi]
      const nextChapter = from.chapter + dir
      if (nextChapter >= 1 && nextChapter <= book.chapters) {
        return { book, chapter: nextChapter }
      }
      // Crossed a book boundary: step to the adjacent book in canonical order.
      const nb = books[bi + dir]
      if (!nb) return null
      return { book: nb, chapter: dir === 1 ? 1 : nb.chapters }
    },
    [books],
  )

  /** Append the canonical neighbour at one end. `dir=1` → end, `-1` → start. */
  const appendAdjacent = useCallback(
    async (dir: 1 | -1) => {
      // Rate limit: one append in flight at a time, and no closer together
      // than APPEND_COOLDOWN_MS.
      if (appendBusyRef.current) return
      const now = Date.now()
      if (now - lastAppendAtRef.current < APPEND_COOLDOWN_MS) return
      const list = chaptersRef.current
      if (list.length === 0) return
      const edge = dir === 1 ? list[list.length - 1] : list[0]
      const target = canonicalNeighbour(
        { abbr: edge.bookAbbr, chapter: edge.chapter },
        dir,
      )
      if (!target) return
      // De-dupe on the chapter KEY, not on list.length: appending at both ends
      // makes length useless as a "what is loaded" signal, and a guard that
      // only compared lengths would happily re-append a chapter that is already
      // on screen in the middle of the list.
      const key = chapterKey(target.book.abbr, target.chapter)
      if (list.some((c) => chapterKey(c.bookAbbr, c.chapter) === key)) return

      appendBusyRef.current = true
      lastAppendAtRef.current = now
      try {
        const verses = await getChapter(target.book.abbr, target.chapter)
        const data: ChapterData = {
          bookAbbr: target.book.abbr,
          bookName: target.book.name,
          chapter: target.chapter,
          verses,
        }
        const playing = isPlayingRef.current
        setChapters((prev) => {
          // Re-validate inside the updater: a slow getChapter() can resolve
          // after another append already landed at this end.
          if (prev.some((c) => chapterKey(c.bookAbbr, c.chapter) === key)) {
            return prev
          }
          return dir === 1 ? [...prev, data] : [data, ...prev]
        })
        // audioQueue is index-aligned with chapters, so it grows in lockstep.
        // The existing [currentChapterIdx, audioQueue] effect will then warm
        // the mp3 for the new tail entry exactly as it already does.
        setAudioQueue((prev) =>
          dir === 1
            ? [...prev, target]
            : [{ book: target.book, chapter: target.chapter }, ...prev],
        )
        if (dir === -1 && !playing) {
          // Prepending shifts every existing index up by one. Remap the pointer
          // to the SAME chapter so the audio bar / play button keep pointing at
          // what the user last chose. When audio IS playing we deliberately skip
          // this: bumping currentChapterIdx mid-playback would reload
          // audio.src and cut the chapter off mid-sentence, which is precisely
          // what the user asked us never to do. A prepend is therefore refused
          // while playing (see the sentinel effect below).
          setCurrentChapterIdx((i) => i + 1)
        }
      } finally {
        appendBusyRef.current = false
      }
    },
    [canonicalNeighbour],
  )

  // Whether a chapter exists beyond each end — drives whether the sentinels
  // render at all (they must not imply more content at 創1 / 啟22).
  const { hasPrev, hasNext } = useMemo(() => {
    if (chapters.length === 0) return { hasPrev: false, hasNext: false }
    const first = chapters[0]
    const last = chapters[chapters.length - 1]
    return {
      hasPrev: !!canonicalNeighbour(
        { abbr: first.bookAbbr, chapter: first.chapter },
        -1,
      ),
      hasNext: !!canonicalNeighbour(
        { abbr: last.bookAbbr, chapter: last.chapter },
        1,
      ),
    }
  }, [chapters, canonicalNeighbour])

  // Sentinel observers. Two separate observers (not one callback branching on
  // direction) so the two ends get independent rootMargin and independent
  // rate-limit state, and so a prepend is simply not wired up while playing.
  useEffect(() => {
    const el = endSentinelRef.current
    if (!el || !hasNext) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void appendAdjacent(1)
      },
      { rootMargin: END_SENTINEL_MARGIN },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [appendAdjacent, hasNext])

  useEffect(() => {
    const el = startSentinelRef.current
    // Refuse to prepend while audio is playing: prepending renumbers
    // currentChapterIdx, and moving it mid-playback would reload audio.src and
    // interrupt the chapter. Skipping the prepend is the only way to honour
    // 「唔好折斷唔好停唔好跳」. Appending forward is index-safe and stays enabled.
    if (!el || !hasPrev || isPlaying) return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void appendAdjacent(-1)
      },
      { rootMargin: START_SENTINEL_MARGIN },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [appendAdjacent, hasPrev, isPlaying])

  // ─── BEHAVIOUR 2: current chapter follows the scroll — audio IDLE only ───
  // Reads the topmost chapter card that is still visible in the reading band and
  // points currentChapterIdx at it, so pressing ▶ starts from whatever chapter
  // the user is looking at. When audio is playing we return before touching any
  // state, so scrolling can never pause, skip or advance playback.
  const syncCurrentChapterToTop = useCallback(() => {
    if (isPlayingRef.current) return // audio playing → never touch the index
    const list = chaptersRef.current
    if (list.length === 0) return
    // Smallest index still visible == topmost card in canonical order.
    let topIdx = -1
    for (let i = 0; i < list.length; i++) {
      if (visibleChapterKeysRef.current.has(chapterKey(list[i].bookAbbr, list[i].chapter))) {
        topIdx = i
        break
      }
    }
    if (topIdx < 0) return
    // No-op when unchanged: React bails out on an identical value, and this is
    // what stops a repeatedly-firing observer from looping.
    if (topIdx === currentChapterIdxRef.current) return
    setCurrentChapterIdx(topIdx)
  }, [])

  // Card visibility observer. rootMargin pulls the top edge down past the fixed
  // audio bar (72px) plus a little breathing room, so a card counts as "the one
  // you are looking at" only once it is clear of the bar. threshold 0 with
  // integer-ish deltas keeps this to one notification per boundary crossing.
  useEffect(() => {
    if (chapters.length === 0) return
    const nodes = Array.from(
      document.querySelectorAll<HTMLElement>('[data-read-chapter]'),
    )
    if (nodes.length === 0) return
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const key = (entry.target as HTMLElement).dataset.readChapter
          if (!key) continue
          if (entry.isIntersecting) visibleChapterKeysRef.current.add(key)
          else visibleChapterKeysRef.current.delete(key)
        }
        syncCurrentChapterToTop()
      },
      { rootMargin: `-${TOP_CHAPTER_BAND_PX}px 0px 0px 0px`, threshold: 0 },
    )
    nodes.forEach((n) => io.observe(n))
    return () => io.disconnect()
  }, [chapters, syncCurrentChapterToTop])

  // When playback stops (⏸ or the queue ending), the visible set was frozen
  // while playing, so re-derive the index from the CURRENT scroll position
  // rather than waiting for the next intersection change.
  useEffect(() => {
    if (isPlaying) return
    syncCurrentChapterToTop()
  }, [isPlaying, syncCurrentChapterToTop])

  // ─── Complete today reading ──────────────────────────────────────────────
  const handleComplete = async () => {
    if (!enrollment || !profile || audioQueue.length === 0) {
      alert(
        `Debug: enrollment=${enrollment?.id} profile=${!!profile} audioQueue=${audioQueue.length}`,
      )
      return
    }
    if (!enrollment.id) {
      alert('錯誤：enrollment.id 為空，請重新整理頁面')
      return
    }
    setIsCompleting(true)
    try {
      // Use markDayCompleteBatch: single round-trip, server-side XP sum
      // (10 XP per chapter). The previous per-chapter markLessonComplete
      // approach awarded only 10 XP for the first chapter and 0 for the rest.
      const today = new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Hong_Kong',
      })
      const refs = audioQueue.map((item) => `${item.book.name} ${item.chapter}`)
      const result = await markDayCompleteBatch(enrollment.id, refs, today)
      if (!result.success) {
        alert(`寫入失敗: ${result.error || 'unknown'}`)
        setIsCompleting(false)
        return
      }
      const insertedCount = result.insertedCount ?? refs.length

      // Sync group check-ins AFTER inserts
      await checkInAllMyGroups(today)
      celebrate({
        type: 'burst',
        particleCount: Math.min(insertedCount * 30, 180),
      })
      setTodaySession({
        id: 'new',
        enrollment_id: enrollment.id,
        chapter_ref: refs[0],
        date_local: today,
      })

      // Refresh local stats from markDayCompleteBatch's authoritative return —
      // it already scanned reading_sessions to update user_stats, so calling
      // recalcUserStatsAfterCompletion() here would repeat that full-table
      // scan (up to ~1189 rows) for identical numbers.
      if (typeof result.totalXp === 'number' && typeof result.level === 'number') {
        setProfile((prev: any) =>
          prev
            ? {
                ...prev,
                total_xp: result.totalXp,
                level: result.level,
                current_streak: result.currentStreak ?? prev.current_streak,
              }
            : prev,
        )
      } else {
        // Fallback for the shape-only path (should not happen).
        const fresh = await recalcUserStatsAfterCompletion(today)
        if (fresh.success) {
          setProfile((prev: any) =>
            prev
              ? {
                  ...prev,
                  total_xp: fresh.totalXp,
                  level: fresh.level,
                  current_streak: fresh.currentStreak,
                }
              : prev,
          )
        } else {
          console.error('[handleComplete] stats recalc failed:', fresh.error)
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
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: C.bgPrimary,
        }}
      >
        <div style={{ color: C.textMuted }}>載入中...</div>
      </div>
    )
  }

  // In single-chapter mode the end half is not part of the selection at all.
  const canDisplay = rangeMode
    ? startBook && startChapter && endBook && endChapter
    : startBook && startChapter
  // Label: single mode reads 「顯示經文（詩篇53章）」; range mode keeps the
  // existing two-half label so nothing a user is used to reading changes.
  const displayLabel = !rangeMode
    ? startBook && startChapter
      ? `（${startBook.name}${startChapter}章）`
      : ''
    : startBook && startChapter && endBook && endChapter
      ? `（${startBook.name}${startChapter}章${startBook.abbr !== endBook.abbr ? ` - ${endBook.name}${endChapter}章` : ` - 第${endChapter}章`}）`
      : ''
  const catOf = (abbr: string) => bookToCategory[abbr] ?? null
  const catData = (abbr: string) => BOOK_CATEGORIES[catOf(abbr) ?? 'gospels']

  const todayBook = audioQueue[currentChapterIdx]?.book
  const todayChapter = audioQueue[currentChapterIdx]?.chapter

  return (
    <div
      ref={rootRef}
      style={
        {
          minHeight: '100vh',
          background: C.bgPrimary,
          paddingTop: '72px',
          paddingBottom: '90px',
          // Initial value; later A+/A− taps mutate this property in place via
          // setProperty, bypassing React entirely.
          '--read-font-size': '20px',
        } as CSSProperties
      }
    >
      <audio ref={audioRef} preload="auto" />

      {/* ── Fixed Top Audio Bar ──────────────────────────────────────── */}
      <div
        id="audioBar"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: '52px',
          background: 'rgba(245,240,232,0.97)',
          backdropFilter: 'blur(8px)',
          borderBottom: `1px solid ${C.borderColor}`,
          zIndex: 1000,
          boxShadow: '0 2px 12px rgba(61,41,20,0.06)',
          display: 'flex',
          alignItems: 'center',
          padding: '0 10px',
          gap: '8px',
          overflowX: 'auto',
          overflowY: 'hidden',
          WebkitOverflowScrolling: 'touch',
          scrollbarWidth: 'none',
        }}
      >
        {/* Chapter display */}
        <div
          style={{
            minWidth: '72px',
            maxWidth: '110px',
            padding: '5px 10px',
            background: C.bgSecondary,
            border: `1px solid ${C.borderColor}`,
            borderRadius: '6px',
            fontFamily: 'Georgia, serif',
            fontSize: '0.8rem',
            color: C.textPrimary,
            flexShrink: 0,
            textAlign: 'center',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {currentAudioItem
            ? getAudioLabel(currentAudioItem.book, currentAudioItem.chapter)
            : '太 1章'}
        </div>

        {/* Prev — smaller icon button */}
        <button
          onClick={goPrev}
          title="上一章"
          className="ab-prev ab-btn"
          style={{
            width: '28px',
            height: '28px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: `1px solid ${C.borderColor}`,
            borderRadius: '50%',
            color: C.textSecondary,
            cursor: 'pointer',
            fontSize: '0.8rem',
            transition: 'all 0.2s',
            padding: 0,
          }}
        >
          ◀
        </button>

        {/* Play/Pause */}
        <button
          onClick={togglePlay}
          title={isPlaying ? '暫停' : '播放'}
          className="ab-play ab-btn"
          style={{
            width: '38px',
            height: '38px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: isPlaying ? C.accentGold : C.bgCard,
            border: `1px solid ${isPlaying ? C.accentGold : C.borderColor}`,
            borderRadius: '50%',
            color: isPlaying ? 'white' : C.textPrimary,
            cursor: 'pointer',
            fontSize: '1rem',
            transition: 'all 0.2s',
            padding: 0,
          }}
        >
          {isPlaying ? '⏸' : '▶'}
        </button>

        {/* Next — smaller icon button */}
        <button
          onClick={goNext}
          title="下一章"
          className="ab-next ab-btn"
          style={{
            width: '28px',
            height: '28px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'transparent',
            border: `1px solid ${C.borderColor}`,
            borderRadius: '50%',
            color: C.textSecondary,
            cursor: 'pointer',
            fontSize: '0.8rem',
            transition: 'all 0.2s',
            padding: 0,
          }}
        >
          ▶
        </button>

        {/* Speed dropdown */}
        <select
          value={playbackRate}
          onChange={(e) => {
            const rate = parseFloat(e.target.value)
            setPlaybackRate(rate)
            playbackRateRef.current = rate
            if (audioRef.current) audioRef.current.playbackRate = rate
          }}
          className="ab-speed"
          style={{
            appearance: 'none',
            WebkitAppearance: 'none',
            background: `${C.bgCard} url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%236B5344' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E") no-repeat right 6px center`,
            border: `1px solid ${C.borderColor}`,
            borderRadius: '20px',
            padding: '5px 22px 5px 10px',
            fontSize: '0.78rem',
            fontFamily: 'inherit',
            color: C.textPrimary,
            cursor: 'pointer',
            minWidth: '54px',
            textAlign: 'center',
            flexShrink: 0,
            outline: 'none',
          }}
        >
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>

        {/* Font size A− */}
        <button
          onClick={() => setFontSize(fontSizeRef.current - 2)}
          title="縮小字體"
          className="ab-font-dec ab-btn"
          style={{
            width: '26px',
            height: '26px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: C.bgCard,
            border: `1px solid ${C.borderColor}`,
            borderRadius: '50%',
            color: C.textSecondary,
            cursor: 'pointer',
            fontSize: '0.7rem',
            fontWeight: 700,
            transition: 'all 0.2s',
            padding: 0,
          }}
        >
          A−
        </button>

        {/* Font size A+ */}
        <button
          onClick={() => setFontSize(fontSizeRef.current + 2)}
          title="放大字體"
          className="ab-font-inc ab-btn"
          style={{
            width: '26px',
            height: '26px',
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: C.bgCard,
            border: `1px solid ${C.borderColor}`,
            borderRadius: '50%',
            color: C.textSecondary,
            cursor: 'pointer',
            fontSize: '0.8rem',
            fontWeight: 700,
            transition: 'all 0.2s',
            padding: 0,
          }}
        >
          A+
        </button>
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
      <div
        style={{ maxWidth: '900px', margin: '0 auto', padding: '20px 16px' }}
      >
        {/* ── Range Selector ─────────────────────────────────────── */}
        <div
          style={{
            background: C.bgCard,
            borderRadius: '10px',
            padding: '20px',
            boxShadow: '0 2px 12px rgba(61,41,20,0.06)',
            border: `1px solid ${C.borderLight}`,
            marginBottom: '20px',
          }}
        >
          <div
            style={{
              fontFamily: 'Georgia, serif',
              fontSize: '1.8rem',
              color: C.textPrimary,
              marginBottom: '4px',
              fontWeight: 600,
            }}
          >
            📖 聖經朗讀
          </div>
          <div
            style={{
              color: C.textMuted,
              fontSize: '0.9rem',
              marginBottom: '20px',
            }}
          >
            選擇書卷和章節範圍，或直接使用今日功課
          </div>

          {/* Today reading hint */}
          {todaySession ? (
            <div
              style={{
                padding: '10px 14px',
                background: `${C.success}15`,
                border: `1px solid ${C.success}40`,
                borderRadius: '8px',
                color: C.success,
                fontSize: '0.9rem',
                fontWeight: 500,
                marginBottom: '16px',
                textAlign: 'center',
              }}
            >
              ✅ 今日讀經已完成：{todaySession.chapter_ref}
            </div>
          ) : (
            audioQueue.length > 0 && (
              <div
                style={{
                  padding: '10px 14px',
                  background: `${C.accentGold}15`,
                  border: `1px solid ${C.accentGold}40`,
                  borderRadius: '8px',
                  color: C.chapterTitle,
                  fontSize: '0.9rem',
                  fontWeight: 500,
                  marginBottom: '16px',
                  textAlign: 'center',
                }}
              >
                📖 今日功課：
                {todayRequiredRefs.length > 0
                  ? `${todayRequiredRefs.length}章`
                  : `${todayBook?.name} ${todayChapter} 章`}
                {todayRequiredRefs.length > 0 &&
                  ` · ${todayRequiredRefs.join('、')}`}
              </div>
            )
          )}

          {/* Read mode toggle: 直接跳到 (default) vs 範圍.
              A real <button role="switch" aria-checked> with visible text and a
              44px min-height — the deferred 56px touch-target upgrade is a
              separate task, so this deliberately stops at 44px. */}
          <button
            type="button"
            role="switch"
            aria-checked={rangeMode}
            onClick={handleToggleRangeMode}
            style={{
              width: '100%',
              minHeight: '44px',
              marginBottom: '16px',
              padding: '10px 14px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '10px',
              background: C.bgInput,
              border: `1px solid ${rangeMode ? C.accentGold : C.borderColor}`,
              borderRadius: '8px',
              color: C.textPrimary,
              fontSize: '0.95rem',
              fontWeight: 500,
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            <span>{rangeMode ? '範圍' : '直接跳到'}</span>
            <span style={{ fontSize: '0.78rem', color: C.textMuted }}>
              {rangeMode ? '閱讀多章範圍' : '閱讀單一章節'}
            </span>
            <span
              style={{
                fontSize: '0.7rem',
                color: C.accentGold,
                fontWeight: 700,
              }}
            >
              {rangeMode ? '切換至直接跳到 ▸' : '切換至範圍 ▸'}
            </span>
          </button>

          {/* Start selector */}
          <div style={{ marginBottom: '16px' }}>
            <div
              style={{
                fontSize: '0.85rem',
                color: C.textSecondary,
                marginBottom: '6px',
                fontWeight: 500,
              }}
            >
              {rangeMode ? '起始書卷與章節' : '書卷與章節'}
            </div>
            <div style={{ display: 'flex', gap: '12px' }}>
              {/* Start book dropdown */}
              <div style={{ position: 'relative', flex: 2 }}>
                <div
                  onClick={() => {
                    setShowStartBookGrid((v) => !v)
                    setShowStartChapterGrid(false)
                    setSetShowEndBookGrid(false)
                    setSetShowEndChapterGrid(false)
                  }}
                  style={{
                    padding: '10px 14px',
                    background: C.bgInput,
                    border: `1px solid ${C.borderColor}`,
                    borderRadius: '8px',
                    cursor: 'pointer',
                    color: startBook ? C.textPrimary : C.textMuted,
                    fontSize: '0.95rem',
                    minHeight: '44px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    userSelect: 'none',
                  }}
                >
                  <span>
                    {startBook
                      ? `${startBook.name}${startChapter ? ` 第${startChapter}章` : ''}`
                      : '選擇起始書卷'}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: C.textMuted }}>
                    ▼
                  </span>
                </div>
                {/* Book grid dropdown */}
                {showStartBookGrid && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '100%',
                      left: 0,
                      right: 0,
                      zIndex: 200,
                      background: C.bgCard,
                      border: `1px solid ${C.borderColor}`,
                      borderRadius: '8px',
                      padding: '8px',
                      boxShadow: '0 4px 16px rgba(61,41,20,0.12)',
                      maxHeight: '300px',
                      overflowY: 'auto',
                    }}
                  >
                    {Object.entries(BOOK_CATEGORIES).map(([cat, data]) => (
                      <div key={cat}>
                        <div
                          style={{
                            fontSize: '0.75rem',
                            color: data.text,
                            fontWeight: 600,
                            padding: '4px 6px',
                            marginTop: '6px',
                            marginBottom: '4px',
                            opacity: 0.8,
                          }}
                        >
                          {data.name}
                        </div>
                        <div
                          style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(6, 1fr)',
                            gap: '4px',
                          }}
                        >
                          {data.books.map((abbr) => (
                            <div
                              key={abbr}
                              onClick={() => {
                                const b = books.find((x) => x.abbr === abbr)
                                if (b) handleStartBookClick(b)
                              }}
                              style={{
                                padding: '6px 2px',
                                textAlign: 'center',
                                borderRadius: '5px',
                                cursor: 'pointer',
                                fontSize: '0.8rem',
                                fontWeight: 500,
                                background: data.bg,
                                color: data.text,
                                border:
                                  startBook?.abbr === abbr
                                    ? `2px solid ${C.accentGold}`
                                    : '2px solid transparent',
                              }}
                            >
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

          {/* End selector — range mode only. In single-chapter mode this block
              is not rendered at all, which is what removes the duplicated
              "pick the book and chapter again" step. */}
          {rangeMode && startBook && startChapter && (
            <div style={{ marginBottom: '16px' }}>
              <div
                style={{
                  fontSize: '0.85rem',
                  color: C.textSecondary,
                  marginBottom: '6px',
                  fontWeight: 500,
                }}
              >
                結束書卷與章節
              </div>
              <div style={{ display: 'flex', gap: '12px' }}>
                <div style={{ position: 'relative', flex: 2 }}>
                  <div
                    onClick={() => {
                      setSetShowEndBookGrid((v) => !v)
                      setSetShowEndChapterGrid(false)
                      setShowStartBookGrid(false)
                      setShowStartChapterGrid(false)
                    }}
                    style={{
                      padding: '10px 14px',
                      background: C.bgInput,
                      border: `1px solid ${C.borderColor}`,
                      borderRadius: '8px',
                      cursor: 'pointer',
                      color: endBook ? C.textPrimary : C.textMuted,
                      fontSize: '0.95rem',
                      minHeight: '44px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      userSelect: 'none',
                    }}
                  >
                    <span>
                      {endBook
                        ? `${endBook.name}${endChapter ? ` 第${endChapter}章` : ''}`
                        : '選擇結束書卷'}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: C.textMuted }}>
                      ▼
                    </span>
                  </div>
                  {showEndBookGrid && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '100%',
                        left: 0,
                        right: 0,
                        zIndex: 200,
                        background: C.bgCard,
                        border: `1px solid ${C.borderColor}`,
                        borderRadius: '8px',
                        padding: '8px',
                        boxShadow: '0 4px 16px rgba(61,41,20,0.12)',
                        maxHeight: '300px',
                        overflowY: 'auto',
                      }}
                    >
                      {Object.entries(BOOK_CATEGORIES).map(([cat, data]) => {
                        const startIdx = books.findIndex(
                          (b) => b.abbr === startBook.abbr,
                        )
                        const catBooks = data.books
                        return (
                          <div key={cat}>
                            <div
                              style={{
                                fontSize: '0.75rem',
                                color: data.text,
                                fontWeight: 600,
                                padding: '4px 6px',
                                marginTop: '6px',
                                marginBottom: '4px',
                                opacity: 0.8,
                              }}
                            >
                              {data.name}
                            </div>
                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: 'repeat(6, 1fr)',
                                gap: '4px',
                              }}
                            >
                              {catBooks.map((abbr) => {
                                const idx = books.findIndex(
                                  (b) => b.abbr === abbr,
                                )
                                const disabled = idx < startIdx
                                return (
                                  <div
                                    key={abbr}
                                    onClick={() => {
                                      if (!disabled) {
                                        const b = books.find(
                                          (x) => x.abbr === abbr,
                                        )
                                        if (b) handleEndBookClick(b)
                                      }
                                    }}
                                    style={{
                                      padding: '6px 2px',
                                      textAlign: 'center',
                                      borderRadius: '5px',
                                      cursor: disabled
                                        ? 'not-allowed'
                                        : 'pointer',
                                      fontSize: '0.8rem',
                                      fontWeight: 500,
                                      background: disabled
                                        ? C.bgSecondary
                                        : data.bg,
                                      color: disabled ? C.textMuted : data.text,
                                      opacity: disabled ? 0.4 : 1,
                                      border:
                                        endBook?.abbr === abbr
                                          ? `2px solid ${C.accentGold}`
                                          : '2px solid transparent',
                                    }}
                                  >
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
            <div
              style={{
                background: C.bgCard,
                border: `1px solid ${C.borderColor}`,
                borderRadius: '8px',
                padding: '10px',
                marginBottom: '12px',
                boxShadow: '0 2px 8px rgba(61,41,20,0.08)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  color: C.textSecondary,
                  textAlign: 'center',
                  paddingBottom: '8px',
                  borderBottom: `1px solid ${C.borderColor}`,
                  marginBottom: '8px',
                }}
              >
                {startBook.name} — 選擇起始章節
              </div>
              {/* Length hint so the user knows what they are scrolling into
                  before they scroll. 詩篇 = 共 150 章. */}
              <div
                style={{
                  fontSize: '0.75rem',
                  color: C.textMuted,
                  textAlign: 'center',
                  marginBottom: '6px',
                }}
              >
                共 {startBook.chapters} 章
              </div>
              <div
                role="group"
                aria-label="章碼"
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(auto-fill, ${CHAPTER_GRID_MINMAX})`,
                  gap: '4px',
                  maxHeight: CHAPTER_GRID_MAX_HEIGHT,
                  overflowY: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  overscrollBehavior: 'contain',
                }}
              >
                {Array.from(
                  { length: startBook.chapters },
                  (_, i) => i + 1,
                ).map((ch) => (
                  <div
                    key={ch}
                    role="button"
                    tabIndex={0}
                    aria-pressed={startChapter === ch}
                    onClick={() => handleStartChapterClick(ch)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        handleStartChapterClick(ch)
                      }
                    }}
                    style={{
                      minHeight: '44px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '8px 4px',
                      textAlign: 'center',
                      borderRadius: '4px',
                      cursor: 'pointer',
                      background:
                        startChapter === ch ? C.accentGold : C.bgSecondary,
                      color: startChapter === ch ? 'white' : C.textPrimary,
                      fontSize: '0.88rem',
                      transition: 'all 0.15s',
                      border:
                        startChapter === ch
                          ? `1px solid ${C.accentGold}`
                          : '1px solid transparent',
                    }}
                  >
                    {ch}
                  </div>
                ))}
              </div>
            </div>
          )}

          {showEndChapterGrid && endBook && (
            <div
              style={{
                background: C.bgCard,
                border: `1px solid ${C.borderColor}`,
                borderRadius: '8px',
                padding: '10px',
                marginBottom: '12px',
                boxShadow: '0 2px 8px rgba(61,41,20,0.08)',
              }}
            >
              <div
                style={{
                  fontSize: '0.8rem',
                  color: C.textSecondary,
                  textAlign: 'center',
                  paddingBottom: '8px',
                  borderBottom: `1px solid ${C.borderColor}`,
                  marginBottom: '8px',
                }}
              >
                {endBook.name} — 選擇結束章節
              </div>
              <div
                style={{
                  fontSize: '0.75rem',
                  color: C.textMuted,
                  textAlign: 'center',
                  marginBottom: '6px',
                }}
              >
                共 {endBook.chapters} 章
              </div>
              <div
                role="group"
                aria-label="章碼"
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(auto-fill, ${CHAPTER_GRID_MINMAX})`,
                  gap: '4px',
                  maxHeight: CHAPTER_GRID_MAX_HEIGHT,
                  overflowY: 'auto',
                  WebkitOverflowScrolling: 'touch',
                  overscrollBehavior: 'contain',
                }}
              >
                {Array.from({ length: endBook.chapters }, (_, i) => i + 1).map(
                  (ch) => {
                    const disabled =
                      startBook?.abbr === endBook.abbr &&
                      ch < (startChapter ?? 0)
                    return (
                      <div
                        key={ch}
                        role="button"
                        tabIndex={0}
                        aria-disabled={disabled}
                        aria-pressed={!disabled && endChapter === ch}
                        onClick={() => !disabled && handleEndChapterClick(ch)}
                        onKeyDown={(e) => {
                          if (
                            !disabled &&
                            (e.key === 'Enter' || e.key === ' ')
                          ) {
                            e.preventDefault()
                            handleEndChapterClick(ch)
                          }
                        }}
                        style={{
                          minHeight: '44px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '8px 4px',
                          textAlign: 'center',
                          borderRadius: '4px',
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          background: disabled
                            ? C.bgSecondary
                            : endChapter === ch
                              ? C.accentGold
                              : C.bgSecondary,
                          color: disabled
                            ? C.textMuted
                            : endChapter === ch
                              ? 'white'
                              : C.textPrimary,
                          fontSize: '0.88rem',
                          transition: 'all 0.15s',
                          opacity: disabled ? 0.4 : 1,
                          border:
                            endChapter === ch
                              ? `1px solid ${C.accentGold}`
                              : '1px solid transparent',
                        }}
                      >
                        {ch}
                      </div>
                    )
                  },
                )}
              </div>
            </div>
          )}

          {/* Display button */}
          <button
            onClick={handleDisplay}
            disabled={!canDisplay || scriptureLoading}
            style={{
              width: '100%',
              padding: '14px',
              background: canDisplay ? C.accentGold : `${C.borderColor}60`,
              border: 'none',
              borderRadius: '8px',
              color: canDisplay ? 'white' : C.textMuted,
              fontSize: '1.05rem',
              fontWeight: 600,
              cursor: canDisplay ? 'pointer' : 'not-allowed',
              transition: 'all 0.2s',
              boxShadow: canDisplay
                ? '0 4px 12px rgba(201,168,76,0.3)'
                : 'none',
            }}
          >
            {scriptureLoading
              ? '載入經文中...'
              : `📖 顯示經文${displayLabel}`}
          </button>

          {/* Verse number toggle */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              marginTop: '12px',
            }}
          >
            <input
              type="checkbox"
              checked={showVerseNumbers}
              onChange={(e) => setShowVerseNumbers(e.target.checked)}
              style={{
                accentColor: C.accentGold,
                width: '16px',
                height: '16px',
                cursor: 'pointer',
              }}
            />
            <span style={{ fontSize: '0.85rem', color: C.textSecondary }}>
              顯示經節號碼
            </span>
          </div>
        </div>

        {/* ── Scripture Display ─────────────────────────────────── */}
        {chapters.length > 0 && (
          <div>
            {/* Start sentinel — appends the PREVIOUS canonical chapter. Rendered
                only when a previous chapter actually exists, so scrolling to
                創1 does not suggest content before 創1. */}
            {hasPrev && (
              <div
                ref={startSentinelRef}
                data-read-sentinel="start"
                style={{ height: '1px', width: '100%' }}
                aria-hidden="true"
              />
            )}
            {chapters.map((chapter, idx) => {
              // Detect testament by book category (NT = gospels/pauline/general, OT = everything else)
              const isNT = ['gospels', 'pauline', 'general'].includes(
                bookToCategory[chapter.bookAbbr] || '',
              )
              const testament = isNT ? 'NT' : 'OT'
              const testamentBg = isNT ? '#E8D5F0' : '#FFE5C2'
              const testamentText = isNT ? '#5C2A6D' : '#8B4513'
              const totalChapters = audioQueue.length
              return (
                <div
                  key={`${chapter.bookAbbr}-${chapter.chapter}`}
                  data-read-chapter={chapterKey(
                    chapter.bookAbbr,
                    chapter.chapter,
                  )}
                  style={
                    {
                      background: C.bgCard,
                      borderRadius: '10px',
                      padding: '20px',
                      marginBottom: '20px',
                      border: `1px solid ${C.borderLight}`,
                      borderLeft: `4px solid ${C.accentGold}`,
                      boxShadow: '0 2px 8px rgba(61,41,20,0.06)',
                      position: 'relative',
                      // Each chapter is its own card, so off-screen cards can skip
                      // layout/paint. `auto` in containIntrinsicSize lets the
                      // browser learn the real size after first render, which
                      // keeps the scrollbar honest.
                      contentVisibility: 'auto',
                      containIntrinsicSize: 'auto 700px',
                    } as CSSProperties
                  }
                >
                  <span
                    style={{
                      position: 'absolute',
                      top: '12px',
                      right: '12px',
                      background: testamentBg,
                      color: testamentText,
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      padding: '3px 8px',
                      borderRadius: '6px',
                    }}
                  >
                    {testament} · 第 {idx + 1}/{totalChapters} 章
                  </span>
                  <h2
                    style={{
                      fontFamily: 'Georgia, serif',
                      fontSize: '1.3em',
                      fontWeight: 600,
                      color: C.chapterTitle,
                      marginBottom: '16px',
                      paddingBottom: '10px',
                      paddingRight: '90px', // leave room for badge
                      borderBottom: `1px solid ${C.borderColor}`,
                    }}
                  >
                    {chapter.bookName} {chapter.chapter} 章
                  </h2>
                  {chapter.verses.map(([num, text]) => (
                    <div
                      key={num}
                      style={{
                        marginBottom: '12px',
                        display: 'flex',
                        gap: '12px',
                        alignItems: 'flex-start',
                      }}
                    >
                      {showVerseNumbers && (
                        <span
                          style={{
                            fontFamily: 'Georgia, serif',
                            color: C.verseNumber,
                            fontWeight: 500,
                            fontSize: '0.75em',
                            minWidth: '2.5em',
                            textAlign: 'right',
                            flexShrink: 0,
                            paddingTop: '2px',
                          }}
                        >
                          {num}
                        </span>
                      )}
                        <span
                          style={{
                            flex: 1,
                            color: C.textPrimary,
                            lineHeight: 1.9,
                          fontSize: 'var(--read-font-size)',
                        }}
                      >
                        {text}
                      </span>
                    </div>
                  ))}
                </div>
              )
            })}

            {/* End sentinel — appends the NEXT canonical chapter. Positioned
                after the last card but BEFORE the 完成讀經 button, so the
                observer fires as the last card approaches the fold rather than
                only after the reader scrolls past the CTA. Not rendered at the
                final chapter of the final book, so it never implies content
                that does not exist. */}
            {hasNext && (
              <div
                ref={endSentinelRef}
                data-read-sentinel="end"
                style={{ height: '1px', width: '100%' }}
                aria-hidden="true"
              />
            )}

            {/* Complete button — only show when all today's required chapters are loaded */}
            {audioQueue.length > 0 && (
              <button
                onClick={handleComplete}
                disabled={!!todaySession || isCompleting || !allRequiredLoaded}
                style={{
                  width: '100%',
                  padding: '16px',
                  background: todaySession
                    ? C.success
                    : allRequiredLoaded
                      ? C.accentGold
                      : C.borderColor,
                  border: 'none',
                  borderRadius: '10px',
                  color: todaySession
                    ? 'white'
                    : allRequiredLoaded
                      ? 'white'
                      : C.textMuted,
                  fontSize: '1.1rem',
                  fontWeight: 700,
                  cursor:
                    todaySession || isCompleting || !allRequiredLoaded
                      ? 'default'
                      : 'pointer',
                  transition: 'all 0.2s',
                  marginBottom: '20px',
                  boxShadow:
                    allRequiredLoaded && !todaySession
                      ? '0 4px 12px rgba(201,168,76,0.3)'
                      : 'none',
                  opacity: isCompleting ? 0.7 : 1,
                }}
              >
                {todaySession
                  ? '✅ 今日讀經已完成'
                  : isCompleting
                    ? '處理中...'
                    : allRequiredLoaded
                      ? `完成讀經 ✓（+${todayRequiredRefs.length * 10} XP）`
                      : `需完成 ${todayRequiredRefs.length} 章才能標記完成`}
              </button>
            )}
          </div>
        )}

        {/* Empty state */}
        {chapters.length === 0 && !scriptureLoading && (
          <div
            style={{
              textAlign: 'center',
              padding: '40px 20px',
              color: C.textMuted,
              background: C.bgCard,
              borderRadius: '10px',
              border: `1px solid ${C.borderLight}`,
            }}
          >
            <div style={{ fontSize: '3rem', marginBottom: '12px' }}>📖</div>
            <div
              style={{
                fontSize: '1.1rem',
                fontWeight: 600,
                color: C.textSecondary,
                marginBottom: '8px',
              }}
            >
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
