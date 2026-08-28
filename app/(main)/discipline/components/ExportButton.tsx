'use client'

/**
 * ExportButton — PNG export + Web Share for discipline pages.
 *
 * Implementation note (2026-08-28): html-to-image UMD is self-hosted as a
 * static asset at `/vendor/html-to-image.js` (v1.11.11, pinned in
 * public/vendor/) and loaded on demand via a single injected <script> tag.
 * This replaces the previous inlined-UMD + `new Function(UMD)()` approach,
 * which hit three TS strict-mode traps (legacy octal `\1`, raw `${}` in
 * template literal body, missing `Window.htmlToImage` global) AND a
 * runtime `Unexpected token ')'` because the JS parser treated unescaped
 * `${}` inside the Function-body as object destructuring syntax.
 *
 * Self-hosting avoids:
 *   - TS strict-mode template-literal traps (no string to parse)
 *   - `new Function` eval → no `'unsafe-eval'` CSP dependency for this
 *     loader (script-src `'self'` covers /vendor/*)
 *   - Service-worker cache-first intercept race: a single fetch with
 *     deterministic URL is easy to cache/version-bump; inlined UMD
 *     required a new deploy to bump the chunk hash
 *   - ~20KB inline in the discipline page chunk — bundle lives in /vendor/
 *
 * Concurrent load dedupe is handled by the module-scoped
 * `htmlToImagePromise` variable: N calls produce 1 <script> tag, 1
 * network request, 1 promise.
 */

import { useState } from 'react'

type HtmlToImage = {
  toPng: (node: HTMLElement, opts?: object) => Promise<string>
  toJpeg?: (node: HTMLElement, opts?: object) => Promise<string>
  toSvg?: (node: HTMLElement, opts?: object) => Promise<string>
  toBlob?: (node: HTMLElement, opts?: object) => Promise<Blob | null>
}

declare global {
  interface Window {
    htmlToImage?: HtmlToImage
  }
}

const VENDOR_SRC = '/vendor/html-to-image.js'
const VENDOR_RETRY_SRC = '/vendor/html-to-image.js?retry=1'

let htmlToImagePromise: Promise<HtmlToImage> | null = null

function loadHtmlToImage(): Promise<HtmlToImage> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('SSR: loadHtmlToImage called server-side'))
  }
  // Already loaded from a previous call (or another route that imports it)
  if (window.htmlToImage) return Promise.resolve(window.htmlToImage)
  // Another caller is already fetching — share the same promise
  if (htmlToImagePromise) return htmlToImagePromise

  htmlToImagePromise = new Promise<HtmlToImage>((resolve, reject) => {
    // SSR guard re-checked inside the executor for safety
    if (typeof document === 'undefined') {
      reject(new Error('SSR: document unavailable'))
      return
    }

    const existing = document.querySelector<HTMLScriptElement>(
      'script[data-vendor="html-to-image"]',
    )
    if (existing) {
      // A <script> tag already exists from a concurrent caller — wire the
      // listeners on the existing element rather than injecting a second one.
      existing.addEventListener('load', () => {
        if (window.htmlToImage) resolve(window.htmlToImage)
        else
          reject(
            new Error('script load fired but window.htmlToImage is undefined'),
          )
      })
      existing.addEventListener('error', () =>
        reject(new Error('script load failed (existing tag)')),
      )
      return
    }

    const script = document.createElement('script')
    script.src = VENDOR_SRC
    script.async = true
    script.dataset.vendor = 'html-to-image'

    let retried = false
    const onLoad = () => {
      if (window.htmlToImage) resolve(window.htmlToImage)
      else
        reject(
          new Error('script load fired but window.htmlToImage is undefined'),
        )
    }
    const onError = () => {
      // First load failed — could be SW intercept with stale cache, CSP
      // race, or transient network error. Retry once with a cache-busting
      // query string so the SW treats it as a fresh request.
      if (!retried) {
        retried = true
        const retry = document.createElement('script')
        retry.src = VENDOR_RETRY_SRC
        retry.async = true
        retry.dataset.vendor = 'html-to-image'
        retry.onload = onLoad
        retry.onerror = () =>
          reject(new Error('html-to-image vendor load failed (retry)'))
        // Replace the failed element so the `existing` check on next call
        // points at the retry attempt.
        script.remove()
        document.head.appendChild(retry)
        return
      }
      reject(new Error('html-to-image vendor load failed'))
    }

    script.addEventListener('load', onLoad)
    script.addEventListener('error', onError)
    document.head.appendChild(script)
  })

  return htmlToImagePromise
}

type Props = {
  /** querySelector for the node to export */
  targetSelector: string
  /** suggested filename, e.g. "weekly-2026-W34.png" */
  filename: string
  /** Optional caption passed to Web Share API */
  shareTitle?: string
  /** Optional text passed alongside the image */
  shareText?: string
}

export default function ExportButton({
  targetSelector,
  filename,
  shareTitle = '成全操練',
  shareText = '',
}: Props) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function exportPNG(): Promise<Blob | null> {
    setBusy(true)
    setError(null)
    try {
      const node = document.querySelector(targetSelector)
      if (!node) {
        setError(`找不到目標元素：${targetSelector}`)
        return null
      }
      const htmlToImage = await loadHtmlToImage()
      if (!htmlToImage.toBlob) {
        setError(
          '匯出失敗：html-to-image toBlob not available (version too old)',
        )
        return null
      }
      const blob = await htmlToImage.toBlob(node as HTMLElement, {
        // Bump pixel ratio for sharper output on retina displays
        pixelRatio: 2,
        // Cream background to match the discipline page palette and avoid
        // transparent PNGs which look broken when shared into chat apps
        backgroundColor: '#FFFBF2',
      })
      if (!blob) {
        setError('匯出失敗：無法產生圖片 blob')
        return null
      }
      return blob
      // Fallback (CSP-blocked): keep for reference only.
      // const dataUrl = await htmlToImage.toPng(node as HTMLElement, {...})
      // const blob = await (await fetch(dataUrl)).blob()
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setError(`匯出失敗：${msg}`)
      return null
    } finally {
      setBusy(false)
    }
  }

  async function handleShare() {
    const blob = await exportPNG()
    if (!blob) return
    const file = new File([blob], filename, { type: 'image/png' })

    // Same pattern as the working 「更多 → 分享」 button in
    // components/BottomNavigation.tsx (shareApp): Web Share API first,
    // graceful fallback. The bottom-nav button shares a URL because that's
    // all it has to share. For ExportButton we have a generated blob, so we
    // we try file-based share first, then URL+text share as a wider-net
    // secondary attempt, then download + user-visible hint.
    //
    // Note: File-based navigator.share is finicky on Android Chrome <89,
    // Brave with strict shields, and Telegram in-app WebView — all of which
    // may throw NotAllowedError / DataError / TypeError silently. That's
    // why we wrap each strategy in its own try/catch with a hint at the end.

    // Strategy 1: share the file directly (modern Android Chrome, Safari iOS)
    if (
      typeof navigator !== 'undefined' &&
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] })
    ) {
      try {
        await navigator.share({
          files: [file],
          title: shareTitle,
          text: shareText,
        })
        return // share succeeded
      } catch (err) {
        // AbortError = user dismissed share sheet (NOT a failure, just cancel)
        if (err instanceof Error && err.name === 'AbortError') return
        // Other errors — log + fall through to strategy 2
        if (typeof console !== 'undefined') {
          console.debug('[ExportButton] file-share failed:', err)
        }
      }
    }

    // Strategy 2: URL-based share with the image as a downloaded attachment
    // in the share text. Matches the BottomNavigation.tsx shareApp pattern
    // (URL-only share is universally supported and the simplest fallback).
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        // Trigger the download in parallel — many share targets (Telegram,
        // WhatsApp, email) will let the user pick the freshly-downloaded
        // file from the share sheet's recent files area.
        const dlUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = dlUrl
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(dlUrl)

        await navigator.share({
          title: shareTitle,
          text:
            `${shareText}\n\n📎 已將圖片下載為「${filename}」，請從附件選擇分享。`.trim(),
          url: window.location.href,
        })
        return
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return
        if (typeof console !== 'undefined') {
          console.debug('[ExportButton] URL-share failed:', err)
        }
      }
    }

    // Strategy 3: download + user-visible hint. This is what handles
    // every browser without navigator.share at all (older desktops, some
    // in-app WebViews). The hint solves the original UX complaint: user
    // taps 匯出並分享, sees a download, and now knows what to do next.
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)

    setError(
      `圖片已下載為「${filename}」。請打開 Telegram / WhatsApp 等 app，從「最近分享」或「下載項目」選擇此圖片分享。`,
    )
  }

  async function handleDownloadOnly() {
    const blob = await exportPNG()
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="export-button-row">
      <button
        type="button"
        className="btn-primary export-button-main"
        onClick={handleShare}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? '匯出中…' : '📤 匯出並分享'}
      </button>
      <button
        type="button"
        className="btn-secondary export-button-alt"
        onClick={handleDownloadOnly}
        disabled={busy}
      >
        下載圖片
      </button>
      {error && (
        <p className="export-error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
