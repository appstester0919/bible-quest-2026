'use client'

/**
 * FontSizeControl — A− / A+ / reset widget for the discipline pages.
 *
 * Round 16 (2026-09-03): added so users on phones with dense / small
 * default font sizing can step their text up without zooming the OS
 * browser (zooming breaks the export frame layout because
 * html-to-image snapshots `offsetWidth`, which scales with browser zoom).
 *
 * Persistence:
 *   localStorage key `duobible.discipline.fontscale.v1` holds a JSON
 *   number like 0.85 / 1.0 / 1.15 / 1.3. Defaults to 1.0 when missing
 *   or unparseable. Survives page navigations within the app and full
 *   page reloads (read on mount).
 *
 * Effect:
 *   Sets `--bq-font-scale` on `document.documentElement` (i.e. `<html>`).
 *   globals.css picks that up via:
 *     html { font-size: calc(16px * var(--bq-font-scale, 1)); }
 *   Because the discipline pages use `rem`-based sizing throughout,
 *   scaling `font-size` on the root cascades to every descendant —
 *   no per-element rewriting required.
 *
 * Discrete steps (per spec):
 *   [0.85, 1.0, 1.15, 1.3] — pick the step closest to the stored
 *   value so a user dragging up rapidly lands on each step in turn
 *   (rather than e.g. jumping straight from 1.0 → 1.3 on one tap).
 */

import { useEffect, useState } from 'react'

const STORAGE_KEY = 'duobible.discipline.fontscale.v1'
const STEPS: readonly number[] = [0.85, 1.0, 1.15, 1.3]
const DEFAULT_STEP = 1.0

function clampStep(value: number): number {
  // Round to the nearest declared step; if value is below the smallest
  // step, pin to the smallest; if above the largest, pin to the largest.
  let best = STEPS[0]
  let bestDiff = Math.abs(value - best)
  for (const s of STEPS) {
    const diff = Math.abs(value - s)
    if (diff < bestDiff) {
      best = s
      bestDiff = diff
    }
  }
  return best
}

function readStored(): number {
  if (typeof window === 'undefined') return DEFAULT_STEP
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_STEP
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'number' || !Number.isFinite(parsed)) {
      return DEFAULT_STEP
    }
    return clampStep(parsed)
  } catch {
    return DEFAULT_STEP
  }
}

function writeStored(scale: number) {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(scale))
  } catch {
    /* ignore quota / private-mode failures — the in-memory CSS var still works */
  }
}

function applyToRoot(scale: number) {
  if (typeof document === 'undefined') return
  document.documentElement.style.setProperty('--bq-font-scale', String(scale))
}

export default function FontSizeControl() {
  // Render the UI as if at DEFAULT_STEP on the server so SSR markup
  // matches the first client render — then hydrate from localStorage
  // in a useEffect. This avoids a hydration mismatch warning.
  const [scale, setScale] = useState<number>(DEFAULT_STEP)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const initial = readStored()
    setScale(initial)
    applyToRoot(initial)
    setHydrated(true)
  }, [])

  function setAndApply(next: number) {
    const clamped = clampStep(next)
    setScale(clamped)
    applyToRoot(clamped)
    writeStored(clamped)
  }

  function dec() {
    const idx = STEPS.indexOf(scale)
    // If somehow we're between steps (shouldn't happen after clampStep,
    // but defensive), fall back to the step just below DEFAULT_STEP.
    const nextIdx = idx <= 0 ? 0 : idx - 1
    setAndApply(STEPS[nextIdx])
  }

  function inc() {
    const idx = STEPS.indexOf(scale)
    const nextIdx = idx < 0 ? STEPS.indexOf(DEFAULT_STEP) + 1 : idx + 1
    setAndApply(STEPS[Math.min(nextIdx, STEPS.length - 1)])
  }

  function reset() {
    setAndApply(DEFAULT_STEP)
  }

  // Indicate the current step visually — `aria-pressed` on whichever
  // value matches. The actual position of the indicator (if rendered)
  // is left to CSS; this widget only emits a data-scale attribute.
  return (
    <div
      className="bq-font-control"
      role="group"
      aria-label="字體大小"
      data-scale={hydrated ? scale : DEFAULT_STEP}
    >
      <button
        type="button"
        className="bq-font-control-btn"
        onClick={dec}
        aria-label="縮小字體"
        disabled={!hydrated || scale === STEPS[0]}
      >
        A−
      </button>
      <button
        type="button"
        className="bq-font-control-btn bq-font-control-reset"
        onClick={reset}
        aria-label="重設字體大小"
        disabled={!hydrated || scale === DEFAULT_STEP}
        title="重設字體大小"
      >
        A
      </button>
      <button
        type="button"
        className="bq-font-control-btn"
        onClick={inc}
        aria-label="放大字體"
        disabled={!hydrated || scale === STEPS[STEPS.length - 1]}
      >
        A+
      </button>
    </div>
  )
}
