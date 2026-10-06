import { describe, it, expect } from 'vitest'
import { generateReadingPlan } from '../bible/planGenerator'
import { getBooksMeta } from '../bible/lookup'
import bibleData2 from '../../public/bible-data.json'
const books = getBooksMeta(bibleData2 as never)
import { runsOf, formatRun, summariseRuns, countRuns } from '../refRange'

describe('refRange', () => {
  it('collapses consecutive chapters of one book into a run', () => {
    expect(runsOf(['提摩太前書 1', '提摩太前書 2', '提摩太前書 3'])).toEqual([
      { book: '提摩太前書', from: 1, to: 3 },
    ])
  })

  it('breaks a run when the book changes', () => {
    expect(runsOf(['約翰福音 1', '約翰福音 2', '哥林多前書 1'])).toEqual([
      { book: '約翰福音', from: 1, to: 2 },
      { book: '哥林多前書', from: 1, to: 1 },
    ])
  })

  it('breaks a run on a gap — a non-contiguous plan must not read as 1 - 99', () => {
    expect(runsOf(['詩篇 1', '詩篇 2', '詩篇 50'])).toEqual([
      { book: '詩篇', from: 1, to: 2 },
      { book: '詩篇', from: 50, to: 50 },
    ])
  })

  it('keeps an interleaved parallel plan as separate runs', () => {
    // 「兩章新約、六章舊約」 alternates books; it must not merge.
    expect(runsOf(['創 1', '太 1', '創 2', '太 2'])).toHaveLength(4)
  })

  it('leaves a single chapter unsuffixed', () => {
    expect(formatRun({ book: '詩篇', from: 3, to: 3 })).toBe('詩篇 3')
    expect(formatRun({ book: '詩篇', from: 1, to: 6 })).toBe('詩篇 1 - 6')
  })

  it('summarises a 120-chapter catch-up instead of listing every chapter', () => {
    const refs = [
      ...Array.from({ length: 100 }, (_, i) => `提摩太前書 ${i + 1}`),
      ...Array.from({ length: 20 }, (_, i) => `提摩太後書 ${i + 1}`),
    ]
    const out = summariseRuns(refs, 3)
    // 120 chapters collapses to TWO runs (one per book) — nothing to elide.
    expect(out).toBe('提摩太前書 1 - 100、提摩太後書 1 - 20')
    expect(out.length).toBeLessThan(80)

    // A genuinely fragmented list DOES elide, keeping head and tail.
    const many = Array.from({ length: 40 }, (_, i) =>
      i % 2 === 0 ? `詩篇 ${i + 1}` : `箴言 ${i + 1}`,
    )
    const elided = summariseRuns(many, 3)
    expect(elided).toContain('…')
    expect(elided.length).toBeLessThan(120)
  })

  it('does not elide when there are few enough runs to show all', () => {
    expect(summariseRuns(['創 1', '創 2', '出 1'], 3)).toBe('創 1 - 2、出 1')
  })

  it('counts the chapters, not the runs', () => {
    expect(countRuns(['創 1', '創 2', '創 3', '出 1'])).toBe(4)
  })

  it('handles verse suffixes like 「創 1:3」 without breaking the run', () => {
    expect(runsOf(['創 1:3', '創 2'])).toEqual([{ book: '創', from: 1, to: 2 }])
  })
})

describe('a short book name is never cut in half', () => {
  // The calendar tile used to render ref.substring(0, 6) + '…', a CHARACTER
  // count. 「提摩太後書 1」 is 8 characters, so it truncated to 「提摩太後…」 and
  // anything shorter collapsed to 「提」 — a chapter prefix, not a book the
  // reader can act on. A run form shortens the CHAPTER range, never the name.
  it('keeps the whole book name for a short name', () => {
    const refs = [
      '提摩太前書 1',
      '提摩太前書 2',
      '提摩太後書 1',
      '提摩太後書 2',
    ]
    expect(summariseRuns(refs, 2)).toBe('提摩太前書 1 - 2、提摩太後書 1 - 2')
  })

  it('each run carries its own book name, so no tile shows a lone 「提」', () => {
    const out = summariseRuns(['提摩太後書 1', '提摩太後書 3'], 2)
    expect(out).toContain('提摩太後書')
    expect(out).not.toMatch(/「?提」?$/)
  })

  it('elides the tail of a long day rather than a book name', () => {
    const refs = Array.from({ length: 20 }, (_, i) => `提摩太後書 ${i + 1}`)
    const out = summariseRuns(refs, 1)
    expect(out).toBe('提摩太後書 1 - 20')
    expect(out.startsWith('提摩太後書')).toBe(true)
  })
})

import {
  parseReadingPlan,
  CHINESE_BIBLE_ABBREVIATIONS,
} from '../chineseBibleAbbreviations'
import bibleData from '../../public/bible-data.json'

describe('the abbreviation table matches the Bible data exactly', () => {
  // 「提摩太后書」 (后, U+540E) was the key in the table while bible-data.json
  // spells it 「提摩太後書」 (後, U+5F8C). The forward lookup therefore ALWAYS
  // missed and fell through to charAt(0), so 2 Timothy rendered as 「提 1-3」 —
  // indistinguishable from a truncation bug, and wrong to any reader who knows
  // the canonical abbreviation is 提後. One wrong character broke one book for
  // every reader; a table test is the only thing that catches it.
  const bookNames = (bibleData as { books: { n: string }[] }).books.map(
    (b) => b.n,
  )

  it('has a key for every book in bible-data.json', () => {
    const missing = bookNames.filter((n) => !CHINESE_BIBLE_ABBREVIATIONS[n])
    expect(missing).toEqual([])
  })

  it('has no key that is not a real book (catches typos like 后/後)', () => {
    const extra = Object.keys(CHINESE_BIBLE_ABBREVIATIONS).filter(
      (n) => !bookNames.includes(n),
    )
    expect(extra).toEqual([])
  })

  it('gives 提摩太前書 and 提摩太後書 their canonical abbreviations', () => {
    expect(CHINESE_BIBLE_ABBREVIATIONS['提摩太前書']).toBe('提前')
    expect(CHINESE_BIBLE_ABBREVIATIONS['提摩太後書']).toBe('提後')
  })
})

describe('regression: the calendar tile showed 「提」 instead of 「提後」', () => {
  it('does not collapse a book that is already an abbreviation', () => {
    // Plan refs are ALREADY abbreviated (bible-data.json `a`: 提摩太後書 -> 提後).
    // parseReadingPlan looked the book up forward-only, missed, and fell back to
    // charAt(0) — so 「提後」 became 「提」, which reads like a truncation bug and
    // is wrong in a way a reader of 2 Timothy would catch immediately.
    const out = parseReadingPlan(['提後 1', '提後 2', '提後 3', '提後 4'])
    expect(out).toContain('提後')
    expect(out).not.toMatch(/(^|[^後])提\s*\d/)
  })

  it('still abbreviates a full book name', () => {
    expect(parseReadingPlan(['提摩太後書 1', '提摩太後書 2'])).toContain('提後')
    expect(parseReadingPlan(['提摩太前書 1', '提摩太前書 2'])).toContain('提前')
  })

  it('handles a mixed day of abbreviated and full names', () => {
    const out = parseReadingPlan(['歌羅西書 1', '提後 1', '提後 2', '提多書 1'])
    expect(out).toContain('提後')
    expect(out).not.toMatch(/(^|[^後])提\s*\d/)
  })

  it('keeps the canonical two-char abbreviation intact', () => {
    // Plan refs already carry the CANONICAL abbreviation (提摩太前書 -> 提前,
    // 提摩太後書 -> 提後), taken from bible-data.json's `a` field. The old tile
    // then ran substring(0, 6) over the WHOLE ref, which cut 「提前 1」 down to
    // 「提」 and made a real, recognised abbreviation look like a truncation
    // bug. summariseRuns must not re-cut what the data already abbreviates.
    expect(summariseRuns(['提前 1', '提前 2', '提後 1', '提後 2'], 2)).toBe(
      '提前 1 - 2、提後 1 - 2',
    )
  })
})

describe('a catch-up run records every day it covered', () => {
  // Finishing 「兩日 8 章」 from the catch-up queue used to write all eight
  // chapters under TODAY's date_local, because markDayCompleteBatch took a
  // single date. The missed day therefore stayed unread on the dashboard and
  // the calendar no matter how many chapters the reader actually finished.
  // Each chapter must land on the plan day it was scheduled for.
  const plan = generateReadingPlan(
    {
      scope: 'nt_ot',
      chapters_per_day: 4,
      reading_order: '1-3',
      started_at: '2026-10-04T00:00:00.000Z',
      start_book_index: 0,
    } as never,
    books,
    400,
  )

  it('maps each queued chapter to the day the plan scheduled it', () => {
    const missed = plan.get('2026-10-04') ?? []
    const today = plan.get('2026-10-05') ?? []
    expect(missed).toHaveLength(4)
    expect(today).toHaveLength(4)

    // The lookup the read page performs: first plan day owning each ref.
    const map = new Map<string, string>()
    for (const [date, refs] of plan)
      for (const r of refs) if (!map.has(r)) map.set(r, date)

    const queue = [...missed, ...today]
    const dates = queue.map((r) => map.get(r) ?? null)
    expect(dates.filter((d) => d === '2026-10-04')).toHaveLength(4)
    expect(dates.filter((d) => d === '2026-10-05')).toHaveLength(4)
  })

  it('a single-day queue still attributes every chapter to today', () => {
    const today = plan.get('2026-10-05') ?? []
    const map = new Map<string, string>()
    for (const [date, refs] of plan)
      for (const r of refs) if (!map.has(r)) map.set(r, date)
    for (const r of today) expect(map.get(r)).toBe('2026-10-05')
  })
})
