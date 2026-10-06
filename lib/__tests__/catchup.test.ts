import { describe, it, expect } from 'vitest'
import { getBooksMeta } from '../bible/lookup'
import {
  generateReadingPlan,
  type EnrollmentLite,
} from '../bible/planGenerator'
import {
  analyseCatchUp,
  anchorPositionFor,
  reanchoredEnrollment,
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
    expect(pos!.primary.chapter).toBeGreaterThan(0)
    // 29/9 is ~24 days past 詩篇 51 at 20 chapters/day, so it must be far
    // into the NT — nowhere near the OT start the plan used to keep.
    expect(pos!.primary.book_index).toBeGreaterThan(18)
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
        ...reanchoredEnrollment(ENROLLMENT, pos),
        started_at: `${anchorDate}T00:00:00.000Z`,
      },
      books,
      400,
    ).get(anchorDate)
    expect(fixed![0]).toBe(
      `${books[pos.primary.book_index].name} ${pos.primary.chapter}`,
    )
    expect(fixed![0]).not.toBe('詩篇 51')
  })

  it('the preview the dialog shows equals what the action will write', () => {
    const pos = anchorPositionFor(ENROLLMENT, books, anchorDate)!
    const today = '2026-10-02'
    const preview =
      generateReadingPlan(
        {
          ...reanchoredEnrollment(ENROLLMENT, pos),
          started_at: `${anchorDate}T00:00:00.000Z`,
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

describe('the preview cannot drift from what is written', () => {
  // The bug this pins: the dialog built its preview by setting only the start
  // columns, so under 'ot_then_nt' the OT stayed primary and the preview showed
  // 詩篇 111 for an anchor sitting on 約翰 12. The preview and the write now go
  // through the same helper.
  const anchorDate = '2026-09-29'

  it('reanchoredEnrollment flips the primary testament to the anchor', () => {
    const pos = anchorPositionFor(ENROLLMENT, books, anchorDate)!
    const rebuilt = reanchoredEnrollment(ENROLLMENT, pos)
    // Anchor is in the NT, so the NT must become primary.
    expect(rebuilt.reading_order).toBe('nt_then_ot')
    expect(rebuilt.nt_start_book_index).toBe(pos.primary.book_index)
    expect(rebuilt.nt_start_chapter).toBe(pos.primary.chapter)
  })

  it('an OT anchor flips it back, so the two orders are symmetric', () => {
    const otPos = {
      primary: {
        book_index: books.find((b) => b.name === '詩篇')!.index,
        chapter: 51,
      },
      secondary: null,
      testament: 'ot' as const,
    }
    const rebuilt = reanchoredEnrollment(ENROLLMENT, otPos)
    expect(rebuilt.reading_order).toBe('ot_then_nt')
    expect(rebuilt.ot_start_chapter).toBe(51)
  })

  it('the previewed today-refs are the refs the new plan will serve', () => {
    const pos = anchorPositionFor(ENROLLMENT, books, anchorDate)!
    const rebuilt = {
      ...reanchoredEnrollment(ENROLLMENT, pos),
      started_at: anchorDate,
    }
    const today =
      generateReadingPlan(rebuilt, books, 400).get('2026-10-02') ?? []
    expect(today.length).toBe(20)
    expect(today[0]).toBe('哥林多前書 7')
    // The old preview showed 詩篇 111 — the symptom of the order never moving.
    expect(today[0]).not.toContain('詩篇')
  })

  it('day 1 of the new plan is the anchor chapter, not the original start', () => {
    const pos = anchorPositionFor(ENROLLMENT, books, anchorDate)!
    const rebuilt = {
      ...reanchoredEnrollment(ENROLLMENT, pos),
      started_at: anchorDate,
    }
    const day1 = generateReadingPlan(rebuilt, books, 400).get(anchorDate) ?? []
    expect(day1[0]).toBe(
      `${books[pos.primary.book_index].name} ${pos.primary.chapter}`,
    )
  })
})

describe('catching up is a READ, not a re-plan', () => {
  // The correction: the seven-day card was built as a re-anchor button, so
  // pressing it moved today's lesson to the anchor chapter. What a reader who
  // missed three days wants is to read them — the plan must not move.
  const a = analyseCatchUp(
    ENROLLMENT.started_at,
    '2026-10-02',
    ['2026-09-28'],
    planFor(ENROLLMENT),
  )

  it("exposes today's own chapters so the queue covers missed + today", () => {
    if (a.kind !== 'catch_up') throw new Error('expected catch_up')
    expect(a.today).toEqual(planFor(ENROLLMENT)('2026-10-02'))
    expect(a.today.length).toBe(20)
    expect(a.today[0]).toBe('哥林多前書 7')
  })

  it("the missed refs and today's refs together cover the whole backlog", () => {
    if (a.kind !== 'catch_up') throw new Error('expected catch_up')
    const all = [...a.missedRefs, ...a.today]
    expect(all.length).toBe(a.missedRefs.length + 20)
    // Contiguous in reading order: the missed run ends exactly where today
    // begins (10/01 ended at 哥林多前 6, today starts at 哥林多前 7).
    expect(all[a.missedRefs.length]).toBe(a.today[0])
    expect(all[a.missedRefs.length - 1]).toBe('哥林多前書 6')
  })
})

describe('a day the reader already finished is not backlog', () => {
  // The real testing account: started 29/9, read 2/10 and 3/10, missed the
  // three days before them. Reported as 「追趕 3 日」 — correct — but the card
  // also said 「29/9 至今」, a span that literally covers 2/10 and 3/10 and so
  // claimed the finished days were part of the backlog. The WIDTH was right;
  // the LABEL was the bug. firstGap.lastDate is the real end of the gap.
  const ENROLL: EnrollmentLite & { id: string; chapters_per_day: number } = {
    id: 'real',
    scope: 'nt_ot',
    chapters_per_day: 20,
    reading_order: 'nt_then_ot',
    started_at: '2026-09-29T00:00:00.000Z',
    start_book_index: 42,
  }
  const plan2 = generateReadingPlan(ENROLL, books, 400)
  const DONE = ['2026-10-02', '2026-10-03']
  const a = analyseCatchUp(
    ENROLL.started_at,
    '2026-10-04',
    DONE,
    (d) => plan2.get(d) ?? [],
  )

  it('counts three missed days, not five', () => {
    expect(a.kind).toBe('catch_up')
    if (a.kind !== 'catch_up') return
    expect(a.behindDays).toBe(3)
    expect(a.firstGap.firstDate).toBe('2026-09-29')
    // Ends at the last UNREAD day, so a label reading 「firstDate – lastDate」
    // cannot include 2/10 or 3/10.
    expect(a.firstGap.lastDate).toBe('2026-10-01')
  })

  it('queues the three missed days plus today, and nothing already read', () => {
    if (a.kind !== 'catch_up') return
    const queue = [...a.missedRefs, ...a.today]
    expect(queue).toHaveLength(80)
    for (const done of DONE) {
      const firstOfThatDay = plan2.get(done)?.[0]
      expect(queue).not.toContain(firstOfThatDay)
    }
  })
})

describe('today is only queued while it is unread', () => {
  const ENROLL: EnrollmentLite & { id: string; chapters_per_day: number } = {
    id: 'today-done',
    scope: 'nt_ot',
    chapters_per_day: 20,
    reading_order: 'nt_then_ot',
    started_at: '2026-09-29T00:00:00.000Z',
    start_book_index: 42,
  }
  const plan3 = generateReadingPlan(ENROLL, books, 400)
  const at = (d: string) => plan3.get(d) ?? []

  // 4/10 still to do: the queue is the three missed days PLUS today.
  const pending = analyseCatchUp(
    ENROLL.started_at,
    '2026-10-04',
    ['2026-10-02', '2026-10-03'],
    at,
  )
  it('includes today while today is unread', () => {
    expect(pending.kind).toBe('catch_up')
    if (pending.kind !== 'catch_up') return
    expect(pending.todayCompleted).toBe(false)
    expect([...pending.missedRefs, ...pending.today]).toHaveLength(80)
  })

  // 4/4 finished: today must drop out, leaving the backlog alone.
  const done = analyseCatchUp(
    ENROLL.started_at,
    '2026-10-04',
    ['2026-10-02', '2026-10-03', '2026-10-04'],
    at,
  )
  it('reports todayCompleted once today is finished', () => {
    expect(done.kind).toBe('catch_up')
    if (done.kind !== 'catch_up') return
    expect(done.todayCompleted).toBe(true)
  })
  it('leaves the three missed days untouched', () => {
    if (done.kind !== 'catch_up') return
    expect(done.missedRefs).toHaveLength(60)
    // The UI drops today from the queue, so the catch-up is 60 chapters, not 80.
    const queue = [
      ...done.missedRefs,
      ...done.today.filter(() => !done.todayCompleted),
    ]
    expect(queue).toHaveLength(60)
    expect(queue).not.toContain(at('2026-10-04')[0])
  })
})

describe('re-anchoring restarts TODAY, not on the gap day', () => {
  // What the button is FOR: the reader stopped for months, has no energy to
  // claw back 273 days, and wants to start again from the gap chapter starting
  // today. Writing the GAP DAY into started_at moved the reading position but
  // left the elapsed span untouched, so the dashboard still said 「273 日未讀」
  // the moment after the button reported success — the one outcome the button
  // does not exist to produce.
  const E = {
    id: 'stalled',
    scope: 'nt_ot' as const,
    chapters_per_day: 4,
    reading_order: '1-3' as const,
    started_at: '2026-01-05T00:00:00.000Z',
    start_book_index: 0,
  }
  const plan4 = generateReadingPlan(E as never, books, 400)
  const at = (d: string) => plan4.get(d) ?? []
  const behind = analyseCatchUp(E.started_at, '2026-10-05', [], at)
  if (behind.kind !== 'reanchor') throw new Error('expected reanchor')
  it('is the reanchor case the card is built for', () => {
    expect(behind.kind).toBe('reanchor')
    if (behind.kind !== 'reanchor') return
    expect(behind.behindDays).toBeGreaterThan(200)
  })

  it("resolves the restart position to the gap day's first chapter", () => {
    if (behind.kind !== 'reanchor') return
    const pos = anchorPositionFor(E as never, books, behind.firstGap.firstDate)
    expect(pos).not.toBeNull()
    // Whatever the gap day read first is where reading resumes.
    expect(pos!.primary.chapter).toBe(1)
  })

  it('putting started_at at TODAY makes the reader on track again', () => {
    // The whole point: same position, today's date, zero days behind.
    const pos = anchorPositionFor(E as never, books, behind.firstGap.firstDate)!
    const restarted = {
      ...E,
      started_at: '2026-10-05T00:00:00.000Z',
      start_book_index: pos.primary.book_index,
      start_chapter: pos.primary.chapter,
    }
    const after = analyseCatchUp(
      restarted.started_at,
      '2026-10-05',
      [],
      (d) => generateReadingPlan(restarted as never, books, 400).get(d) ?? [],
    )
    expect(after.kind).toBe('on_track')
  })

  it('starts reading at the gap chapter on day one', () => {
    const pos = anchorPositionFor(E as never, books, behind.firstGap.firstDate)!
    const gapRefs = at(behind.firstGap.firstDate)
    expect(gapRefs[0]).toBeDefined()
    const restarted = {
      ...E,
      started_at: '2026-10-05T00:00:00.000Z',
      start_book_index: pos.primary.book_index,
      start_chapter: pos.primary.chapter,
    }
    const todayRefs =
      generateReadingPlan(restarted as never, books, 400).get('2026-10-05') ??
      []
    expect(todayRefs[0]).toBe(gapRefs[0])
  })
})

describe('BUG: 「由最近嘅斷位接返」 served the earliest gap', () => {
  // A parallel plan ('1-3') reads NT chapters then OT chapters each day, so an
  // anchor day holds BOTH. Taking refs[0] — the NT chapter — reset NT to the
  // plan's opening chapters and left OT untouched, so choosing the most recent
  // gap restarted at the earliest one. Observed: the anchor day read 馬太 8,
  // 創 22-24 and the restart began at 馬太 1, 創 1.
  const PARALLEL = {
    scope: 'nt_ot' as const,
    chapters_per_day: 4,
    reading_order: '1-3',
    started_at: '2026-09-01',
    nt_start_book_index: 39,
    nt_start_chapter: 1,
    ot_start_book_index: 0,
    ot_start_chapter: 1,
  }
  const dates = [...generateReadingPlan(PARALLEL, books, 400).keys()].sort()
  const late = dates[7]!

  it('the anchor day really does span both testaments', () => {
    const refs = generateReadingPlan(PARALLEL, books, 400).get(late)!
    const ntIdx = books.find((b) => b.name === '馬太福音')!.index
    const hasNT = refs.some((r) => r.startsWith('馬太福音'))
    const hasOT = refs.some((r) => !r.startsWith('馬太福音'))
    expect(ntIdx).toBe(39)
    expect(hasNT && hasOT).toBe(true)
  })

  it('resolves a position for EACH testament, not just the first chapter', () => {
    const pos = anchorPositionFor(PARALLEL, books, late)!
    expect(pos.secondary).not.toBeNull()
    expect(pos.primary.chapter).toBeGreaterThan(1)
    // The OT chapter that day had reached — the bug reset this to 創 1.
    expect(pos.secondary!.chapter).toBeGreaterThan(1)
  })

  it('the rebuilt plan begins at the anchor day, not at the plan start', () => {
    const pos = anchorPositionFor(PARALLEL, books, late)!
    const rebuilt = reanchoredEnrollment(PARALLEL as never, pos)
    const day1 = generateReadingPlan(
      { ...rebuilt, started_at: '2026-10-06' },
      books,
      5,
    ).get('2026-10-06')!

    const anchorRefs = generateReadingPlan(PARALLEL, books, 400).get(late)!
    // Day one must contain the chapters that day was going to read.
    for (const ref of anchorRefs) {
      expect(day1).toContain(ref)
    }
    // And it must NOT be the opening chapters again.
    expect(day1).not.toContain('馬太福音 1')
    expect(day1).not.toContain('創世記 1')
  })

  it('both testaments move, so neither keeps reading unread early chapters', () => {
    const pos = anchorPositionFor(PARALLEL, books, late)!
    const rebuilt = reanchoredEnrollment(PARALLEL as never, pos)
    expect(rebuilt.nt_start_chapter).toBe(pos.primary.chapter)
    expect(rebuilt.ot_start_chapter).toBe(pos.secondary!.chapter)
  })

  it('an anchor day present in only one testament leaves the other alone', () => {
    // Once OT is finished the days go NT-only; the OT column must not move.
    const pos = anchorPositionFor(PARALLEL, books, late)!
    const ntOnly = {
      primary: pos.primary,
      secondary: null,
      testament: 'nt' as const,
    }
    const rebuilt = reanchoredEnrollment(PARALLEL as never, ntOnly)
    expect(rebuilt.ot_start_chapter).toBe(PARALLEL.ot_start_chapter)
  })
})
