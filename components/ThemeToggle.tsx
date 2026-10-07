'use client'

// components/ThemeToggle.tsx
//
// Three states, not two: 跟隨系統 / 亮 / 暗. A two-state toggle cannot express
// 「I want light even though my phone is in dark mode」, which is a real need —
// someone reading a passage at night on a phone set to auto may still want the
// light parchment for a bright room, and vice versa.
//
// The choice lives in a COOKIE, not localStorage, because app/layout.tsx has to
// read it server-side to put `dark` on <html> in the first paint. localStorage
// is unreadable until hydration, so a localStorage toggle flashes a white page
// on every navigation for dark-mode readers — the exact thing dark mode exists
// to prevent.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export type ThemePref = 'system' | 'light' | 'dark'

export const THEME_COOKIE = 'ui-theme'
const YEAR = 60 * 60 * 24 * 365

const OPTIONS: { value: ThemePref; label: string; glyph: string }[] = [
  { value: 'system', label: '跟隨系統', glyph: '🌗' },
  { value: 'light', label: '亮', glyph: '☀️' },
  { value: 'dark', label: '暗', glyph: '🌙' },
]

/** Mirrors the cookie value → class mapping in app/layout.tsx. Keep in sync. */
function resolve(pref: ThemePref, systemDark: boolean): 'light' | 'dark' {
  if (pref === 'system') return systemDark ? 'dark' : 'light'
  return pref
}

export default function ThemeToggle({
  className = '',
}: {
  className?: string
}) {
  const router = useRouter()
  const [pref, setPref] = useState<ThemePref | null>(null)

  useEffect(() => {
    const m = document.cookie.match(/(?:^|;\s*)ui-theme=([^;]+)/)
    const v = m?.[1]
    setPref(v === 'light' || v === 'dark' ? v : 'system')
  }, [])

  const choose = useCallback(
    (next: ThemePref) => {
      setPref(next)
      document.cookie = `${THEME_COOKIE}=${next}; path=/; max-age=${YEAR}; samesite=lax`
      // Paint immediately so the click feels like it did something, then let
      // the server agree on the next navigation. Doing only the cookie would
      // leave the page stale until a reload.
      const systemDark = window.matchMedia(
        '(prefers-color-scheme: dark)',
      ).matches
      document.documentElement.classList.toggle(
        'dark',
        resolve(next, systemDark) === 'dark',
      )
      router.refresh()
    },
    [router],
  )

  // null until the cookie is read: rendering 「跟隨系統」 as a default would
  // show a selection the user may not have made.
  const current = pref ?? 'system'

  return (
    <div
      className={`inline-flex items-center gap-0.5 rounded-full p-0.5 ${className}`}
      style={{
        background: 'var(--bq-reading-accent-soft)',
        border: '1px solid var(--bq-reading-accent-line)',
      }}
      role="group"
      aria-label="主題模式"
    >
      {OPTIONS.map((o) => {
        const active = current === o.value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => choose(o.value)}
            aria-pressed={active}
            title={o.label}
            className="flex items-center justify-center rounded-full transition-colors"
            // face == target: 32px is the whole button, not 32px of glyph
            // padded out with a transparent wrapper.
            style={{
              width: 32,
              height: 32,
              fontSize: '0.95rem',
              lineHeight: 1,
              background: active ? 'var(--bq-reading-accent)' : 'transparent',
              color: active ? '#14100c' : 'var(--bq-reading-ink-soft)',
              fontWeight: active ? 700 : 400,
            }}
          >
            <span aria-hidden>{o.glyph}</span>
            <span className="sr-only">{o.label}</span>
          </button>
        )
      })}
    </div>
  )
}
