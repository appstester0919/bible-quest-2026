// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  getTotalChapters,
  getChaptersPerDay,
  getEstimatedCompletionDate,
  SCOPE_CHAPTERS,
} from '../../lib/bible/scope'

describe('scope.ts', () => {
  describe('getTotalChapters', () => {
    it('nt = 260', () => expect(getTotalChapters('nt')).toBe(260))
    it('ot = 929', () => expect(getTotalChapters('ot')).toBe(929))
    it('nt_ot = 1189', () => expect(getTotalChapters('nt_ot')).toBe(1189))
  })

  describe('getChaptersPerDay', () => {
    it('nt 260 chapters / 60 days = 5 (ceil)', () =>
      expect(getChaptersPerDay('nt', 60)).toBe(5))
    it('nt 260 chapters / 40 days = 7 (ceil)', () =>
      expect(getChaptersPerDay('nt', 40)).toBe(7))
    it('nt 260 chapters / 365 days = 1 (ceil)', () =>
      expect(getChaptersPerDay('nt', 365)).toBe(1))
    it('ot 929 chapters / 90 days = 11 (ceil)', () =>
      expect(getChaptersPerDay('ot', 90)).toBe(11))
    it('nt_ot 1189 chapters / 365 days = 4 (ceil)', () =>
      expect(getChaptersPerDay('nt_ot', 365)).toBe(4))
  })

  describe('getEstimatedCompletionDate', () => {
    it('returns a date later than start date', () => {
      const start = new Date('2026-07-01')
      const result = getEstimatedCompletionDate('nt', 60, start)
      expect(result.getTime()).toBeGreaterThan(start.getTime())
    })

    it('is exactly start + the day count the plan reports', () => {
      const start = new Date('2026-07-01')
      const result = getEstimatedCompletionDate('nt', 60, start)
      const diff = (result.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
      // This used to assert 52 — start + ceil(260 / ceil(260/60)). The
      // recomputation assumed reading from the first chapter of the Bible, so
      // a plan starting mid-Bible kept the full-length finish date while 總天數
      // moved. The plan's own day count is the answer; trust it.
      expect(diff).toBe(60)
    })

    it('moves with the day count', () => {
      const start = new Date('2026-07-01')
      const short = getEstimatedCompletionDate('nt', 30, start)
      const long = getEstimatedCompletionDate('nt', 60, start)
      expect(short.getTime()).toBeLessThan(long.getTime())
    })
  })
})
