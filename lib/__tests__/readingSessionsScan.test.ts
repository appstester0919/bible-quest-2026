import { describe, it, expect } from 'vitest'
import {
  fetchAllReadingSessions,
  SESSION_SCAN_MAX_ROWS,
} from '../readingSessionsScan'

/**
 * Fake PostgREST: a `range(lo, hi)` page returns min(hi-lo+1, remaining) rows.
 * A bare (unpaged) query would return only `serverMaxRows` — the silent cap
 * that caused total_xp = 10,000 for a user with 2266 sessions.
 */
function fakeServer(totalRows: number, serverMaxRows = 1000) {
  const all = Array.from({ length: totalRows }, (_, i) => ({
    id: `r${i}`,
    xp_earned: 10,
    date_local: '2026-01-01',
  }))

  // Records every range() the caller applied, to prove paging happened.
  const ranges: Array<[number, number]> = []

  // Minimal builder mimicking the PostgREST chain used by the helper:
  // .order(...) then .range(lo, hi). No range => server cap applies.
  const buildQuery = () => ({
    order: () => buildQuery(),
    range: (lo: number, hi: number) => {
      ranges.push([lo, hi])
      const width = Math.min(hi - lo + 1, serverMaxRows)
      const page = all.slice(lo, lo + width)
      return Promise.resolve({ data: page, error: null })
    },
  })

  return { buildQuery, ranges }
}

describe('fetchAllReadingSessions', () => {
  it('returns EVERY row for a user above the PostgREST cap (the 2266-session bug)', async () => {
    const { buildQuery, ranges } = fakeServer(2266)
    const { rows, truncatedAtGuard, scanError } =
      await fetchAllReadingSessions<{
        id: string
        xp_earned: number
        date_local: string
      }>(buildQuery, 'test')

    // The old code silently summed only the first 1000 rows → 10,000 XP.
    // Full scan must see all 2266 rows → 22,660 XP.
    expect(rows.length).toBe(2266)
    const totalXp = rows.reduce((s, r) => s + (r.xp_earned ?? 0), 0)
    expect(totalXp).toBe(22660)
    expect(truncatedAtGuard).toBe(false)
    expect(scanError).toBeNull()

    // Three pages: 1000 + 1000 + 266 (short page proves the end).
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ])
  })

  it('single short page when under the cap (no extra round-trips)', async () => {
    const { buildQuery, ranges } = fakeServer(437)
    const { rows } = await fetchAllReadingSessions(buildQuery, 'test')
    expect(rows.length).toBe(437)
    expect(ranges).toEqual([[0, 999]])
  })

  it('zero rows', async () => {
    const { buildQuery } = fakeServer(0)
    const { rows, scanError } = await fetchAllReadingSessions(
      buildQuery,
      'test',
    )
    expect(rows.length).toBe(0)
    expect(scanError).toBeNull()
  })

  it('exact cap boundary (1000 rows): second empty page proves the end', async () => {
    const { buildQuery, ranges } = fakeServer(1000)
    const { rows } = await fetchAllReadingSessions(buildQuery, 'test')
    expect(rows.length).toBe(1000)
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ])
  })

  it('maxRows guard stops the scan and flags partiality', async () => {
    const { buildQuery } = fakeServer(5000)
    const { rows, truncatedAtGuard } = await fetchAllReadingSessions(
      buildQuery,
      'test',
      { maxRows: 2000 },
    )
    expect(rows.length).toBe(2000)
    expect(truncatedAtGuard).toBe(true)
  })

  it('surfaces a page error instead of pretending the scan is complete', async () => {
    const buildQuery = () => ({
      order: () => buildQuery(),
      range: () => Promise.resolve({ data: null, error: { message: 'boom' } }),
    })
    const { rows, scanError } = await fetchAllReadingSessions(
      buildQuery,
      'test',
    )
    expect(rows.length).toBe(0)
    expect(scanError?.message).toBe('boom')
  })

  it('guard constant is well above any plausible per-user session count', () => {
    expect(SESSION_SCAN_MAX_ROWS).toBeGreaterThanOrEqual(200_000)
  })
})
