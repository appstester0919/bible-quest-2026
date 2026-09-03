'use client'

/**
 * AutoTextarea — textarea that grows with content (no scrollbar).
 *
 * Round 17 (2026-09-03): user feedback on Round 16 export — even after we
 * widened the export frame to capture full scrollHeight, native browser
 * textareas with `resize: vertical` + `overflow: auto` STILL cut content
 * beyond visible height because html-to-image captures the textarea
 * element's own `offsetHeight` (= visible frame), not its internal
 * `scrollHeight`. The fix: make the textarea auto-expand to fit content
 * so there is no internal scroll to begin with.
 *
 * Behavior:
 *   - On mount + every value change, set `el.style.height =
 *     el.scrollHeight + 'px'` (one-shot reset to 'auto' first to allow
 *     shrink when text is deleted).
 *   - `minHeight` keeps empty / short-textareas from collapsing to 0.
 *   - `rows` is used as a fallback initial-size hint when `minHeight` is
 *     unset.
 *
 * Critically: do NOT pass `style.height` from caller — we own that prop.
 * All other props (className, value, onChange, placeholder, aria-*,
 * maxLength) forward through unchanged.
 */

import { useLayoutEffect, useRef, forwardRef } from 'react'

type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  /** Minimum height in px (optional). Defaults to `rows * 1.5rem + 24px`. */
  minHeight?: number
}

const AutoTextarea = forwardRef<HTMLTextAreaElement, Props>(
  function AutoTextarea({ minHeight, rows, ...rest }, forwardedRef) {
    const innerRef = useRef<HTMLTextAreaElement | null>(null)

    // Merge forwarded ref + inner ref so we can read scrollHeight in the
    // effect while still letting the caller attach a ref if needed.
    const setRefs = (el: HTMLTextAreaElement | null) => {
      innerRef.current = el
      if (typeof forwardedRef === 'function') forwardedRef(el)
      else if (forwardedRef) {
        ;(forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = el
      }
    }

    useLayoutEffect(() => {
      const el = innerRef.current
      if (!el) return
      // Reset to 'auto' so scrollHeight shrinks when text is deleted
      // before we read it. Without this reset, once the textarea grows
      // it can never shrink back.
      el.style.height = 'auto'
      const fallback = (typeof rows === 'number' ? rows : 3) * 24 + 24
      const target = Math.max(el.scrollHeight, minHeight ?? 0, fallback)
      el.style.height = `${target}px`
    }, [rest.value, minHeight, rows])

    return <textarea {...rest} ref={setRefs} rows={rows} />
  }
)

export default AutoTextarea
