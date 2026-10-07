// components/ultimate-intention/ChapterReader.tsx
//
// 'use client' — needs the audio element, font scaling and script state.
//
// DESIGN INTENT vs app/(main)/read/page.tsx
// The scripture reader is 2644 lines because it handles a 3112-chapter corpus,
// plan arithmetic, catch-up, completion tracking and bidirectional scroll
// append. None of that applies to a 28-chapter book, so this is a clean
// implementation rather than a copy — but the AUDIO BAR GEOMETRY is imported
// from the same constants the scripture reader uses, so the two readers feel
// identical in the hand:
//
//   AUDIO_BAR_BTN  32  secondary controls
//   AUDIO_BAR_PLAY 40  the play button, deliberately the largest
//   AUDIO_BAR_H    = 40 + 8*2 = 56  total bar height
//
// The face/target rule from that file is preserved: every control's DRAWN face
// equals its TOUCH TARGET. A 44px transparent button around an unchanged 28px
// circle satisfied the letter of the accessibility rule while the user saw no
// change, and that is the exact failure this must not repeat.

'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import ScriptToggle from './ScriptToggle'

// ─── Geometry (mirrors app/(main)/read/page.tsx) ─────────────────────────────
const BTN = 32
const PLAY = 40
const PAD_Y = 8
const BAR_H = PLAY + PAD_Y * 2
const CLEAR_PX = BAR_H + 6

const SPEEDS = [1, 1.25, 1.5, 1.75, 2] as const

// Font scale as a MULTIPLIER on .scripture-text's 1.125rem base (18px, per
// DESIGN.md typography.scripture). Previously this was an absolute rem value
// applied to a 1rem base, so the reader rendered 16px while the scripture reader
// rendered 18px — the user read the difference as 「字體比聖經朗讀版面小」.
const FONT_MIN = 0.85 // ≈15.3px
const FONT_MAX = 1.5 // ≈27px
const FONT_STEP = 0.1

type Block = { type: 'p'; text: string } | { type: 'img'; src: string }

type Chapter = {
  num: number
  label: string
  title: Record<string, string>
  lang: string
  blocks: Block[]
}

type Props = {
  chapter: Chapter
  total: number
  bookTitle: Record<string, string>
  lang: 'zh-Hant' | 'zh-Hans'
  hasAudio: boolean
  prevHref: string | null
  nextHref: string | null
  indexHref: string
}

export default function ChapterReader({
  chapter,
  total,
  bookTitle,
  lang,
  hasAudio,
  prevHref,
  nextHref,
  indexHref,
}: Props) {
  const router = useRouter()
  const audioRef = useRef<HTMLAudioElement>(null)

  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [font, setFont] = useState(1)

  // The article must start below the fixed bar, or the first line hides under it.
  const [padTop, setPadTop] = useState(false)
  useEffect(() => {
    const onScroll = () => setPadTop(window.scrollY > 80)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  const src = hasAudio
    ? `/ultimate-intention/audio/${lang}/${String(chapter.num).padStart(2, '0')}.mp3`
    : ''

  const toggle = useCallback(() => {
    const a = audioRef.current
    if (!a || !src) return
    if (a.paused) {
      void a.play().catch(() => setPlaying(false))
    } else {
      a.pause()
    }
  }, [src])

  // Restore position when returning from a neighbour chapter, so 「上一章」
  // does not dump the reader at the top of a long chapter.
  const restoreKey = useMemo(
    () => `ui-book-pos-${chapter.num}-${lang}`,
    [chapter.num, lang],
  )
  useEffect(() => {
    const y = Number(sessionStorage.getItem(restoreKey) ?? '0')
    if (y > 0) requestAnimationFrame(() => window.scrollTo(0, y))
  }, [restoreKey])

  useEffect(() => {
    const save = () =>
      sessionStorage.setItem(restoreKey, String(window.scrollY))
    window.addEventListener('pagehide', save)
    return () => {
      save()
      window.removeEventListener('pagehide', save)
    }
  }, [restoreKey])

  const goto = (href: string) => {
    sessionStorage.setItem(restoreKey, String(window.scrollY))
    router.push(href)
  }

  const bodyFont = font

  return (
    <>
      {src && (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onRateChange={(e) => setSpeed(e.currentTarget.playbackRate)}
        />
      )}

      {/* ── Fixed bar ──────────────────────────────────────────────────────
          Rendered unconditionally. Playback and speed require audio, but font
          size does not, and the user reported 「沒有辦法調較字體大小」 while the
          book had no mp3 yet — gating the controls on hasAudio hid the only
          adjustment that was available. */}
      <div
        className="fixed inset-x-0 z-40 border-b border-[var(--color-border)] bg-[var(--color-surface)]"
        style={{ height: BAR_H }}
        role="region"
        aria-label="朗讀控制"
      >
        <div
          className="max-w-3xl mx-auto px-3 flex items-center gap-2"
          style={{ height: BAR_H }}
        >
          <BarBtn
            onClick={toggle}
            disabled={!src}
            face={PLAY}
            circular
            ariaLabel={!src ? '朗讀尚未備妥' : playing ? '暫停' : '朗讀'}
            primary
          >
            {playing ? (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="6" y="5" width="4" height="14" rx="1" />
                <rect x="14" y="5" width="4" height="14" rx="1" />
              </svg>
            ) : (
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                aria-hidden="true"
              >
                <path d="M8 5.14v13.72a1 1 0 0 0 1.54.84l10.3-6.86a1 1 0 0 0 0-1.68L9.54 4.3A1 1 0 0 0 8 5.14z" />
              </svg>
            )}
          </BarBtn>

          <BarBtn
            onClick={() => (prevHref ? goto(prevHref) : goto(indexHref))}
            ariaLabel={prevHref ? '上一篇' : '返回目錄'}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="15 18 9 12 15 6" />
            </svg>
          </BarBtn>

          <BarBtn
            onClick={() => (nextHref ? goto(nextHref) : goto(indexHref))}
            ariaLabel={nextHref ? '下一篇' : '返回目錄'}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </BarBtn>

          <select
            value={speed}
            onChange={(e) => {
              const v = Number(e.target.value)
              setSpeed(v)
              if (audioRef.current) audioRef.current.playbackRate = v
            }}
            disabled={!src}
            aria-label="朗讀速度"
            className="ml-auto rounded-md border border-[var(--color-border)] bg-transparent px-2 text-sm disabled:opacity-40"
            style={{ height: BTN }}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}x
              </option>
            ))}
          </select>

          <BarBtn
            onClick={() =>
              setFont((f) => Math.max(FONT_MIN, +(f - FONT_STEP).toFixed(2)))
            }
            ariaLabel="縮小字體"
          >
            <span style={{ fontSize: '0.72rem', fontWeight: 800 }}>A−</span>
          </BarBtn>
          <BarBtn
            onClick={() =>
              setFont((f) => Math.min(FONT_MAX, +(f + FONT_STEP).toFixed(2)))
            }
            ariaLabel="放大字體"
          >
            <span style={{ fontSize: '0.95rem', fontWeight: 800 }}>A+</span>
          </BarBtn>
        </div>
      </div>

      {/* ── Article ─────────────────────────────────────────────────────── */}
      {/* DESIGN.md §Typography: "Scripture / Reading (chapter text): serif,
          generous line-height, monochrome ink on warm white." The previous
          version used the sans stack on --color-background, which contradicted
          the spec's two-zone rule and read as UI chrome rather than text. It
          also sized type inline off a 1rem base, landing at 16px instead of the
          specified 18px (.scripture-text in globals.css). Now it reuses that
          class verbatim so the two readers cannot drift apart again.
          Figures stay inline in the reading flow, never as a page background —
          text over an illustration is unreadable. */}
      <article
        className="page min-h-screen bg-[var(--color-surface)]"
        style={{
          paddingTop: CLEAR_PX + (padTop ? 0 : 16),
          paddingBottom: 96,
        }}
      >
        <div className="max-w-3xl mx-auto px-4 py-6">
          <nav className="flex items-center gap-2 text-sm text-[var(--color-muted)] mb-3">
            <button
              type="button"
              onClick={() => goto(indexHref)}
              className="hover:underline"
            >
              {bookTitle[lang]}
            </button>
            <span aria-hidden="true">/</span>
            <span>
              {chapter.num} / {total}
            </span>
            <span className="ml-auto">
              <ScriptToggle lang={lang} />
            </span>
          </nav>

          <h1 className="h-section mb-1">Ch {chapter.num}</h1>
          <p className="text-base text-[var(--color-ink-soft)] mb-6">
            {chapter.title[lang]}
          </p>

          <div className="space-y-5">
            {chapter.blocks.map((b, i) =>
              b.type === 'img' ? (
                <figure key={i} className="my-8">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/ultimate-intention/${b.src}`}
                    alt=""
                    className="w-full h-auto rounded-lg"
                    loading="lazy"
                  />
                </figure>
              ) : (
                <p
                  key={i}
                  className="scripture-text break-words"
                  style={{ fontSize: `${bodyFont}em` }}
                >
                  {b.text}
                </p>
              ),
            )}
          </div>

          <nav className="flex gap-3 mt-10">
            {prevHref ? (
              <button
                type="button"
                onClick={() => goto(prevHref)}
                className="lesson-card-link flex-1 text-center"
              >
                ← 上一篇
              </button>
            ) : (
              <span className="flex-1" />
            )}
            {nextHref ? (
              <button
                type="button"
                onClick={() => goto(nextHref)}
                className="lesson-card-link flex-1 text-center"
              >
                下一篇 →
              </button>
            ) : (
              <span className="flex-1" />
            )}
          </nav>
        </div>
      </article>
    </>
  )
}

// ─── Bar button ───────────────────────────────────────────────────────────────
// Face === target. The drawn circle IS the button box; no transparent padding.
function BarBtn({
  onClick,
  children,
  face,
  ariaLabel,
  primary,
  circular,
  disabled,
}: {
  onClick: () => void
  children: React.ReactNode
  face?: number
  ariaLabel: string
  primary?: boolean
  circular?: boolean
  disabled?: boolean
}) {
  const size = face ?? BTN
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      disabled={disabled}
      style={{
        opacity: disabled ? 0.35 : 1,
        cursor: disabled ? 'default' : 'pointer',
        width: size,
        height: size,
        minWidth: size,
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: circular ? '50%' : 8,
        border: circular ? '1px solid var(--color-border)' : 'none',
        background: primary ? 'var(--color-primary)' : 'transparent',
        color: primary ? '#fff' : 'var(--color-ink)',
      }}
    >
      {children}
    </button>
  )
}
