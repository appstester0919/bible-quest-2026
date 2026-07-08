/**
 * SSR-safe localStorage wrappers for user reading preferences.
 * Must be called client-side only (check typeof window !== 'undefined').
 */

export const AUDIO_RATES = [1.0, 1.25, 1.5, 1.75, 2.0] as const
export const DEFAULT_AUDIO_RATE = 1.0

export const FONT_MIN = 14
export const FONT_MAX = 32
export const FONT_STEP = 4
export const DEFAULT_FONT_SIZE = 20

const KEY_AUDIO_RATE = 'bq_audio_rate'
const KEY_FONT_SIZE = 'bq_font_size'

// ─── Audio rate ────────────────────────────────────────────────────────────────

export function getAudioRate(): number {
  if (typeof window === 'undefined') return DEFAULT_AUDIO_RATE
  const raw = localStorage.getItem(KEY_AUDIO_RATE)
  if (!raw) return DEFAULT_AUDIO_RATE
  const v = parseFloat(raw)
  if (!AUDIO_RATES.includes(v as typeof AUDIO_RATES[number])) return DEFAULT_AUDIO_RATE
  return v
}

export function setAudioRate(rate: number): void {
  if (typeof window === 'undefined') return
  localStorage.setItem(KEY_AUDIO_RATE, String(rate))
}

// ─── Font size ─────────────────────────────────────────────────────────────────

export function getFontSize(): number {
  if (typeof window === 'undefined') return DEFAULT_FONT_SIZE
  const raw = localStorage.getItem(KEY_FONT_SIZE)
  if (!raw) return DEFAULT_FONT_SIZE
  const v = parseInt(raw, 10)
  if (isNaN(v) || v < FONT_MIN || v > FONT_MAX) return DEFAULT_FONT_SIZE
  return v
}

export function setFontSize(size: number): void {
  if (typeof window === 'undefined') return
  const clamped = Math.min(FONT_MAX, Math.max(FONT_MIN, size))
  localStorage.setItem(KEY_FONT_SIZE, String(clamped))
}
