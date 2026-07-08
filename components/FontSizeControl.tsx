'use client'

import { FONT_MIN, FONT_MAX, FONT_STEP, DEFAULT_FONT_SIZE } from '@/lib/user-prefs'

interface FontSizeControlProps {
  value: number
  onChange: (size: number) => void
}

/**
 * Font size control: A− / Npx / A+
 * Range: 14px–32px, step 4px.
 * Middle button resets to default (20px).
 */
export function FontSizeControl({ value, onChange }: FontSizeControlProps) {
  const atMin = value <= FONT_MIN
  const atMax = value >= FONT_MAX

  function dec() {
    if (atMin) return
    onChange(Math.max(FONT_MIN, value - FONT_STEP))
  }

  function inc() {
    if (atMax) return
    onChange(Math.min(FONT_MAX, value + FONT_STEP))
  }

  function reset() {
    onChange(DEFAULT_FONT_SIZE)
  }

  return (
    <div
      className="flex items-center gap-0.5 bg-white rounded-full px-1.5 py-1 shadow-sm"
      role="group"
      aria-label="字體大小"
    >
      <button
        onClick={dec}
        disabled={atMin}
        aria-label="縮小字體"
        className={`
          w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold transition-all
          ${atMin
            ? 'text-[var(--color-muted)]/30 cursor-not-allowed'
            : 'text-[var(--color-muted)] hover:bg-[var(--color-background)] active:bg-[var(--color-muted)]/20'
          }
        `}
      >
        A−
      </button>

      <button
        onClick={reset}
        aria-label="重設字體大小"
        title="重設為 20px"
        className="w-10 h-8 flex items-center justify-center text-xs font-bold text-[var(--color-primary)] hover:bg-[var(--color-background)] rounded transition-all"
      >
        {value}
      </button>

      <button
        onClick={inc}
        disabled={atMax}
        aria-label="放大字體"
        className={`
          w-8 h-8 flex items-center justify-center rounded-full text-sm font-bold transition-all
          ${atMax
            ? 'text-[var(--color-muted)]/30 cursor-not-allowed'
            : 'text-[var(--color-muted)] hover:bg-[var(--color-background)] active:bg-[var(--color-muted)]/20'
          }
        `}
      >
        A+
      </button>
    </div>
  )
}
