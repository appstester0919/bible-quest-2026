-- =====================================================================
-- BibleQuest2026 — Consolidated DB Patch (idempotent)
-- Version: 0.2 — 2026-07-10
-- Purpose: Ensure dashboard stats stay in sync with reading_sessions
--
-- WHY THIS EXISTS:
--   The 0001 migration added completed_plans column + global_stats view +
--   bump_completed_plans trigger, but those objects live in a separate SQL
--   file that the runbook doesn't always apply. The schema.sql /
--   triggers.sql docs drifted from this file. Running this migration
--   guarantees the dashboard query targets exist.
--
-- SAFE TO RE-RUN: every statement uses IF NOT EXISTS / CREATE OR REPLACE /
-- DROP ... IF EXISTS, so concurrent application is a no-op.
-- =====================================================================

-- ─── 1. user_stats.completed_plans (cumulative plan completions) ───
ALTER TABLE public.user_stats
  ADD COLUMN IF NOT EXISTS completed_plans int NOT NULL DEFAULT 0;

-- ─── 2. global_stats view (community stats from reading_sessions) ──
CREATE OR REPLACE VIEW public.global_stats AS
  SELECT
    (SELECT count(*) FROM public.reading_sessions) AS total_chapters_read,
    (SELECT count(distinct user_id) FROM public.reading_sessions) AS active_readers,
    (SELECT count(*) FROM public.user_plan_enrollments WHERE status = 'completed') AS total_plans_completed;

-- Allow anyone to read the view (dashboard anon)
GRANT SELECT ON public.global_stats TO anon, authenticated;

-- ─── 3. bump_completed_plans trigger (auto-increment on plan done) ─
CREATE OR REPLACE FUNCTION public.bump_completed_plans()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    UPDATE public.user_stats
      SET completed_plans = completed_plans + 1
      WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bump_completed_plans ON public.user_plan_enrollments;
CREATE TRIGGER trg_bump_completed_plans
  AFTER UPDATE OF status ON public.user_plan_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.bump_completed_plans();

-- ─── 4. Verify dashboard queries return data ──────────────────────
-- (read-only sanity checks; the migration is successful if these
-- queries don't error)

DO $$
DECLARE
  v_chapters bigint;
  v_active_readers bigint;
  v_plans_completed bigint;
  v_user_stats_rows int;
  v_has_completed_plans boolean;
BEGIN
  SELECT total_chapters_read, active_readers, total_plans_completed
    INTO v_chapters, v_active_readers, v_plans_completed
    FROM public.global_stats;

  SELECT count(*) INTO v_user_stats_rows FROM public.user_stats;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'user_stats'
      AND column_name = 'completed_plans'
  ) INTO v_has_completed_plans;

  RAISE NOTICE '─── Bible Quest DB Patch Report ───';
  RAISE NOTICE 'global_stats.total_chapters_read = %', v_chapters;
  RAISE NOTICE 'global_stats.active_readers     = %', v_active_readers;
  RAISE NOTICE 'global_stats.total_plans_completed = %', v_plans_completed;
  RAISE NOTICE 'user_stats rows                 = %', v_user_stats_rows;
  RAISE NOTICE 'completed_plans column present  = %', v_has_completed_plans;
  RAISE NOTICE '────────────────────────────────────';
END $$;
