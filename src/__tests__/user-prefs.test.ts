import { describe, it, expect, beforeEach, vi } from 'vitest'

// These functions are expected to be implemented in the user-prefs module
// They manage user preferences like audio playback rate and font size via localStorage
import {
  getAudioRate,
  setAudioRate,
  getFontSize,
  setFontSize,
} from '@/lib/user-prefs'

describe('user-prefs', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
    })
  })

  describe('getAudioRate', () => {
    it('returns the stored audio rate as a number', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue('1.5'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      expect(getAudioRate()).toBe(1.5)
    })

    it('returns default 1 when no rate is stored', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      expect(getAudioRate()).toBe(1)
    })
  })

  describe('setAudioRate', () => {
    it('stores the audio rate in localStorage', () => {
      const setItem = vi.fn()
      vi.stubGlobal('localStorage', {
        getItem: vi.fn(),
        setItem,
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      setAudioRate(2)
      expect(setItem).toHaveBeenCalledWith('audioRate', '2')
    })
  })

  describe('getFontSize', () => {
    it('returns the stored font size as a number', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue('18'),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      expect(getFontSize()).toBe(18)
    })

    it('returns default 16 when no font size is stored', () => {
      vi.stubGlobal('localStorage', {
        getItem: vi.fn().mockReturnValue(null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      expect(getFontSize()).toBe(16)
    })
  })

  describe('setFontSize', () => {
    it('stores the font size in localStorage', () => {
      const setItem = vi.fn()
      vi.stubGlobal('localStorage', {
        getItem: vi.fn(),
        setItem,
        removeItem: vi.fn(),
        clear: vi.fn(),
      })
      setFontSize(20)
      expect(setItem).toHaveBeenCalledWith('fontSize', '20')
    })
  })
})
