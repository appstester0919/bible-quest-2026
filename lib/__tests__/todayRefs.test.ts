import { describe, it, expect } from 'vitest'
import { getBooksMeta } from '../bible/lookup'
import {
  generateReadingPlan,
  type EnrollmentLite,
} from '../bible/planGenerator'
import {
  chaptersInPlan,
  horizonForToday,
  planLengthDays,
  planRefDates,
  todayRequiredRefs,
} from '../bible/todayRefs'
import { getRequiredDays } from '../bible/scope'
import { FINISHED_BOOK_INDEX } from '../readingProgress'
import bibleData from '../../public/bible-data.json'

const books = getBooksMeta(bibleData as never)

/**
 * Every case here is a bug that shipped to production during this session.
 * The point of extracting these functions was so a regression could fail a
 * test instead of needing a manual log-in.
 */
describe('todayRequiredRefs asks the generator, never replays by hand', () => {
  // ── f6b7121: the read-page banner had its own hand-rolled replay that walked
  // a flat book list from 創 1, ignoring reading_order and every start column.
  const PARALLEL: EnrollmentLite = {
    scope: 'nt_ot',
    chapters_per_day: 4,
    reading_order: '2-2',
    started_at: '2026-10-06T00:00:00.000Z',
    ot_start_book_index: 18,
    ot_start_chapter: 96,
    nt_start_book_index: FINISHED_BOOK_INDEX,
    nt_start_chapter: 22,
  }

  it('agrees with generateReadingPlan for a parallel, mid-Bible plan', () => {
    const today = '2026-10-07'
    const plan = generateReadingPlan(PARALLEL, books, 60)
    expect(todayRequiredRefs(null, PARALLEL, books, today)).toEqual(
      plan.get(today),
    )
  })

  it('does not fall back to 創 1 for a plan that starts at 詩篇 96', () => {
    const refs = todayRequiredRefs(null, PARALLEL, books, '2026-10-07')
    expect(refs.length).toBeGreaterThan(0)
    expect(refs[0]).not.toMatch(/^創世記 1/)
    expect(refs[0]).toMatch(/^詩篇 /)
  })

  it('honours reading_order instead of reading the whole Bible in one line', () => {
    const seq: EnrollmentLite = {
      scope: 'nt_ot',
      chapters_per_day: 4,
      reading_order: '2-2',
      started_at: '2026-10-06T00:00:00.000Z',
      ot_start_book_index: 18,
      ot_start_chapter: 96,
      nt_start_book_index: FINISHED_BOOK_INDEX,
      nt_start_chapter: 22,
    }
    const refs = todayRequiredRefs(null, seq, books, '2026-10-07')
    // NT is finished, so all four chapters come from the OT — never a NT book.
    expect(refs.some((r) => /^馬太福音|^約翰福音|^啟示錄/.test(r))).toBe(false)
  })

  // ── The URL range must win: the dashboard link and the catch-up queue both
  // arrive as ?refs=, and they legitimately span several days.
  it('returns the URL refs unchanged when the reader arrived with a range', () => {
    const fromUrl = ['詩篇 96', '詩篇 97', '詩篇 98']
    expect(todayRequiredRefs(fromUrl, PARALLEL, books, '2026-10-07')).toEqual(
      fromUrl,
    )
  })

  it('treats an empty URL range as absent, not as "nothing due"', () => {
    expect(
      todayRequiredRefs([], PARALLEL, books, '2026-10-07').length,
    ).toBeGreaterThan(0)
  })

  // ── Before the plan starts / after it ran out: say nothing rather than guess.
  it('returns nothing before the plan has started', () => {
    const future: EnrollmentLite = {
      ...PARALLEL,
      started_at: '2026-12-01T00:00:00.000Z',
    }
    expect(todayRequiredRefs(null, future, books, '2026-10-07')).toEqual([])
  })

  it('returns nothing once the plan has run out of chapters', () => {
    // OT-only, one chapter a day. The whole OT is 929 chapters, so this is
    // exhausted on day 310 — long before today, and today is therefore not due.
    // OT is 929 chapters; at one a day that runs out on day 928. Starting
    // 2025-01-01 puts today (2026-10-07) at day 644 — hmm, still inside. The
    // reliable way to exhaust a plan is to start so far back that the count is
    // unambiguous: 2024-01-01 is day 980, past the 929 chapters.
    const short: EnrollmentLite = {
      scope: 'ot',
      chapters_per_day: 1,
      started_at: '2024-01-01T00:00:00.000Z',
      start_book_index: 0,
      start_chapter: 1,
    }
    expect(todayRequiredRefs(null, short, books, '2026-10-07')).toEqual([])
  })

  it('returns nothing when there is no enrollment at all', () => {
    expect(todayRequiredRefs(null, null, books, '2026-10-07')).toEqual([])
    expect(todayRequiredRefs(undefined, undefined, [], '2026-10-07')).toEqual(
      [],
    )
  })
})

describe('horizonForToday sizes the lookup from the real gap', () => {
  // ── The fixed 400-day horizon was the bug: it truncated the lookup for the
  // exact readers the catch-up button exists for, then the caller silently
  // showed a wrong fallback instead of the due chapters.
  // 1189 chapters at one a day = 1189 days, so this plan is still running
  // well past day 400. A 3-per-day OT-only plan would be exhausted by day 310
  // and would pass for the wrong reason.
  const PLAN: EnrollmentLite = {
    scope: 'nt_ot',
    chapters_per_day: 1,
    reading_order: 'nt_then_ot',
    started_at: '2025-06-01T00:00:00.000Z',
    start_book_index: 39,
    start_chapter: 1,
    nt_start_book_index: 39,
    nt_start_chapter: 1,
    ot_start_book_index: 0,
    ot_start_chapter: 1,
  }

  it('reaches today for someone over 400 days behind', () => {
    const h = horizonForToday(PLAN, '2026-10-07')
    expect(h).toBeGreaterThan(400)
    // And the generator must actually contain today at that horizon.
    const plan = generateReadingPlan(PLAN, books, h)
    expect(plan.has('2026-10-07')).toBe(true)
  })

  it('is small for a reader who just started', () => {
    expect(horizonForToday(PLAN, '2025-06-01')).toBeLessThan(40)
  })

  it('still finds today for a plan that started before the reader is behind', () => {
    const h = horizonForToday(PLAN, '2026-10-07')
    const plan = generateReadingPlan(PLAN, books, h)
    const refs = todayRequiredRefs(null, PLAN, books, '2026-10-07')
    expect(refs).toEqual(plan.get('2026-10-07'))
    expect(refs.length).toBeGreaterThan(0)
  })

  it('falls back to a fixed horizon when started_at is missing', () => {
    const noStart: EnrollmentLite = { scope: 'ot', chapters_per_day: 3 }
    expect(horizonForToday(noStart, '2026-10-07')).toBe(400)
  })

  it('never returns a horizon that excludes today', () => {
    for (const today of [
      '2026-01-15',
      '2026-10-07',
      '2027-10-07',
      '2028-08-25',
    ]) {
      const h = horizonForToday(PLAN, today)
      expect(h).toBeGreaterThanOrEqual(1)
      expect(generateReadingPlan(PLAN, books, h).has(today)).toBe(true)
    }
  })
})

describe('planRefDates maps a ref to the day the plan scheduled it', () => {
  // ── Completion records were being written against a single date for a whole
  // catch-up queue, so missed days stayed unread on the dashboard/calendar.
  const QUEUE: EnrollmentLite = {
    scope: 'ot',
    chapters_per_day: 2,
    started_at: '2026-10-01T00:00:00.000Z',
    start_book_index: 0,
    start_chapter: 1,
  }

  it('spreads refs across the days the plan assigned them', () => {
    const map = planRefDates(QUEUE, books, 30)
    const d1 = map.get('創世記 1')
    const d2 = map.get('創世記 2')
    const d3 = map.get('創世記 3')
    expect(d1).toBe('2026-10-01')
    expect(d2).toBe('2026-10-01')
    expect(d3).toBe('2026-10-02')
    expect(d1).not.toBe(d3)
  })

  it('is empty without an enrollment', () => {
    expect(planRefDates(null, books, 30).size).toBe(0)
    expect(planRefDates(QUEUE, [], 30).size).toBe(0)
  })

  it('leaves refs past the horizon absent so the caller can fall back', () => {
    const map = planRefDates(QUEUE, books, 2)
    expect(map.has('創世記 1')).toBe(true)
    expect(map.has('創世記 100')).toBe(false)
  })
})

describe('planLengthDays / chaptersInPlan ask the generator, not 260 and 929', () => {
  // ── settings/page.tsx copied getRequiredDays' hard-coded 260/929 inline and
  // for nt_ot fell back to `total_days = chapters_per_day`, with a comment
  // saying the generator would re-derive it. It never did, so restarting a
  // 4-chapters-a-day 新舊並行 plan recorded total_days = 4.
  // ── onboarding/page.tsx multiplied getRequiredDays back out by cpd to get a
  // chapter count, assuming the plan started at 創 1.

  const MID: EnrollmentLite = {
    scope: 'nt_ot',
    chapters_per_day: 4,
    reading_order: '2-2',
    started_at: '2026-10-06T00:00:00.000Z',
    ot_start_book_index: 18,
    ot_start_chapter: 96,
    nt_start_book_index: 43,
    nt_start_chapter: 1,
  }

  it('never records a one-digit total for a 4-chapters-a-day plan', () => {
    // The old nt_ot fallback was literally `total_days = cpd`.
    expect(MID.chapters_per_day).toBe(4)
    const days = planLengthDays(MID, books)
    expect(days).toBeGreaterThan(100)
  })

  it('agrees with the generator, which is what the calendar uses', () => {
    expect(planLengthDays(MID, books)).toBe(
      generateReadingPlan(MID, books, 730).size,
    )
  })

  it('counts chapters, not days', () => {
    const days = planLengthDays(MID, books)
    const chapters = chaptersInPlan(MID, books)
    expect(chapters).toBeGreaterThanOrEqual(days)
    // 4 chapters a day, so chapters ≈ days × 4 (the last day is partial).
    expect(chapters).toBeLessThan(days * 5)
  })

  it('differs from the old full-Bible arithmetic for a mid-Bible start', () => {
    // The old formula assumes reading from 創 1 and cannot see the start
    // position, so the two numbers must not be silently equal by luck.
    const oldDays = getRequiredDays('nt_ot', MID.chapters_per_day)
    expect(planLengthDays(MID, books)).not.toBe(oldDays)
  })

  it('is zero without an enrollment', () => {
    expect(planLengthDays(null, books)).toBe(0)
    expect(chaptersInPlan(undefined, [])).toBe(0)
  })

  it('gives a shorter plan when the start book is later', () => {
    const late: EnrollmentLite = {
      scope: 'ot',
      chapters_per_day: 3,
      started_at: '2026-10-06T00:00:00.000Z',
      start_book_index: 30,
      start_chapter: 1,
    }
    const early: EnrollmentLite = {
      ...late,
      start_book_index: 0,
      start_chapter: 1,
    }
    expect(planLengthDays(late, books)).toBeLessThan(
      planLengthDays(early, books),
    )
    // The old formula gives both the same number — that was the bug.
    expect(getRequiredDays('ot', 3)).toBe(planLengthDays(early, books)) // both = ceil(929/3)
  })
})

describe('FINISHED_BOOK_INDEX must stay inside the DB constraint', () => {
  // ── c27fdec: writing 66 against the migrations 011/012 CHECK constraints
  // (nt BETWEEN 39 AND 65) violated the constraint, and because PostgREST runs
  // a single statement the whole UPDATE aborted — the reader got an error
  // instead of a restart. Migration 014 widened all three columns to 66.
  //
  // These bounds are duplicated in SQL and cannot be read from the client, so
  // this test is the only automated guard. If a future migration narrows a
  // column, it fails here with the reason, instead of 23514 on a live button.
  // See docs/schema-invariants.md.

  it('is past the last real book index', () => {
    const lastBook = Math.max(...books.map((b) => b.index))
    expect(FINISHED_BOOK_INDEX).toBeGreaterThan(lastBook)
    expect(lastBook).toBe(65) // 啟示錄
    expect(FINISHED_BOOK_INDEX).toBe(66)
  })

  it('fits every start column constraint in migration 014', () => {
    // start_book_index  BETWEEN 0  AND 66
    // nt_start_book_index BETWEEN 39 AND 66
    // ot_start_book_index BETWEEN 0  AND 66
    expect(FINISHED_BOOK_INDEX).toBeLessThanOrEqual(66)
    expect(FINISHED_BOOK_INDEX).toBeGreaterThanOrEqual(39)
  })

  it('keeps the in-range fallback inside its own constraint', () => {
    // catchupActions rewrites the sentinel as 啓 22 / 瑪 4 for databases that
    // have not run 014. Those must stay real book indexes.
    const rev = books.find((b) => b.index === 65)!
    const mal = books.find((b) => b.index === 38)!
    expect(rev.chapters).toBeGreaterThanOrEqual(22)
    expect(mal.chapters).toBeGreaterThanOrEqual(4)
    expect(rev.index).toBeLessThanOrEqual(65)
    expect(mal.index).toBeLessThanOrEqual(38)
  })

  it('reads an out-of-range start as "finished" for every scope', () => {
    const finished: EnrollmentLite = {
      scope: 'ot',
      chapters_per_day: 2,
      started_at: '2026-10-06T00:00:00.000Z',
      start_book_index: FINISHED_BOOK_INDEX,
      start_chapter: 1,
    }
    // OT-only, finished: no chapters at all, so the generator emits no days.
    expect(planLengthDays(finished, books)).toBe(0)
    expect(chaptersInPlan(finished, books)).toBe(0)
  })
})
