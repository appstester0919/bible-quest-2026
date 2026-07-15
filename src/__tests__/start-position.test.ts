import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import {
  getRemainingChapters,
  NT_FIRST_BOOK_INDEX,
  NT_LAST_BOOK_INDEX,
  OT_FIRST_BOOK_INDEX,
  OT_LAST_BOOK_INDEX,
} from '../../lib/bible/scope'

// Load the same shape of book data the app uses (OT first, NT second)
const bibleData = JSON.parse(
  readFileSync('public/bible-data.json', 'utf-8')
) as { books: { a: string; n: string; c: number }[] }
const books = bibleData.books.map((b, i) => ({
  index: i,
  chapters: b.c,
}))

describe('getRemainingChapters — issue #6 start position helper', () => {
  describe('OT scope (start_book_index 0..38)', () => {
    it('start = 創世記 1章 → 929 (full OT)', () => {
      expect(getRemainingChapters('ot', books, OT_FIRST_BOOK_INDEX, 1)).toBe(929)
    })

    it('start = 創世記 50章 (last chapter of 創) → 879', () => {
      // skip 創 entirely, continue from 出 1
      expect(getRemainingChapters('ot', books, 0, 50)).toBe(929 - 49)
    })

    it('start = 出埃及記 1章 → 879 (full OT minus 創)', () => {
      expect(getRemainingChapters('ot', books, 1, 1)).toBe(929 - 50)
    })

    it('start = 出埃及記 30章 → 850', () => {
      // 929 - 50 (創) - 29 (出 1-29) = 850
      expect(getRemainingChapters('ot', books, 1, 30)).toBe(850)
    })

    it('start = 出埃及記 40章 (last chapter of 出) → 840', () => {
      // 929 - 50 (創) - 39 (出 1-39) = 840
      expect(getRemainingChapters('ot', books, 1, 40)).toBe(840)
    })

    it('start = 利未記 1章 → 840', () => {
      expect(getRemainingChapters('ot', books, 2, 1)).toBe(929 - 50 - 40)
    })

    it('start = 詩篇 100章 → 詩 100-150 + 後續書卷', () => {
      // 詩篇 is idx 18 with 150 chapters
      const before = books
        .filter((b) => b.index < 18)
        .reduce((s, b) => s + b.chapters, 0)
      const remaining = 929 - before - 99
      expect(getRemainingChapters('ot', books, 18, 100)).toBe(remaining)
    })

    it('start = 瑪拉基 1章 → 4 (last book, full)', () => {
      expect(getRemainingChapters('ot', books, OT_LAST_BOOK_INDEX, 1)).toBe(4)
    })

    it('start = 瑪拉基 4章 (last chapter) → 1', () => {
      expect(getRemainingChapters('ot', books, 38, 4)).toBe(1)
    })
  })

  describe('NT scope (start_book_index 39..64)', () => {
    it('start = 馬太 1章 → 259 (full NT)', () => {
      expect(getRemainingChapters('nt', books, NT_FIRST_BOOK_INDEX, 1)).toBe(259)
    })

    it('start = 馬太 28章 (last chapter of 太) → 232', () => {
      expect(getRemainingChapters('nt', books, 39, 28)).toBe(259 - 27)
    })

    it('start = 約翰福音 1章 → 191', () => {
      // 太(28) + 可(16) + 路(24) = 68; 259 - 68 = 191
      expect(getRemainingChapters('nt', books, 42, 1)).toBe(191)
    })

    it('start = 啟示錄 1章 → 22', () => {
      expect(getRemainingChapters('nt', books, NT_LAST_BOOK_INDEX, 1)).toBe(22)
    })

    it('start = 啟示錄 22章 (last chapter) → 1', () => {
      expect(getRemainingChapters('nt', books, 64, 22)).toBe(1)
    })
  })

  describe('bounds checking', () => {
    it('throws when NT startBookIndex is < 39 (out of NT range)', () => {
      expect(() => getRemainingChapters('nt', books, 0, 1)).toThrow(
        /out of range for scope 'nt'/
      )
    })

    it('throws when OT startBookIndex is >= 39 (out of OT range)', () => {
      expect(() => getRemainingChapters('ot', books, 39, 1)).toThrow(
        /out of range for scope 'ot'/
      )
    })

    it('throws when startChapter < 1', () => {
      expect(() => getRemainingChapters('nt', books, 39, 0)).toThrow(
        /startChapter must be >= 1/
      )
    })

    it('throws when startChapter exceeds start book chapter count', () => {
      // 創世記 has 50 chapters; asking for chapter 51 should throw
      expect(() => getRemainingChapters('ot', books, 0, 51)).toThrow(
        /exceeds start book/
      )
    })
  })
})