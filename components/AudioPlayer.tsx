'use client'

import { useState, useEffect, useRef } from 'react'
import { getAudioRate, setAudioRate, AUDIO_RATES } from '@/lib/user-prefs'

interface AudioPlayerProps {
  src: string
  onEnded?: () => void
  autoPlay?: boolean
}

/**
 * Audio playback toolbar for Bible reading.
 * - Play / Pause toggle
 * - Speed pills: 1.0× | 1.25× | 1.5× | 1.75× | 2.0×
 * - Persists speed preference in localStorage
 */
export function AudioPlayer({ src, onEnded, autoPlay = false }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [rate, setRate] = useState<number>(1.0)
  const [progress, setProgress] = useState(0) // 0-100
  const [duration, setDuration] = useState(0)

  // Load persisted rate on mount
  useEffect(() => {
    setRate(getAudioRate())
  }, [])

  // Sync playbackRate whenever rate changes
  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.playbackRate = rate
    setAudioRate(rate)
  }, [rate])

  // Load new src
  useEffect(() => {
    const audio = audioRef.current
    if (!audio || !src) return
    audio.src = src
    setIsPlaying(false)
    setProgress(0)
    if (autoPlay) {
      audio.play().then(() => setIsPlaying(true)).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src])

  function handleTimeUpdate() {
    const audio = audioRef.current
    if (!audio || !audio.duration) return
    setProgress((audio.currentTime / audio.duration) * 100)
    setDuration(audio.duration)
  }

  function handlePlayPause() {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
    } else {
      audio.play().then(() => setIsPlaying(true)).catch(() => {})
    }
  }

  function handleEnded() {
    setIsPlaying(false)
    setProgress(0)
    onEnded?.()
  }

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current
    if (!audio || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    audio.currentTime = ratio * duration
  }

  const progressPercent = Math.round(progress)

  return (
    <div className="bg-white rounded-2xl p-4 shadow-sm space-y-3">
      {/* Progress bar */}
      <div
        className="h-1.5 bg-[var(--color-background)] rounded-full cursor-pointer"
        onClick={handleSeek}
        role="slider"
        aria-label="播放進度"
        aria-valuenow={progressPercent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full bg-[var(--color-success)] rounded-full transition-all"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-between gap-3">
        {/* Play / Pause */}
        <button
          onClick={handlePlayPause}
          aria-label={isPlaying ? '暫停朗讀' : '開始朗讀'}
          className="flex items-center justify-center w-11 h-11 rounded-full bg-[var(--color-success)] text-white shadow-[var(--shadow-button)] hover:bg-[#46A302] active:translate-y-0.5 active:shadow-none transition-all shrink-0"
        >
          {isPlaying ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <rect x="3" y="2" width="4" height="12" rx="1" />
              <rect x="9" y="2" width="4" height="12" rx="1" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M4 2.5v11l9-5.5-9-5.5z" />
            </svg>
          )}
        </button>

        {/* Speed pills */}
        <div className="flex gap-1" role="group" aria-label="朗讀速度">
          {AUDIO_RATES.map((r) => (
            <button
              key={r}
              onClick={() => setRate(r)}
              aria-pressed={rate === r}
              className={`
                px-2 py-1.5 rounded-full text-sm font-bold transition-all min-w-[44px] min-h-[36px]
                ${rate === r
                  ? 'bg-[var(--color-streak)] text-white shadow-sm'
                  : 'bg-[var(--color-background)] text-[var(--color-muted)] hover:bg-[var(--color-muted)]/10'
                }
              `}
            >
              {r}×
            </button>
          ))}
        </div>
      </div>

      {/* Hidden audio element */}
      <audio
        ref={audioRef}
        onTimeUpdate={handleTimeUpdate}
        onEnded={handleEnded}
        preload="metadata"
      />
    </div>
  )
}
