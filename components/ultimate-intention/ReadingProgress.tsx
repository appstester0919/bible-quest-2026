'use client'

// components/ultimate-intention/ReadingProgress.tsx
//
// 「在每一chapter 底提供按鈕標記完成本chapter，並在目錄用不同顏色按鈕和emoji
//  標示該chapter 是完成/未完成，好作書簽系統標記讀到哪裡」
//
// This is a per-device bookmark, not progress synced to an account: the reader
// page is reachable without auth and the rest of this book's surfaces are static
// files, so localStorage is the only store that always works here. If the reader
// later wants cross-device progress it needs a table — worth saying out loud
// rather than implying this already syncs.

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

const KEY = 'ui-book-done'

/**
 * Fired on window after a toggle. The `storage` event only fires in OTHER tabs,
 * so returning from the reader to the index would otherwise show stale marks —
 * both are separate routes, and the index is often bfcache-restored.
 */
export const PROGRESS_EVENT = 'ui-book-progress'

function read(): number[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter((n) => typeof n === 'number') : []
  } catch {
    return []
  }
}

function write(nums: number[]) {
  window.localStorage.setItem(
    KEY,
    JSON.stringify([...new Set(nums)].sort((a, b) => a - b)),
  )
}

/**
 * ONE subscription for the whole page. The index renders 28 rows, and giving
 * each its own storage/focus/progress listeners would mean 84 listeners for the
 * same localStorage read. Subscribers live in a module-level set so there is
 * still exactly one listener per event.
 */
const subscribers = new Set<() => void>()

function emit() {
  for (const fn of subscribers) fn()
}

function subscribe(fn: () => void) {
  subscribers.add(fn)
  if (subscribers.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', emit)
    window.addEventListener(PROGRESS_EVENT, emit)
    window.addEventListener('focus', emit)
  }
  return () => {
    subscribers.delete(fn)
    if (subscribers.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', emit)
      window.removeEventListener(PROGRESS_EVENT, emit)
      window.removeEventListener('focus', emit)
    }
  }
}

/** Cheap per-row view: 28 rows share one storage read, not 28. */
export function useChapterDone(num: number): { done: boolean; ready: boolean } {
  const [done, setDone] = useState(false)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const sync = () => setDone(read().includes(num))
    sync()
    setReady(true)
    return subscribe(sync)
  }, [num])

  return { done, ready }
}

/** Shared so the chapter button and the index rows cannot disagree. */
export function useReadProgress() {
  const [done, setDone] = useState<number[]>([])
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const sync = () => setDone(read())
    sync()
    setReady(true)
    return subscribe(sync)
  }, [])

  const toggle = useCallback((num: number) => {
    setDone((prev) => {
      const next = prev.includes(num)
        ? prev.filter((n) => n !== num)
        : [...prev, num]
      write(next)
      window.dispatchEvent(new Event(PROGRESS_EVENT))
      return next
    })
  }, [])

  return { done, ready, toggle }
}

/** The 「標記完成」 button placed under a chapter's last paragraph. */
export default function MarkComplete({
  chapterNum,
  chapterTitle,
}: {
  chapterNum: number
  chapterTitle: string
}) {
  const { done, ready, toggle } = useReadProgress()
  const isDone = done.includes(chapterNum)

  return (
    <div className="mt-10 pt-6 border-t border-[var(--color-border)] flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={() => toggle(chapterNum)}
        aria-pressed={isDone}
        className={[
          'px-5 py-2.5 rounded-xl text-sm font-bold transition-colors border',
          isDone
            ? 'bg-[#E8F2E4] text-[#2F5D3A] border-[#B8D4B4]'
            : 'bg-transparent text-[#3D2914] border-[#D4C4A8] hover:bg-[#EDE5D8]',
        ].join(' ')}
      >
        {isDone ? '✓ 已完成' : '標記完成'}
      </button>
      <p className="text-xs text-[var(--color-ink-soft)]">
        {isDone
          ? '再按一次可取消標記'
          : `第 ${chapterNum} 篇 · ${chapterTitle}`}
      </p>
    </div>
  )
}

/**
 * Progress dot rendered inside each index row. Rendered on the client only, so
 * the row keeps its server-rendered markup until localStorage has answered —
 * that is what avoids a hydration mismatch on a 28-item list.
 */
export function DoneBadge({ num }: { num: number }) {
  const { done: isDone, ready } = useChapterDone(num)
  if (!ready) return null
  return (
    <span
      className="shrink-0 text-base leading-none"
      title={isDone ? '已完成' : '未完成'}
      aria-label={isDone ? '已完成' : '未完成'}
    >
      {isDone ? '✅' : '⬜'}
    </span>
  )
}

/** Nudge a re-render of the index after the reader marks a chapter done. */
export function useProgressRerender() {
  const router = useRouter()
  return useCallback(() => router.refresh(), [router])
}
