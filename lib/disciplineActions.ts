'use server'

/**
 * Server actions for the /discipline/* pages.
 *
 * Backed by three Supabase tables created in migration
 * `supabase/migrations/20260828000000_discipline_tables.sql`:
 *
 *   - discipline_goals    — 1 row per user (PK = user_id)
 *   - discipline_weekly   — 1 row per (user_id, iso_week)
 *   - discipline_sharing  — 1 row per (user_id, iso_week)
 *
 * All access is user-scoped via RLS (`*_sel_own` / `*_ins_own` / `*_upd_own` /
 * `*_del_own`). No service_role paths — the data is strictly user-private.
 *
 * Each function returns `{ ok: true, ... }` on success or
 * `{ ok: false, error: string }` on failure (auth failure, DB error, or
 * missing row for reads). This matches the `{ success, error }` style of
 * lib/actions.ts / lib/groupActions.ts but uses `ok` per the task brief.
 *
 * IMPORTANT — jsonb shape contracts (kept in sync with the migration):
 *
 *   discipline_goals.goals:
 *     Record<CategoryKey, GoalTarget[]>
 *     Each value is an array of length 1 or 2; length encodes the
 *     target count for that category (1 → single, 2 → dual). Empty
 *     categories are stored as [] (not null). All 5 keys always present.
 *
 *   discipline_weekly.cells:
 *     Record<CategoryKey, Record<DayKey, WeeklyCell>>
 *     WeeklyCell.targets is a boolean[] whose length MUST match the
 *     corresponding goals[categoryKey].length for this user — the UI
 *     is responsible for keeping them aligned (the server does not
 *     cross-validate, per the migration's "ui is responsible" note).
 */

import { createClient } from '@/lib/supabase/server'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CategoryKey =
  | 'virtue'
  | 'knowledge'
  | 'self_control'
  | 'godliness'
  | 'love'

export type DayKey = 'sat' | 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri'

/** A single target within a category: plan + steps (never partial). */
export type GoalTarget = { plan: string; steps: string }

/**
 * Full goals payload: all 5 categories × 1-2 targets each.
 * Empty categories → [].
 */
export type GoalsPayload = Record<CategoryKey, GoalTarget[]>

/** One cell in the weekly grid: per-target booleans + free-text note. */
export type WeeklyCell = { targets: boolean[]; note: string }

/** Full weekly payload: 5 cats × 7 days. */
export type WeeklyCellsPayload = Record<CategoryKey, Record<DayKey, WeeklyCell>>

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Get the current Supabase client + user, or null if not signed in.
 * Centralizes the "not signed in" early-return pattern used across the
 * other server-action files (lib/actions.ts, lib/groupActions.ts).
 */
async function getAuthClient(): Promise<
  | { supabase: Awaited<ReturnType<typeof createClient>>; user: { id: string } }
  | null
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  return { supabase, user: { id: user.id } }
}

// ─── 1. discipline_goals ──────────────────────────────────────────────────────
//
// 1 row per user. user_id is the PK so it doubles as the upsert conflict
// target — `onConflict: 'user_id'`. The `goals` jsonb is replaced as a whole
// (no partial-update API in v1). saved_at + updated_at are refreshed on every
// successful upsert so the UI's "✓ 已儲存於 …" label stays accurate.

/**
 * Upsert the goals payload for the current user.
 *
 * onConflict target: `user_id` (discipline_goals.user_id is PK).
 * jsonb shape: GoalsPayload — see top-of-file contract.
 *
 * Returns the freshly-written `saved_at` so the UI can mirror its
 * "✓ 已儲存於 …" stamp without re-reading.
 */
export async function upsertDisciplineGoals(
  goals: GoalsPayload
): Promise<{ ok: boolean; error?: string; savedAt?: string }> {
  const auth = await getAuthClient()
  if (!auth) return { ok: false, error: 'not signed in' }

  const now = new Date().toISOString()

  // upsert(...).select() — single round-trip; the SELECT returns the row
  // that was either inserted or updated so we can echo saved_at.
  const { data, error } = await auth.supabase
    .from('discipline_goals')
    .upsert(
      {
        user_id: auth.user.id,
        goals: goals as unknown as never,
        saved_at: now,
        updated_at: now,
      },
      { onConflict: 'user_id' }
    )
    .select('saved_at')
    .single()

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'upsert failed' }
  }

  return { ok: true, savedAt: (data as { saved_at: string }).saved_at }
}

/**
 * Read the goals payload for the current user.
 *
 * Returns `goals: undefined, savedAt: undefined` if no row exists yet
 * (first-time users land here). Callers should treat this as "show the
 * empty form, don't render a 'last saved' stamp".
 *
 * jsonb shape echoed: GoalsPayload.
 */
export async function getDisciplineGoals(): Promise<{
  ok: boolean
  goals?: GoalsPayload
  savedAt?: string
  error?: string
}> {
  const auth = await getAuthClient()
  if (!auth) return { ok: false, error: 'not signed in' }

  // .maybeSingle() — single row OR null (vs .single() which 406s on no row).
  // RLS guarantees this returns at most one row.
  const { data, error } = await auth.supabase
    .from('discipline_goals')
    .select('goals, saved_at')
    .eq('user_id', auth.user.id)
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: true }

  return {
    ok: true,
    goals: (data as { goals: GoalsPayload }).goals,
    savedAt: (data as { saved_at: string }).saved_at,
  }
}

/**
 * Destructive — DELETE the goals row for the current user.
 *
 * Wired to the goals page's "清空" reset button (which currently calls
 * `localStorage.removeItem`). Idempotent: succeeds whether or not a row
 * exists. RLS enforces that only the user's own row can be deleted.
 */
export async function resetDisciplineGoals(): Promise<{
  ok: boolean
  error?: string
}> {
  const auth = await getAuthClient()
  if (!auth) return { ok: false, error: 'not signed in' }

  const { error } = await auth.supabase
    .from('discipline_goals')
    .delete()
    .eq('user_id', auth.user.id)

  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

// ─── 2. discipline_weekly ─────────────────────────────────────────────────────
//
// 1 row per (user_id, iso_week). iso_week is the "YYYY-Www" string produced
// by the client-side `isoWeekString()` helper in
// app/(main)/discipline/components/WeekSelector.tsx. The composite UNIQUE
// index makes `onConflict: 'user_id,iso_week'` a natural choice.

/**
 * Upsert the weekly grid for a given ISO week.
 *
 * onConflict target: `user_id,iso_week` (UNIQUE constraint).
 * jsonb shape: WeeklyCellsPayload — see top-of-file contract.
 * Server does NOT cross-validate cells[cat].targets.length against
 * goals[cat].length; the UI owns alignment per its design doc.
 *
 * Returns `saved_at` so the per-week "✓ 已儲存於 …" stamp can render
 * without an extra round-trip.
 */
export async function upsertDisciplineWeekly(input: {
  isoWeek: string
  cells: WeeklyCellsPayload
}): Promise<{ ok: boolean; error?: string; savedAt?: string }> {
  const auth = await getAuthClient()
  if (!auth) return { ok: false, error: 'not signed in' }

  const { isoWeek, cells } = input
  const now = new Date().toISOString()

  const { data, error } = await auth.supabase
    .from('discipline_weekly')
    .upsert(
      {
        user_id: auth.user.id,
        iso_week: isoWeek,
        cells: cells as unknown as never,
        saved_at: now,
        updated_at: now,
      },
      { onConflict: 'user_id,iso_week' }
    )
    .select('saved_at')
    .single()

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'upsert failed' }
  }

  return { ok: true, savedAt: (data as { saved_at: string }).saved_at }
}

/**
 * Read the weekly grid for a given ISO week.
 *
 * Returns `cells: undefined, savedAt: undefined` if no row exists for that
 * (user, iso_week) — caller should render the empty form. The client uses
 * the same ISO week key on both read and write, so missing-row is the
 * expected first-launch state.
 *
 * jsonb shape echoed: WeeklyCellsPayload.
 */
export async function getDisciplineWeekly(isoWeek: string): Promise<{
  ok: boolean
  cells?: WeeklyCellsPayload
  savedAt?: string
  error?: string
}> {
  const auth = await getAuthClient()
  if (!auth) return { ok: false, error: 'not signed in' }

  const { data, error } = await auth.supabase
    .from('discipline_weekly')
    .select('cells, saved_at')
    .eq('user_id', auth.user.id)
    .eq('iso_week', isoWeek)
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: true }

  return {
    ok: true,
    cells: (data as { cells: WeeklyCellsPayload }).cells,
    savedAt: (data as { saved_at: string }).saved_at,
  }
}

// ─── 3. discipline_sharing ────────────────────────────────────────────────────
//
// 1 row per (user_id, iso_week). Two text columns (message + daily), no jsonb.
// Same UNIQUE strategy as discipline_weekly — `onConflict: 'user_id,iso_week'`.

/**
 * Upsert the sharing reflection for a given ISO week.
 *
 * onConflict target: `user_id,iso_week` (UNIQUE constraint).
 * No jsonb — `message` and `daily` are stored as plain `text` columns
 * (default '' for both). Empty strings round-trip cleanly so the UI's
 * "reset textarea" UX just sends ''.
 *
 * Returns `saved_at` for the stamp display.
 */
export async function upsertDisciplineSharing(input: {
  isoWeek: string
  message: string
  daily: string
}): Promise<{ ok: boolean; error?: string; savedAt?: string }> {
  const auth = await getAuthClient()
  if (!auth) return { ok: false, error: 'not signed in' }

  const { isoWeek, message, daily } = input
  const now = new Date().toISOString()

  const { data, error } = await auth.supabase
    .from('discipline_sharing')
    .upsert(
      {
        user_id: auth.user.id,
        iso_week: isoWeek,
        message,
        daily,
        saved_at: now,
        updated_at: now,
      },
      { onConflict: 'user_id,iso_week' }
    )
    .select('saved_at')
    .single()

  if (error || !data) {
    return { ok: false, error: error?.message ?? 'upsert failed' }
  }

  return { ok: true, savedAt: (data as { saved_at: string }).saved_at }
}

/**
 * Read the sharing reflection for a given ISO week.
 *
 * Returns `message: undefined, daily: undefined, savedAt: undefined`
 * if no row exists — caller should render the empty form. Empty
 * strings are echoed as '' (never undefined) when the row exists.
 */
export async function getDisciplineSharing(isoWeek: string): Promise<{
  ok: boolean
  message?: string
  daily?: string
  savedAt?: string
  error?: string
}> {
  const auth = await getAuthClient()
  if (!auth) return { ok: false, error: 'not signed in' }

  const { data, error } = await auth.supabase
    .from('discipline_sharing')
    .select('message, daily, saved_at')
    .eq('user_id', auth.user.id)
    .eq('iso_week', isoWeek)
    .maybeSingle()

  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: true }

  const row = data as { message: string; daily: string; saved_at: string }
  return {
    ok: true,
    message: row.message,
    daily: row.daily,
    savedAt: row.saved_at,
  }
}