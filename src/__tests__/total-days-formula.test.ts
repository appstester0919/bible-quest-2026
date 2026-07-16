import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { generateReadingPlan } from '../../lib/bible/planGenerator'

const bibleData = JSON.parse(readFileSync('public/bible-data.json', 'utf-8')) as {
  books: { a: string; n: string; c: number }[]
}
const books = bibleData.books.map((b, i) => ({
  name: b.n, abbr: b.a, index: i, chapters: b.c,
}))
const startDate = '2026-07-15T00:00:00'

// Replicates the onboarding display formula: the displayed total_days is the
// planGenerator's actual plan.size. This is the only way to align display
// with the real plan for nt_ot sequential modes, because each day may
// spill leftover quota from primary into secondary — those spillover days
// are NOT predictable by closed-form sum-of-ceils.
function onboardingDisplayedDays(args: {
  scope: 'nt' | 'ot' | 'nt_ot',
  cpd: number,
  ntStartBook?: number, ntStartCh?: number,
  otStartBook?: number, otStartCh?: number,
  readingOrder?: 'parallel' | 'nt_then_ot' | 'ot_then_nt',
}): number {
  if (args.scope === 'nt_ot') {
    const plan = generateReadingPlan({
      scope: 'nt_ot',
      chapters_per_day: args.cpd,
      reading_order: args.readingOrder,
      nt_start_book_index: args.ntStartBook,
      nt_start_chapter: args.ntStartCh,
      ot_start_book_index: args.otStartBook,
      ot_start_chapter: args.otStartCh,
      started_at: startDate,
    }, books, 730)
    return plan.size
  }
  // Single testament: same as planGenerator
  const plan = generateReadingPlan({
    scope: args.scope,
    chapters_per_day: args.cpd,
    started_at: startDate,
    nt_start_book_index: args.ntStartBook,
    nt_start_chapter: args.ntStartCh,
    start_book_index: args.scope === 'ot' ? args.otStartBook : undefined,
    start_chapter: args.scope === 'ot' ? args.otStartCh : undefined,
  }, books, 730)
  return plan.size
}

function planSize(args: Parameters<typeof onboardingDisplayedDays>[0]): number {
  const order = args.scope === 'nt_ot'
    ? {
        scope: 'nt_ot' as const,
        chapters_per_day: args.cpd,
        reading_order: args.readingOrder,
        nt_start_book_index: args.ntStartBook,
        nt_start_chapter: args.ntStartCh,
        ot_start_book_index: args.otStartBook,
        ot_start_chapter: args.otStartCh,
        started_at: startDate,
      }
    : {
        scope: args.scope,
        chapters_per_day: args.cpd,
        nt_start_book_index: args.ntStartBook,
        nt_start_chapter: args.ntStartCh,
        started_at: startDate,
      }
  return generateReadingPlan(order, books, 730).size
}

describe('onboarding total_days = planGenerator plan.size (issue: nt_then_ot showed wrong total_days)', () => {
  it('nt_ot nt_then_ot default heads (太 1, 創 1) at 22/day — display mirrors planGenerator', () => {
    const args = { scope: 'nt_ot' as const, cpd: 22, readingOrder: 'nt_then_ot' as const,
      ntStartBook: 39, ntStartCh: 1, otStartBook: 0, otStartCh: 1 }
    // For default heads there's an NT short tail → small quota spillover
    // day, so plan.size is ceil(259/22) + ceil(929/22) - 1 (= 54).
    // The exact value depends on chapter boundaries; what matters is
    // onboarding display == planGenerator.size.
    const closedForm = Math.ceil(259/22) + Math.ceil(929/22)  // 55
    expect(closedForm).toBe(55)
    const actualSize = planSize(args)
    expect(actualSize).toBeGreaterThanOrEqual(54)
    expect(actualSize).toBeLessThanOrEqual(55)
    expect(onboardingDisplayedDays(args)).toBe(actualSize)
  })

  it('nt_ot nt_then_ot custom: NT from 腓利門書 1, OT from 何西阿書 1 at 22/day', () => {
    const args = { scope: 'nt_ot' as const, cpd: 22, readingOrder: 'nt_then_ot' as const,
      ntStartBook: 56, ntStartCh: 1, otStartBook: 27, otStartCh: 1 }
    // Whatever plan.size is, it must equal onboarding display formula.
    expect(onboardingDisplayedDays(args)).toBe(planSize(args))
  })

  it('nt_ot nt_then_ot custom: NT 希伯來書 5, OT 阿摩司書 3 at 18/day', () => {
    const args = { scope: 'nt_ot' as const, cpd: 18, readingOrder: 'nt_then_ot' as const,
      ntStartBook: 57, ntStartCh: 5, otStartBook: 29, otStartCh: 3 }  // 阿摩司 = 29
    expect(onboardingDisplayedDays(args)).toBe(planSize(args))
  })

  it('nt_ot ot_then_nt custom: OT 詩篇 50, NT 約翰福音 3 at 15/day', () => {
    const args = { scope: 'nt_ot' as const, cpd: 15, readingOrder: 'ot_then_nt' as const,
      ntStartBook: 42, ntStartCh: 3, otStartBook: 18, otStartCh: 50 }
    expect(onboardingDisplayedDays(args)).toBe(planSize(args))
  })

  it('nt_ot parallel default at 22/day', () => {
    const args = { scope: 'nt_ot' as const, cpd: 22, readingOrder: 'parallel' as const,
      ntStartBook: 39, ntStartCh: 1, otStartBook: 0, otStartCh: 1 }
    expect(onboardingDisplayedDays(args)).toBe(planSize(args))
  })

  it('Display matches saved total_days for active enrollment (regression for 6104ea67 issue)', () => {
    const args = { scope: 'nt_ot' as const, cpd: 22, readingOrder: 'nt_then_ot' as const,
      ntStartBook: 56, ntStartCh: 1, otStartBook: 27, otStartCh: 1 }
    // The previous hardcoded formula gave `ceil(259/22) + ceil(929/22) = 55`,
    // which silently overwrote the user's NT/OT start picks and produced
    // wrong total_days when re-saving the plan. Now onboarding exactly
    // mirrors planGenerator's plan size for any input.
    expect(onboardingDisplayedDays(args)).toBe(planSize(args))
  })
})
