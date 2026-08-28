-- ─── Discipline feature backend tables ───────────────────────────────────────
-- Created: 2026-08-28
-- Updated: 2026-08-28 (variable-target-count revision per mid-task user feedback)
-- Spec:   ~/.hermes/plans/bible-quest-2026-discipline-backend-2026-08-28.md
--
-- Three tables back the /discipline/* pages that currently persist only to
-- localStorage. The UI field shapes are unchanged — server actions will
-- JSON.stringify the existing client state and write it into the jsonb
-- column, keeping the client diff minimal.
--
--   discipline_goals   — 1 row per user (one-shot yearly goals form)
--                        5 categories × 1–2 targets per category
--                        Each target = { plan, steps }
--   discipline_weekly  — 1 row per (user, ISO week)
--                        5 categories × 7 days = 35 cells → jsonb blob
--                        Each cell = { targets: bool[], note: string }
--   discipline_sharing — 1 row per (user, ISO week)
--                        message + daily text → two text columns
--
-- ─── Variable-target-count design (goals table) ───────────────────────────────
-- Per user feedback (2026-08-28): each category supports 1 OR 2 targets.
-- The user said "無論有1或2個目標，他們都需要有steps field" — regardless of
-- whether a category has 1 or 2 goals, every goal needs both a plan AND a
-- steps field. So a target is never partial — it's always { plan, steps }
-- or absent (omitted from the array).
--
--   goals[categoryKey] = [
--     { plan: string, steps: string },   // target 1 (required)
--     { plan: string, steps: string }    // target 2 (optional — omit if 1)
--   ]
--
-- The array length is the source of truth: 1 means single-target, 2 means
-- dual-target. UI reads array.length and renders 1 or 2 input pairs.
--
-- ─── Per-target daily status (weekly table) ──────────────────────────────────
-- Daily cells are not a single bool — they track each target separately so
-- the UI can show partial progress (0/2, 1/2, 2/2) and color the cell
-- accordingly. A category with 1 goal has targets = [bool] (length 1);
-- a category with 2 goals has targets = [bool, bool] (length 2). The
-- targets array length must match the corresponding goals array length
-- for that category — the UI is responsible for keeping them aligned.
--
--   cells[categoryKey][dayKey] = {
--     targets: [bool, bool?],   // length 1 or 2, mirrors goals array
--     note:    string           // free-text note for the day
--   }
--
-- ─── Why jsonb blobs (not relational columns) ────────────────────────────────
--   - Smallest diff on the client (replace localStorage write with one fetch)
--   - Per-week and per-goals shapes may evolve; relational schema would
--     require a migration per shape change
--   - SELECT-only reads by user_id — no need to query inside the blob
--
-- ─── Why `iso_week` as text (not a derived date range) ───────────────────────
--   - Matches the client-side week key exactly (lib/weekKey.ts → `YYYY-Www`)
--   - UNIQUE (user_id, iso_week) gives us natural upsert conflict targets
--   - ISO week strings are sortable lexically and timezone-free
--
-- ─── Why service_role is NOT granted here ────────────────────────────────────
--   - Discipline data is strictly user-private (no cross-user reads, no cron
--     processing). All access is via authenticated user session, mirroring
--     the web_push_subscriptions pattern (see migration 20260722000000).
--
-- Run via: Supabase Dashboard → SQL Editor → paste & run
-- (Cannot deploy DDL from WSL — service_role key alone cannot run DDL.)

-- ─── 1. discipline_goals ──────────────────────────────────────────────────────
-- One row per user. user_id is PK so it doubles as the upsert conflict target
-- for the server action's `onConflict: 'user_id'`.
--
-- jsonb shape (variable 1–2 targets per category, every target has plan+steps):
--   {
--     "virtue":       [ { "plan": "...", "steps": "..." } ],                       -- 1 target
--     "knowledge":    [ { "plan": "...", "steps": "..." }, { "plan": "...", "steps": "..." } ],  -- 2 targets
--     "self_control": [ { "plan": "...", "steps": "..." } ],                       -- 1 target
--     "godliness":    [ { "plan": "...", "steps": "..." }, { "plan": "...", "steps": "..." } ],  -- 2 targets
--     "love":         [ { "plan": "...", "steps": "..." } ]                        -- 1 target
--   }
-- All 5 category keys are always present; each value is an array of length
-- 1 or 2. A category with no targets is stored as [] (not null).

CREATE TABLE IF NOT EXISTS public.discipline_goals (
  user_id    uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  goals      jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_at   timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ─── 2. discipline_weekly ─────────────────────────────────────────────────────
-- One row per (user, ISO week). Weekly grid of per-target status cells.
-- id PK + UNIQUE (user_id, iso_week) lets server actions upsert with
-- onConflict: 'user_id,iso_week'.
--
-- jsonb shape (per-target boolean array length mirrors goals array length):
--   {
--     "virtue": {
--       "sat": { "targets": [true,  false], "note": "..." },  -- 2-target category → bool[2]
--       "sun": { "targets": [false, false], "note": "..." },
--       "mon": { "targets": [true,  true],  "note": "..." },  -- 2/2 both done
--       "tue": { "targets": [false, true],  "note": "..." },  -- 1/2 partial
--       "wed": { "targets": [false, false], "note": "..." },
--       "thu": { "targets": [true,  false], "note": "..." },
--       "fri": { "targets": [false, false], "note": "..." }
--     },
--     "knowledge": {
--       "sat": { "targets": [true],         "note": "..." },  -- 1-target category → bool[1]
--       "sun": { "targets": [false],        "note": "..." },
--       ...
--     },
--     ...
--   }
-- Progress per cell is targets.filter(Boolean).length / targets.length
-- (0/2, 1/2, 2/2 for dual; 0/1, 1/1 for single). The UI must read the
-- corresponding goals[categoryKey].length to decide cell layout.

CREATE TABLE IF NOT EXISTS public.discipline_weekly (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  iso_week   text NOT NULL CHECK (iso_week ~ '^[0-9]{4}-W[0-9]{2}$'),
  cells      jsonb NOT NULL DEFAULT '{}'::jsonb,
  saved_at   timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, iso_week)
);

-- Composite index used by the weekly read path: WHERE user_id = me
-- ORDER BY iso_week DESC LIMIT 1 (latest week).
CREATE INDEX IF NOT EXISTS idx_discipline_weekly_user_week
  ON public.discipline_weekly (user_id, iso_week);

-- ─── 3. discipline_sharing ────────────────────────────────────────────────────
-- One row per (user, ISO week). Two free-text fields (message + daily).
-- Same shape as discipline_weekly — same UNIQUE strategy.

CREATE TABLE IF NOT EXISTS public.discipline_sharing (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  iso_week   text NOT NULL CHECK (iso_week ~ '^[0-9]{4}-W[0-9]{2}$'),
  message    text NOT NULL DEFAULT '',
  daily      text NOT NULL DEFAULT '',
  saved_at   timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, iso_week)
);

-- Composite index for the same latest-week lookup pattern.
CREATE INDEX IF NOT EXISTS idx_discipline_sharing_user_week
  ON public.discipline_sharing (user_id, iso_week);

-- ─── Grants for authenticated role ──────────────────────────────────────────
-- Match the web_push_subscriptions pattern (migration 20260722000000):
-- authenticated needs USAGE on schema + CRUD on each table, otherwise
-- the Rest API calls from the server action return 403.

GRANT USAGE ON SCHEMA public TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.discipline_goals
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.discipline_weekly
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.discipline_sharing
  TO authenticated;

-- ─── Enable RLS (idempotent) ─────────────────────────────────────────────────

ALTER TABLE public.discipline_goals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_weekly   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discipline_sharing  ENABLE ROW LEVEL SECURITY;

-- ─── Drop any old dev policies so we don't accumulate duplicates ─────────────
-- Mirror the DO $$ block pattern from 20260722000000_web_push_subscriptions_rls.sql.
-- Each table has 4 policies; safe to re-run this migration.

DO $$
BEGIN
  -- discipline_goals
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='discipline_goals'
               AND policyname='goals_sel_own') THEN
    DROP POLICY goals_sel_own ON public.discipline_goals;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='discipline_goals'
               AND policyname='goals_ins_own') THEN
    DROP POLICY goals_ins_own ON public.discipline_goals;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='discipline_goals'
               AND policyname='goals_upd_own') THEN
    DROP POLICY goals_upd_own ON public.discipline_goals;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='discipline_goals'
               AND policyname='goals_del_own') THEN
    DROP POLICY goals_del_own ON public.discipline_goals;
  END IF;

  -- discipline_weekly
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='discipline_weekly'
               AND policyname='weekly_sel_own') THEN
    DROP POLICY weekly_sel_own ON public.discipline_weekly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='discipline_weekly'
               AND policyname='weekly_ins_own') THEN
    DROP POLICY weekly_ins_own ON public.discipline_weekly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='discipline_weekly'
               AND policyname='weekly_upd_own') THEN
    DROP POLICY weekly_upd_own ON public.discipline_weekly;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='discipline_weekly'
               AND policyname='weekly_del_own') THEN
    DROP POLICY weekly_del_own ON public.discipline_weekly;
  END IF;

  -- discipline_sharing
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='discipline_sharing'
               AND policyname='sharing_sel_own') THEN
    DROP POLICY sharing_sel_own ON public.discipline_sharing;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='discipline_sharing'
               AND policyname='sharing_ins_own') THEN
    DROP POLICY sharing_ins_own ON public.discipline_sharing;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='discipline_sharing'
               AND policyname='sharing_upd_own') THEN
    DROP POLICY sharing_upd_own ON public.discipline_sharing;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='discipline_sharing'
               AND policyname='sharing_del_own') THEN
    DROP POLICY sharing_del_own ON public.discipline_sharing;
  END IF;
END
$$;

-- ─── Policies ────────────────────────────────────────────────────────────────
-- Each user can only access rows whose user_id matches their auth.uid().
-- All four verbs (SELECT / INSERT / UPDATE / DELETE) are user-scoped — no
-- cross-user reads, no service_role paths needed for v1.

-- discipline_goals ────────────────────────────────────────────────────────────
CREATE POLICY goals_sel_own ON public.discipline_goals
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY goals_ins_own ON public.discipline_goals
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY goals_upd_own ON public.discipline_goals
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY goals_del_own ON public.discipline_goals
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- discipline_weekly ───────────────────────────────────────────────────────────
CREATE POLICY weekly_sel_own ON public.discipline_weekly
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY weekly_ins_own ON public.discipline_weekly
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY weekly_upd_own ON public.discipline_weekly
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY weekly_del_own ON public.discipline_weekly
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- discipline_sharing ──────────────────────────────────────────────────────────
CREATE POLICY sharing_sel_own ON public.discipline_sharing
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY sharing_ins_own ON public.discipline_sharing
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY sharing_upd_own ON public.discipline_sharing
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY sharing_del_own ON public.discipline_sharing
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());

-- ─── Deploy notes ────────────────────────────────────────────────────────────
-- Paste this whole file into Supabase Dashboard → SQL Editor → Run.
-- Idempotent — re-running will drop and recreate the same policies without
-- losing data. Existing discipline_* rows (if any from earlier partial
-- deployment) are preserved.
--
-- Migration schema version: variable-target-count (2026-08-28 revision).
-- Earlier version of this file used Record<CategoryKey, {plan, steps}>
-- and cells = {checked: bool, note: string} — both superseded by this
-- variable-target-count shape. If you have deployed the prior version
-- and have rows, you may need to back-fill cells[categoryKey][dayKey]
-- .targets = [cells[categoryKey][dayKey].checked] before the UI will
-- render correctly for single-target categories.