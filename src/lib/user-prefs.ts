const AUDIO_RATE_KEY = 'audioRate'
const FONT_SIZE_KEY = 'fontSize'

const DEFAULT_AUDIO_RATE = 1
const DEFAULT_FONT_SIZE = 16

export function getAudioRate(): number {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_AUDIO_RATE
  }
  const stored = localStorage.getItem(AUDIO_RATE_KEY)
  if (stored === null) return DEFAULT_AUDIO_RATE
  const parsed = parseFloat(stored)
  return isNaN(parsed) ? DEFAULT_AUDIO_RATE : parsed
}

export function setAudioRate(rate: number): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  localStorage.setItem(AUDIO_RATE_KEY, String(rate))
}

export function getFontSize(): number {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_FONT_SIZE
  }
  const stored = localStorage.getItem(FONT_SIZE_KEY)
  if (stored === null) return DEFAULT_FONT_SIZE
  const parsed = parseInt(stored, 10)
  return isNaN(parsed) ? DEFAULT_FONT_SIZE : parsed
}

export function setFontSize(size: number): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  localStorage.setItem(FONT_SIZE_KEY, String(size))
}
