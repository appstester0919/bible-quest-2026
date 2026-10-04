/**
 * Collapse a flat chapter list into runs of consecutive chapters.
 *
 * A catch-up day can be 120 chapters. Listing every one as 「哥林多前書 7」
 * is unreadable and says nothing the reader didn't already know from the
 * 「共 120 章」 count above it. What they need is the SHAPE of the run:
 * 提摩太前書 1 - 6, 提摩太後書 1 - 3.
 *
 * A run breaks whenever the book changes or the chapter number is not exactly
 * one more than the previous chapter, so a deliberately interleaved plan
 * (parallel OT+NT) still renders as separate short runs rather than a wrong
 * 「1 - 99」.
 */
export interface ChapterRun {
  book: string
  from: number
  to: number
}

export function runsOf(refs: string[]): ChapterRun[] {
  const runs: ChapterRun[] = []
  for (const ref of refs) {
    const parts = ref.trim().split(/\s+/)
    const book = parts[0]
    const chapter = parseInt((parts[1] || '1').replace(/:\d+$/, ''), 10) || 1
    const last = runs[runs.length - 1]
    if (last && last.book === book && chapter === last.to + 1) {
      last.to = chapter
    } else {
      runs.push({ book, from: chapter, to: chapter })
    }
  }
  return runs
}

/** 「提摩太前書 1 - 6」 — a single chapter stays unsuffixed. */
export function formatRun(r: ChapterRun): string {
  return r.from === r.to
    ? `${r.book} ${r.from}`
    : `${r.book} ${r.from} - ${r.to}`
}

/**
 * Runs as display text, with a middle-ellipsis guard so a very long catch-up
 * never becomes its own unreadability: at most `maxRuns` runs are shown, the
 * middle is elided, and the chapter count is repeated at the end.
 */
export function summariseRuns(refs: string[], maxRuns = 3): string {
  const runs = runsOf(refs)
  if (runs.length === 0) return ''
  if (runs.length <= maxRuns) return runs.map(formatRun).join('、')
  const head = runs.slice(0, Math.ceil(maxRuns / 2))
  const tail = runs.slice(runs.length - Math.floor(maxRuns / 2))
  return `${head.map(formatRun).join('、')} … ${tail.map(formatRun).join('、')}`
}

/** Total chapters, e.g. 120. */
export function countRuns(refs: string[]): number {
  return runsOf(refs).reduce((n, r) => n + (r.to - r.from + 1), 0)
}
