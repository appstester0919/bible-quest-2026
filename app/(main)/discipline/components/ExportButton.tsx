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
      // Dynamic import keeps html-to-image out of the main bundle.
      // We use a runtime variable (not a string literal in import()) so
      // webpack doesn't try to statically resolve the https:// URL —
      // Next.js's webpack config doesn't have a handler for `https:` schemes.
      // The `webpackIgnore` magic comment is belt-and-braces for older webpack.
      const CDN_URL = 'https://esm.sh/html-to-image@1.11.11'
      const mod = await import(/* webpackIgnore: true */ CDN_URL)
      const dataUrl = await mod.toPng(node as HTMLElement, {
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