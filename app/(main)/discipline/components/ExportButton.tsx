'use client'

/**
 * ExportButton — PNG export + Web Share for discipline pages.
 *
 * Uses dynamic ESM import (esm.sh) of html-to-image, so we don't need to add
 * html-to-image to package.json. esm.sh CDN is cached by Cloudflare with
 * immutable max-age, so subsequent loads are free.
 *
 * Flow:
 *   1. User taps "匯出圖片" button
 *   2. We snapshot the target DOM node via html-to-image → PNG dataURL
 *   3. If navigator.share supports image files (mobile), offer native share
 *      sheet — user picks WhatsApp / Telegram / etc.
 *   4. Otherwise, fall back to download (desktop browsers)
 */

import { useState } from 'react'

type HtmlToImage = {
  toPng: (node: HTMLElement, opts?: object) => Promise<string>
  toJpeg?: (node: HTMLElement, opts?: object) => Promise<string>
  toSvg?: (node: HTMLElement, opts?: object) => Promise<string>
}

declare global {
  interface Window {
    htmlToImage?: HtmlToImage
  }
}

/**
 * Lazy-load html-to-image (UMD bundle self-hosted at /vendor/html-to-image.js).
 * Resolves with the `htmlToImage` global. Caches the promise so multiple
 * concurrent calls share the same <script> injection.
 */
let htmlToImagePromise: Promise<HtmlToImage> | null = null
function loadHtmlToImage(): Promise<HtmlToImage> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('SSR: loadHtmlToImage called server-side'))
  }
  if (window.htmlToImage) return Promise.resolve(window.htmlToImage)
  if (htmlToImagePromise) return htmlToImagePromise

  htmlToImagePromise = new Promise<HtmlToImage>((resolve, reject) => {
    const existing = document.querySelector(
      'script[data-vendor="html-to-image"]'
    )
    if (existing) {
      // Another concurrent call already injected the tag; wait for it
      existing.addEventListener('load', () => {
        if (window.htmlToImage) resolve(window.htmlToImage)
        else reject(new Error('script loaded but window.htmlToImage missing'))
      })
      existing.addEventListener('error', () =>
        reject(new Error('failed to load /vendor/html-to-image.js'))
      )
      return
    }
    const script = document.createElement('script')
    script.src = '/vendor/html-to-image.js'
    script.async = true
    script.dataset.vendor = 'html-to-image'
    script.onload = () => {
      if (window.htmlToImage) resolve(window.htmlToImage)
      else reject(new Error('script loaded but window.htmlToImage missing'))
    }
    script.onerror = () => reject(new Error('failed to load /vendor/html-to-image.js'))
    document.head.appendChild(script)
  })
  return htmlToImagePromise
}

type Props = {
  /** querySelector or ref string for the node to export */
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
      // Load html-to-image (UMD bundle) via <script> tag injection.
      // We self-host at /vendor/html-to-image.js so we don't depend on
      // any CDN — works offline, no CSP issues, faster (cached).
      const htmlToImage = await loadHtmlToImage()
      const dataUrl = await htmlToImage.toPng(node as HTMLElement, {
        // Bump pixel ratio for sharper output on retina displays
        pixelRatio: 2,
        // Cache buster on background to avoid transparent PNG
        backgroundColor: '#FFFFFF',
      })
      // dataURL → Blob for sharing
      const blob = await (await fetch(dataUrl)).blob()
      return blob
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
    const nav = navigator as Navigator & {
      canShare?: (data: { files: File[] }) => boolean
    }
    if (nav.canShare && nav.canShare({ files: [file] })) {
      try {
        await navigator.share({
          files: [file],
          title: shareTitle,
          text: shareText,
        })
        return
      } catch {
        // user cancelled or share failed — fall through to download
      }
    }
    // Fallback: trigger PNG download
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
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