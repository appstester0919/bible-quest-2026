'use client'

// components/ThemeFab.tsx
//
// The app-wide theme control. Lives in app/(main)/layout.tsx so every screen
// gets it, and floats above the docked bottom nav because that bar is the one
// strip guaranteed to exist on all seven surfaces — anchoring the toggle to it
// means the control never lands over content and never has to be re-placed per
// page.
//
// It reuses ThemeToggle's cookie + class logic rather than duplicating it; the
// only difference is that it expands from a single button.

import { useEffect, useState } from 'react'
import ThemeToggle, { type ThemePref } from '@/components/ThemeToggle'

const KEY = 'ui-theme'

function currentPref(): ThemePref {
  if (typeof document === 'undefined') return 'system'
  const v = document.cookie.match(/(?:^|;\s*)ui-theme=([^;]+)/)?.[1]
  return v === 'light' || v === 'dark' ? v : 'system'
}

function glyph(pref: ThemePref, systemDark: boolean): string {
  if (pref === 'system') return systemDark ? '🌗' : '🌗'
  return pref === 'dark' ? '🌙' : '☀️'
}

export default function ThemeFab() {
  const [pref, setPref] = useState<ThemePref>('system')
  const [systemDark, setSystemDark] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    setPref(currentPref())
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    setSystemDark(mq.matches)
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener('change', onChange)
    // ThemeToggle writes the same cookie from the reader and the book, which
    // are different routes from here. Without this the FAB kept showing the
    // old glyph after the reader changed the theme.
    const sync = () => setPref(currentPref())
    window.addEventListener('focus', sync)
    return () => {
      mq.removeEventListener('change', onChange)
      window.removeEventListener('focus', sync)
    }
  }, [])

  return (
    <div
      className="fixed z-40 flex items-center gap-1.5"
      style={{
        right: 'max(12px, env(safe-area-inset-right, 0px))',
        // Sit just above the 64px docked nav + the safe-area inset it reserves.
        bottom: 'calc(78px + env(safe-area-inset-bottom, 16px))',
      }}
    >
      {open && (
        <div style={{ animation: 'none' }}>
          <ThemeToggle />
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={open ? '關閉主題選單' : '主題模式'}
        // face == target: 44px drawn AND 44px tappable. Not a small glyph in a
        // big transparent box, which satisfies the letter of the rule while
        // the user sees no change.
        style={{
          width: 44,
          height: 44,
          borderRadius: 999,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '1.15rem',
          lineHeight: 1,
          cursor: 'pointer',
          background: 'var(--bq-sheet)',
          color: 'var(--bq-sheet-ink)',
          border: '1px solid var(--bq-sheet-cell-alt)',
          boxShadow: 'var(--shadow-floating)',
        }}
      >
        <span aria-hidden>{glyph(pref, systemDark)}</span>
      </button>
    </div>
  )
}

export { KEY as THEME_COOKIE_KEY }
