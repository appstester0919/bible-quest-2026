/**
 * Static book metadata for the Bible (issue #6: start position picker).
 * Mirrors public/bible-data.json — 65 books, OT first (index 0..38), NT second (39..64).
 *
 * Synchronously imported at module load (small, ~3KB). Used by:
 *   - app/onboarding/page.tsx (start position picker UI)
 *   - lib/bible/planGenerator.ts (could be — currently it still takes books[] as arg)
 */

import bibleData from '../../public/bible-data.json'

export type BibleBook = {
  /** 0-based canonical book index (創=0, …, 瑪=38, 太=39, …, 啓=64) */
  index: number
  /** Abbreviation / single Chinese character (e.g. "太", "創") */
  abbr: string
  /** Full book name in Traditional Chinese (e.g. "馬太福音") */
  name: string
  /** Chapter count */
  chapters: number
}

const rawBooks = (bibleData as { books: { a: string; n: string; c: number }[] }).books

export const BIBLE_BOOKS: BibleBook[] = rawBooks.map((b, i) => ({
  index: i,
  abbr: b.a,
  name: b.n,
  chapters: b.c,
}))

export const NT_BOOKS: BibleBook[] = BIBLE_BOOKS.filter((b) => b.index >= 39)
export const OT_BOOKS: BibleBook[] = BIBLE_BOOKS.filter((b) => b.index < 39)

export const NT_FIRST_BOOK_INDEX = 39
export const NT_LAST_BOOK_INDEX = 64
export const OT_FIRST_BOOK_INDEX = 0
export const OT_LAST_BOOK_INDEX = 38

export const NT_TOTAL_CHAPTERS = 259
export const OT_TOTAL_CHAPTERS = 929
export const NT_OT_TOTAL_CHAPTERS = 1188
