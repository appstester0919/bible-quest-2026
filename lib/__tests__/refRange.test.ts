import { describe, it, expect } from 'vitest'
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
