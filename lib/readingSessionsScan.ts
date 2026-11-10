/**
 * Shared bounded pagination for `reading_sessions` SELECTs.
 *
 * WHY THIS EXISTS
 *   PostgREST applies a default `db-max-rows` cap (observed in production at
 *   1000) to every SELECT, and a plain `.select(...)` with no explicit bound
 *   inherits it silently: the response just contains fewer rows than match,
 *   with no error. For aggregate consumers that means wrong numbers — e.g.
 *   sum(xp_earned) over only the first 1000 rows understates total XP, and a
 *   streak built from a truncated date list is computed from incomplete data.
 *   Production has a reader with 2266 sessions on one enrollment, so every
 *   unbounded per-enrollment read is already past the cap.
 *
 * HOW IT STAYS SAFE WITHOUT A SINGLE BIG LIMIT
 *   Each request asks for exactly PAGE_SIZE rows and `.range()` walks offsets
 *   until a short page proves the end. A page size of 1000 is provably below
 *   the observed cap, so no single request can be truncated; the loop, not a
 *   limit header, decides when to stop. `maxRows` is a runaway guard against a
 *   pathological dataset, not the truncation mechanism — hitting it logs a
 *   warning instead of failing silently.
 */

/** Rows per request. Below the observed PostgREST db-max-rows cap (1000). */
const PAGE_SIZE = 1000

/** Runaway guard only: stop after this many rows and warn, never loop forever. */
export const SESSION_SCAN_MAX_ROWS = 200_000

/** Minimal shape of a PostgREST error surfaced through SessionScanResult. */
export interface ScanPageError {
  message: string
}

export interface SessionScanResult<T> {
  rows: T[]
  /** True when `maxRows` was hit before the scan finished — result is partial. */
  truncatedAtGuard: boolean
  /**
   * Set when a page errored mid-scan. Read-only consumers can log it and keep
   * going with what they got; fail-closed consumers (e.g. the markDayCompleteBatch
   * duplicate guard, which would bulk-insert rows it failed to check) must treat
   * a non-null error as "do not proceed".
   */
  scanError: ScanPageError | null
}

export interface SessionScanOptions {
  maxRows?: number
}

/**
 * Page through a fully-filtered `reading_sessions` SELECT until the last short
 * page proves the end, so callers see every matching row instead of the first
 * PostgREST cap-worth.
 *
 * Ordering is pinned to `id asc`: without an ORDER BY, Postgres makes no
 * promise that OFFSET pages stay disjoint across requests, and rows could be
 * skipped or counted twice. `id` is unique, so the walk is deterministic.
 *
 * The builder is typed loosely on purpose: it accepts a filtered (or even
 * already-`.limit(1)`-narrowed) PostgREST query builder, because every caller
 * has its own `.eq()`/`.in()` chain and its own row type.
 */
export async function fetchAllReadingSessions<Row = Record<string, unknown>>(
  // deno-lint-ignore no-explicit-any
  buildQuery: () => any,
  label: string,
  options: SessionScanOptions = {},
): Promise<SessionScanResult<Row>> {
  const maxRows = options.maxRows ?? SESSION_SCAN_MAX_ROWS
  const rows: Row[] = []
  let offset = 0

  while (rows.length < maxRows) {
    const { data, error } = await buildQuery()
      .order('id', { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error) {
      console.error(
        `[${label}] reading_sessions page failed at offset ${offset}:`,
        error.message,
      )
      return { rows, truncatedAtGuard: false, scanError: error }
    }

    const page = (data ?? []) as Row[]
    rows.push(...page)
    // A short page proves there is nothing left after it.
    if (page.length < PAGE_SIZE) {
      return { rows, truncatedAtGuard: false, scanError: null }
    }
    offset += PAGE_SIZE
  }

  console.warn(
    `[${label}] reading_sessions scan hit the ${maxRows}-guard; result may be partial`,
  )
  return { rows, truncatedAtGuard: true, scanError: null }
}
