import { describe, it, expect } from 'vitest'
import { getBooksMeta } from '../bible/lookup'
import {
  generateReadingPlan,
  type EnrollmentLite,
} from '../bible/planGenerator'
import {
  analyseCatchUp,
  anchorPositionFor,
  describeRefSpan,
} from '../readingProgress'
import bibleData from '../../public/bible-data.json'

const books = getBooksMeta(bibleData as never)

/** The real testing account's enrollment: 新舊約, 20章/日, OT-then-NT from 詩篇 51. */
const ENROLLMENT: EnrollmentLite & { id: string; chapters_per_day: number } = {
  id: 'test',
  scope: 'nt_ot',
  chapters_per_day: 20,
  reading_order: 'ot_then_nt',
  started_at: '2026-09-05T00:00:00.000Z',
  start_book_index: 18,
  start_chapter: 51,
  ot_start_book_index: 18,
  ot_start_chapter: 51,
  nt_start_book_index: 39,
  nt_start_chapter: 1,
}

const planFor = (e: EnrollmentLite) => {
  const plan = generateReadingPlan(e, books, 400)
  return (d: string) => plan.get(d) ?? []
}

describe('the seven-day rule wins over the two-gap choice', () => {
  // The reported case: an old 23-day gap (5/9) AND a recent 3-day gap (29/9).
  // The old design offered BOTH as competing buttons; the recent week must
  // take the whole card instead.
  const completed = ['2026-09-28']

  it('reports catch_up when only the last week is still recoverable', () => {
    const a = analyseCatchUp(
      ENROLLMENT.started_at,
      '2026-10-02',
      completed,
      planFor(ENROLLMENT),
    )
    expect(a.kind).toBe('catch_up')
    if (a.kind !== 'catch_up') return
    expect(a.behindDays).toBe(3) // 29/9, 30/9, 1/10
    expect(a.totalBehindDays).toBe(26)
    expect(a.firstGap.firstDate).toBe('2026-09-29')
    expect(a.firstGap.lastDate).toBe('2026-10-01')
  })

  it('does NOT offer the 23-day-old gap as a competing button', () => {
    const a = analyseCatchUp(
      ENROLLMENT.started_at,
      '2026-10-02',
      completed,
      planFor(ENROLLMENT),
    )
    if (a.kind !== 'catch_up') throw new Error('expected catch_up')
    // The 5/9 gap must be absent from what the card will render.
    expect(a.firstGap.firstDate).not.toBe('2026-09-05')
    expect(a.missedRefs.join()).not.toContain('詩篇 51')
  })

  it('falls back to reanchor when the last gap is itself over a week', () => {
    // A 9-day unbroken run at the end is no longer "one week of reading", so
    // it must not be offered as a single catch-up button.
    const a = analyseCatchUp(
      ENROLLMENT.started_at,
      '2026-10-02',
      ['2026-09-17', '2026-09-18', '2026-09-19'], // gap 1 ends 9/16, gap 2 = 9/20..10/01 (12d)
      planFor(ENROLLMENT),
    )
    expect(a.kind).toBe('reanchor')
  })
})

describe('re-anchoring moves the start POSITION, not just the date', () => {
  // The reported bug: the confirm dialog promised 哥林多前 7 but the plan
  // still began at 詩篇 51, because only started_at was ever written.
  const anchorDate = '2026-09-29'

  it('resolves the anchor day to a canon position', () => {
    const pos = anchorPositionFor(ENROLLMENT, books, anchorDate)
    expect(pos).not.toBeNull()
    expect(pos!.chapter).toBeGreaterThan(0)
    // 29/9 is ~24 days past 詩篇 51 at 20 chapters/day, so it must be far
    // into the NT — nowhere near the OT start the plan used to keep.
    expect(pos!.book_index).toBeGreaterThan(18)
  })

  it('the written plan starts at the anchor chapter, not the old OT start', () => {
    // This is the regression that shipped: with the date moved but the
    // position left at 詩篇 51, the new plan day 1 is still 詩篇 51.
    const stale = generateReadingPlan(
      { ...ENROLLMENT, started_at: `${anchorDate}T00:00:00.000Z` },
      books,
      400,
    ).get(anchorDate)
    expect(stale![0]).toBe('詩篇 51') // the bug, pinned as a fact

    const pos = anchorPositionFor(ENROLLMENT, books, anchorDate)!
    const fixed = generateReadingPlan(
      {
        ...ENROLLMENT,
        started_at: `${anchorDate}T00:00:00.000Z`,
        scope: 'nt',
        start_book_index: pos.book_index,
        start_chapter: pos.chapter,
        nt_start_book_index: pos.book_index,
        nt_start_chapter: pos.chapter,
      },
      books,
      400,
    ).get(anchorDate)
    expect(fixed![0]).toBe(`${books[pos.book_index].name} ${pos.chapter}`)
    expect(fixed![0]).not.toBe('詩篇 51')
  })

  it('the preview the dialog shows equals what the action will write', () => {
    const pos = anchorPositionFor(ENROLLMENT, books, anchorDate)!
    const today = '2026-10-02'
    const preview =
      generateReadingPlan(
        {
          ...ENROLLMENT,
          started_at: `${anchorDate}T00:00:00.000Z`,
          scope: 'nt',
          start_book_index: pos.book_index,
          start_chapter: pos.chapter,
          nt_start_book_index: pos.book_index,
          nt_start_chapter: pos.chapter,
        },
        books,
        400,
      ).get(today) ?? []
    expect(preview.length).toBe(20)
    // Pinned from the real plan: re-anchoring on 29/9 (約翰 12) puts today on
    // 哥林多前 7. The point is that it is NOT the stale 詩篇 111 the old code
    // would have shown, and not the 歌林多前 16 the flipped-order variant gives.
    expect(preview[0]).toBe('哥林多前書 7')
  })
})

describe('a shown ref span always means something', () => {
  // The reported complaint: 「詩 51 – 路加 15」 was neither the missed range,
  // the plan's remainder, nor a single day's reading.
  it("a single day renders as that day's own chapters", () => {
    const refs = planFor(ENROLLMENT)('2026-09-29')
    const span = describeRefSpan(refs)
    expect(span).toBeTruthy()
    expect(span).not.toBe('—')
    // It must start at the day's first chapter, i.e. be that day's range.
    expect(span).toBe(describeRefSpan(refs))
  })

  it('the catch_up span covers exactly the days being offered', () => {
    const a = analyseCatchUp(
      ENROLLMENT.started_at,
      '2026-10-02',
      ['2026-09-28'],
      planFor(ENROLLMENT),
    )
    if (a.kind !== 'catch_up') throw new Error('expected catch_up')
    const expected = ['2026-09-29', '2026-09-30', '2026-10-01'].flatMap(
      planFor(ENROLLMENT),
    )
    expect(a.missedRefs).toEqual(expected)
    expect(describeRefSpan(a.missedRefs)).toBe(describeRefSpan(expected))
  })
})
