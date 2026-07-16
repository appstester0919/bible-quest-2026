import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { generateReadingPlan } from '../../lib/bible/planGenerator'

// Load the same shape of book data the app uses (OT first, NT second).
// planGenerator expects BookMeta with { name, abbr, index, chapters }
const bibleData = JSON.parse(
  readFileSync('public/bible-data.json', 'utf-8')
) as { books: { a: string; n: string; c: number }[] }
const books = bibleData.books.map((b, i) => ({
  name: b.n,
  abbr: b.a,
  index: i,
  chapters: b.c,
}))

const startDate = '2026-07-15T00:00:00'

/** Get the first `n` day entries (in insertion order) as a 2D array */
function firstNDays(plan: Map<string, string[]>, n: number): string[][] {
  return Array.from(plan.values()).slice(0, n)
}

describe('generateReadingPlan — issue #6 start position', () => {
  describe('Mode 1: linear NT', () => {
    it('default (start = 馬太 1) still works (backwards compat)', () => {
      const plan = generateReadingPlan(
        {
          scope: 'nt',
          chapters_per_day: 3,
          started_at: startDate,
          // No start position → falls back to defaults (太 1)
        },
        books
      )
      const days = firstNDays(plan, 2)
      expect(days[0]).toEqual(['馬太福音 1', '馬太福音 2', '馬太福音 3'])
      expect(days[1]).toEqual(['馬太福音 4', '馬太福音 5', '馬太福音 6'])
    })

    it('NT start = 約翰福音 1 章 (skip 太/可/路) → 3 章/日', () => {
      const plan = generateReadingPlan(
        {
          scope: 'nt',
          chapters_per_day: 3,
          started_at: startDate,
          nt_start_book_index: 42, // 約翰福音
          start_chapter: 1,
        },
        books
      )
      const days = firstNDays(plan, 2)
      expect(days[0]).toEqual(['約翰福音 1', '約翰福音 2', '約翰福音 3'])
      expect(days[1]).toEqual(['約翰福音 4', '約翰福音 5', '約翰福音 6'])
    })

    it('NT start = 馬太 5 章 → first day = 太 5,6,7', () => {
      const plan = generateReadingPlan(
        {
          scope: 'nt',
          chapters_per_day: 3,
          started_at: startDate,
          nt_start_book_index: 39,
          start_chapter: 5,
        },
        books
      )
      const days = firstNDays(plan, 1)
      expect(days[0]).toEqual(['馬太福音 5', '馬太福音 6', '馬太福音 7'])
    })

    it('NT start = 啟示錄 22 章 (last chapter), 1 章/日 → only 1 day', () => {
      const plan = generateReadingPlan(
        {
          scope: 'nt',
          chapters_per_day: 1,
          started_at: startDate,
          nt_start_book_index: 64,
          start_chapter: 22,
        },
        books
      )
      // Plan should have exactly 1 day with '啟示錄 22'
      expect(plan.size).toBe(1)
      const refs = Array.from(plan.values())[0]
      expect(refs).toEqual(['啟示錄 22'])
    })

    it('NT start = 啟示錄 21 章 (last book, near end), 2 章/日 → 2 chapters', () => {
      const plan = generateReadingPlan(
        {
          scope: 'nt',
          chapters_per_day: 2,
          started_at: startDate,
          nt_start_book_index: 64,
          start_chapter: 21,
        },
        books
      )
      const days = firstNDays(plan, 1)
      expect(days[0]).toEqual(['啟示錄 21', '啟示錄 22'])
      expect(plan.size).toBe(1) // No more days after 啟示錄
    })
  })

  describe('Mode 2: linear OT', () => {
    it('default (start = 創 1) still works (backwards compat)', () => {
      const plan = generateReadingPlan(
        { scope: 'ot', chapters_per_day: 3, started_at: startDate },
        books
      )
      const days = firstNDays(plan, 2)
      expect(days[0]).toEqual(['創世記 1', '創世記 2', '創世記 3'])
      expect(days[1]).toEqual(['創世記 4', '創世記 5', '創世記 6'])
    })

    it('OT start = 出埃及記 30 章, 3 章/日', () => {
      const plan = generateReadingPlan(
        {
          scope: 'ot',
          chapters_per_day: 3,
          started_at: startDate,
          ot_start_book_index: 1, // 出埃及記
          start_chapter: 30,
        },
        books
      )
      const days = firstNDays(plan, 3)
      expect(days[0]).toEqual(['出埃及記 30', '出埃及記 31', '出埃及記 32'])
      expect(days[1]).toEqual(['出埃及記 33', '出埃及記 34', '出埃及記 35'])
      expect(days[2]).toEqual(['出埃及記 36', '出埃及記 37', '出埃及記 38'])
    })

    it('OT cross-book: start = 出埃及記 39 章 (3 章/日) → spans into 利未記', () => {
      const plan = generateReadingPlan(
        {
          scope: 'ot',
          chapters_per_day: 3,
          started_at: startDate,
          ot_start_book_index: 1,
          start_chapter: 39,
        },
        books
      )
      const days = firstNDays(plan, 2)
      expect(days[0]).toEqual(['出埃及記 39', '出埃及記 40', '利未記 1'])
      expect(days[1]).toEqual(['利未記 2', '利未記 3', '利未記 4'])
    })

    it('OT start = 瑪拉基 1 章, 3 章/日 → only 4 chapters (book has 4 chapters)', () => {
      const plan = generateReadingPlan(
        {
          scope: 'ot',
          chapters_per_day: 3,
          started_at: startDate,
          ot_start_book_index: 38, // 瑪拉基
          start_chapter: 1,
        },
        books
      )
      // Day 1: 瑪 1, 2, 3; Day 2: 瑪 4 only
      const days = firstNDays(plan, 2)
      expect(days[0]).toEqual(['瑪拉基書 1', '瑪拉基書 2', '瑪拉基書 3'])
      expect(days[1]).toEqual(['瑪拉基書 4'])
      expect(plan.size).toBe(2)
    })
  })

  describe('Mode 3: nt_ot parallel', () => {
    it('default parallel: NT 太 1 + OT 創 1, 2+1 章/日', () => {
      const plan = generateReadingPlan(
        {
          scope: 'nt_ot',
          chapters_per_day: 3, // total
          reading_order: '2-1', // 2 NT + 1 OT
          started_at: startDate,
        },
        books
      )
      const days = firstNDays(plan, 2)
      expect(days[0]).toEqual(['馬太福音 1', '馬太福音 2', '創世記 1'])
      expect(days[1]).toEqual(['馬太福音 3', '馬太福音 4', '創世記 2'])
    })

    it('parallel: NT 約 5 + OT 出 30, 2+1 章/日', () => {
      const plan = generateReadingPlan(
        {
          scope: 'nt_ot',
          chapters_per_day: 3,
          reading_order: '2-1',
          started_at: startDate,
          nt_start_book_index: 42, // 約翰福音
          start_chapter: 5, // shared start chapter (NT)
          ot_start_book_index: 1, // 出埃及記
          // Note: planGenerator currently uses a single start_chapter
          // for both NT and OT in parallel mode (limitation of v0.3).
        },
        books
      )
      // Day 1: 約 5, 6 + 出 5
      const days = firstNDays(plan, 1)
      expect(days[0]).toContain('約翰福音 5')
      expect(days[0]).toContain('約翰福音 6')
      expect(days[0]).toContain('出埃及記 5')
    })
  })

  describe('Mode 4: sequential nt_then_ot', () => {
    it('default: NT 太 1 + (after NT) OT 創 1', () => {
      const plan = generateReadingPlan(
        {
          scope: 'nt_ot',
          chapters_per_day: 10, // high to finish NT quickly
          reading_order: 'nt_then_ot',
          started_at: startDate,
        },
        books
      )
      // First day: 10 NT chapters (太 1-10)
      const days = firstNDays(plan, 1)
      expect(days[0]).toEqual([
        '馬太福音 1', '馬太福音 2', '馬太福音 3', '馬太福音 4', '馬太福音 5',
        '馬太福音 6', '馬太福音 7', '馬太福音 8', '馬太福音 9', '馬太福音 10',
      ])
    })
  })

  describe('start_book_index backwards-compat (single column)', () => {
    it('NT with start_book_index=42 (no per-testament column) → 約翰福音 1', () => {
      const plan = generateReadingPlan(
        {
          scope: 'nt',
          chapters_per_day: 2,
          started_at: startDate,
          start_book_index: 42,
          start_chapter: 1,
        },
        books
      )
      const days = firstNDays(plan, 1)
      expect(days[0]).toEqual(['約翰福音 1', '約翰福音 2'])
    })

    it('OT with start_book_index=1, start_chapter=30 → 出埃及記 30, 31', () => {
      const plan = generateReadingPlan(
        {
          scope: 'ot',
          chapters_per_day: 2,
          started_at: startDate,
          start_book_index: 1,
          start_chapter: 30,
        },
        books
      )
      const days = firstNDays(plan, 1)
      expect(days[0]).toEqual(['出埃及記 30', '出埃及記 31'])
    })
  })

  describe('no start position (legacy data)', () => {
    it('NT plan with no start fields → defaults to 太 1', () => {
      const plan = generateReadingPlan(
        { scope: 'nt', chapters_per_day: 2, started_at: startDate },
        books
      )
      const days = firstNDays(plan, 1)
      expect(days[0]).toEqual(['馬太福音 1', '馬太福音 2'])
    })

    it('OT plan with no start fields → defaults to 創 1', () => {
      const plan = generateReadingPlan(
        { scope: 'ot', chapters_per_day: 2, started_at: startDate },
        books
      )
      const days = firstNDays(plan, 1)
      expect(days[0]).toEqual(['創世記 1', '創世記 2'])
    })
  })

  // Migration 013: per-testament start chapter for nt_ot plans
  describe('nt_ot with per-testament start chapter (migration 013)', () => {
    it('OT side starts at 詩篇 110, NT side defaults to 太 1', () => {
      // Reproduces the original bug: OT user-picked Psalms chapter 110,
      // NT side defaulted. Before the fix, planGenerator would throw
      // "startChapter 110 exceeds start book (28 chapters)" because it
      // applied the OT chapter 110 to the NT side too.
      const plan = generateReadingPlan(
        {
          scope: 'nt_ot',
          chapters_per_day: 3,
          reading_order: '2-1', // 2 NT + 1 OT per day
          started_at: startDate,
          nt_start_book_index: 39, // 馬太
          nt_start_chapter: 1,
          ot_start_book_index: 18, // 詩篇
          ot_start_chapter: 110,
        },
        books
      )
      const days = firstNDays(plan, 2)
      // Day 1: NT 太 1, 2 + OT 詩篇 110
      expect(days[0]).toEqual(['馬太福音 1', '馬太福音 2', '詩篇 110'])
      // Day 2: NT 太 3, 4 + OT 詩篇 111
      expect(days[1]).toEqual(['馬太福音 3', '馬太福音 4', '詩篇 111'])
    })

    it('legacy start_chapter (no per-testament) is clamped when out of range', () => {
      // Pre-migration-013 enrollments wrote the same start_chapter to both
      // sides. If it was huge (e.g. 110) and the start_book was 5-chapter
      // (e.g. 帖前 51), the plan would throw. Now it clamps to 1.
      const plan = generateReadingPlan(
        {
          scope: 'nt_ot',
          chapters_per_day: 2,
          reading_order: '1-1',
          started_at: startDate,
          nt_start_book_index: 51, // 帖前 (5 chapters)
          ot_start_book_index: 18, // 詩篇
          // Only legacy start_chapter (no per-testament)
          start_chapter: 110,
        },
        books
      )
      const days = firstNDays(plan, 1)
      // NT side clamped to 帖前 1
      expect(days[0]).toContain('帖撒羅尼迦前書 1')
      // OT side: 110 is within 詩篇 (150 ch), so uses 110
      expect(days[0]).toContain('詩篇 110')
    })
  })

  // Migration 013 follow-up: nt_then_ot / ot_then_nt branches were also
  // using the legacy start_chapter column without clamping.
  describe('nt_ot sequential modes with per-testament start chapter', () => {
    it('nt_then_ot: primary testament uses nt_start_chapter', () => {
      const plan = generateReadingPlan(
        {
          scope: 'nt_ot',
          chapters_per_day: 5,
          reading_order: 'nt_then_ot',
          started_at: startDate,
          nt_start_book_index: 42, // 約翰福音
          nt_start_chapter: 5,
        },
        books
      )
      const days = firstNDays(plan, 1)
      expect(days[0]).toEqual(['約翰福音 5', '約翰福音 6', '約翰福音 7', '約翰福音 8', '約翰福音 9'])
    })

    it('nt_then_ot: legacy start_chapter=54 is clamped to NT start book chapters', () => {
      // Reproduces the user's reported error: "startChapter 54 exceeds
      // start book (3 chapters)" — when scope=nt_ot, reading_order=nt_then_ot,
      // nt_start_book_index is a 3-chapter book (eg 52 帖後), and the legacy
      // start_chapter=54 was wrongly applied to NT side.
      const plan = generateReadingPlan(
        {
          scope: 'nt_ot',
          chapters_per_day: 2,
          reading_order: 'nt_then_ot',
          started_at: startDate,
          nt_start_book_index: 52, // 帖後 (3 chapters)
          ot_start_book_index: 0,  // 創世記
          start_chapter: 54,        // legacy single column, exceeds 帖後 chapters
        },
        books
      )
      const days = firstNDays(plan, 1)
      // NT side clamped from 54 to 1 (帖後 only has 3 ch, so 54 > 3 → 1)
      expect(days[0]).toContain('帖撒羅尼迦後書 1')
    })

    it('ot_then_nt: primary testament uses ot_start_chapter', () => {
      const plan = generateReadingPlan(
        {
          scope: 'nt_ot',
          chapters_per_day: 3,
          reading_order: 'ot_then_nt',
          started_at: startDate,
          ot_start_book_index: 18, // 詩篇
          ot_start_chapter: 100,
        },
        books
      )
      const days = firstNDays(plan, 1)
      expect(days[0]).toEqual(['詩篇 100', '詩篇 101', '詩篇 102'])
    })

    it('ot_then_nt: secondary (NT) starts at user-picked nt_start_book', () => {
      // Reproduces user report 2026-07-16: nt_then_ot/ot_then_nt
      // previously ignored the secondary testament's user-chosen start
      // (hardcoded to 0/1). After fix, NT should start at user-picked book
      // (e.g. 約貳 = index 62), not 太 1.
      // Use ot_then_nt + 22/day. Day 43 leaves 5 OT chapters; day 44 fills
      // the remaining 17 quota from NT starting at the user-picked book.
      const plan = generateReadingPlan(
        {
          scope: 'nt_ot',
          chapters_per_day: 22,
          reading_order: 'ot_then_nt',
          started_at: startDate,
          ot_start_book_index: 0,
          ot_start_chapter: 1,
          nt_start_book_index: 62, // 約貳 (1 chapter) — matches user's "NT 從門開始"
          nt_start_chapter: 1,
        },
        books
      )
      const days = firstNDays(plan, 50)
      // Find the first day with NT refs (after OT runs out). Use NT-only
      // regex to avoid matching OT 書名 like 約書亞記.
      const ntRegex = /^(馬太|馬可|路加|約翰|使徒|羅馬|哥林多|加拉太|以弗所|腓立比|歌羅西|帖撒羅尼迦|提摩太|提多|腓利門|希伯來|雅各|彼得|約翰|猶大|啟示錄)/
      const firstNtDay = days.find((d) => d.some((r) => ntRegex.test(r)))
      expect(firstNtDay).toBeDefined()
      const firstNtRef = firstNtDay!.find((r) => ntRegex.test(r))!
      expect(firstNtRef).toBe('約翰二書 1')
      // Plan should never start NT at the legacy default (太/可/加/約翰福音)
      const legacyNtRefs = days.flat().filter((r) => /^(馬太|馬可|路加|約翰福音)/.test(r))
      expect(legacyNtRefs).toEqual([])
    })
  })
})