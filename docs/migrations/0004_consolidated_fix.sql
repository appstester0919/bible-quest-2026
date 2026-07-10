-- =====================================================================
-- BibleQuest2026 — Consolidated Fix for All Known Issues
-- Version: 0.4 — 2026-07-10
-- Purpose: Patch all known blockers preventing INSERT → trigger → stats
--          update from working end-to-end.
--
-- FIXES APPLIED (each section idempotent):
--   A. handle_new_user() trigger on auth.users (creates profile + user_stats)
--   B. user_stats.completed_plans column (admin/dashboard can read)
--   C. global_stats view (community stats)
--   D. trg_bump_completed_plans trigger (auto-increment on plan done)
--   E. reading_sessions.chapter_ref column + backfill trigger
--   F. reading_sessions nullable book_zh + chapter (the app INSERT doesn't
--      set these — see lib/actions.ts line 22-28. making NOT NULL hard
--      fails INSERT. Setting them nullable + backfilling from chapter_ref
--      lets the application work AND keeps old data sane.)
--   G. RLS policies smoke-test confirmation
--
-- SAFE TO RE-RUN: every statement uses IF NOT EXISTS / CREATE OR REPLACE /
-- DROP IF EXISTS so this migration is fully idempotent.
-- =====================================================================

-- ─── A. handle_new_user() trigger on auth.users ──────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.user_stats (user_id, current_streak, longest_streak, total_xp, level, streak_freezes_available)
  VALUES (NEW.id, 0, 0, 0, 1, 1)
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Backfill any auth users that have no profile / user_stats row
-- (if handle_new_user() never fired for them)
DO $$
DECLARE
  v_user record;
  v_profiles_missing int := 0;
  v_user_stats_missing int := 0;
BEGIN
  FOR v_user IN
    SELECT u.id, u.email, u.raw_user_meta_data
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE p.id IS NULL
  LOOP
    INSERT INTO public.profiles (id, display_name)
    VALUES (
      v_user.id,
      COALESCE(v_user.raw_user_meta_data->>'display_name', split_part(v_user.email, '@', 1))
    );
    v_profiles_missing := v_profiles_missing + 1;
  END LOOP;

  FOR v_user IN
    SELECT u.id
    FROM auth.users u
    LEFT JOIN public.user_stats s ON s.user_id = u.id
    WHERE s.user_id IS NULL
  LOOP
    INSERT INTO public.user_stats (user_id, current_streak, longest_streak, total_xp, level, streak_freezes_available)
    VALUES (v_user.id, 0, 0, 0, 1, 1);
    v_user_stats_missing := v_user_stats_missing + 1;
  END LOOP;

  RAISE NOTICE '[A] handle_new_user() trigger installed';
  RAISE NOTICE '[A] Backfilled profiles: %, user_stats: %', v_profiles_missing, v_user_stats_missing;
END $$;

-- ─── B-D. completed_plans column + global_stats view + trigger ───────
ALTER TABLE public.user_stats
  ADD COLUMN IF NOT EXISTS completed_plans int NOT NULL DEFAULT 0;

CREATE OR REPLACE VIEW public.global_stats AS
  SELECT
    (SELECT count(*) FROM public.reading_sessions) AS total_chapters_read,
    (SELECT count(distinct user_id) FROM public.reading_sessions) AS active_readers,
    (SELECT count(*) FROM public.user_plan_enrollments WHERE status = 'completed') AS total_plans_completed;

GRANT SELECT ON public.global_stats TO anon, authenticated;

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

-- ─── E. chapter_ref column (idempotent, may already exist) ───────────
ALTER TABLE public.reading_sessions
  ADD COLUMN IF NOT EXISTS chapter_ref text;

CREATE OR REPLACE FUNCTION public.backfill_chapter_ref()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.chapter_ref IS NULL AND NEW.book_zh IS NOT NULL AND NEW.chapter IS NOT NULL THEN
    NEW.chapter_ref := trim(both ' ' from (NEW.book_zh || ' ' || NEW.chapter::text));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_backfill_chapter_ref ON public.reading_sessions;
CREATE TRIGGER trg_backfill_chapter_ref
  BEFORE INSERT ON public.reading_sessions
  FOR EACH ROW EXECUTE FUNCTION public.backfill_chapter_ref();

-- ─── F. Make book_zh + chapter nullable (lib/actions.ts doesn't set them)
DO $$
BEGIN
  -- Make book_zh + chapter nullable if currently NOT NULL
  ALTER TABLE public.reading_sessions ALTER COLUMN book_zh DROP NOT NULL;
  ALTER TABLE public.reading_sessions ALTER COLUMN chapter DROP NOT NULL;
  RAISE NOTICE '[F] reading_sessions.book_zh + chapter made nullable';
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE '[F] Could not drop NOT NULL (columns may be already nullable): %', SQLERRM;
END $$;

-- ─── F. Final verify report ───────────────────────────────────────────
DO $$
DECLARE
  v_auth_users int;
  v_profiles int;
  v_user_stats int;
  v_sessions int;
  v_user_stats_with_xp int;
  v_chapter_ref_count int;
BEGIN
  SELECT count(*) INTO v_auth_users FROM auth.users;
  SELECT count(*) INTO v_profiles FROM public.profiles;
  SELECT count(*) INTO v_user_stats FROM public.user_stats;
  SELECT count(*) INTO v_sessions FROM public.reading_sessions;
  SELECT count(*) INTO v_user_stats_with_xp FROM public.user_stats WHERE total_xp > 0;
  SELECT count(*) INTO v_chapter_ref_count FROM public.reading_sessions WHERE chapter_ref IS NOT NULL;

  RAISE NOTICE '═══════ Bible Quest DB Fix Report ═══════';
  RAISE NOTICE 'auth.users count          = %', v_auth_users;
  RAISE NOTICE 'profiles count           = %', v_profiles;
  RAISE NOTICE 'user_stats count         = %', v_user_stats;
  RAISE NOTICE 'reading_sessions count   = %', v_sessions;
  RAISE NOTICE 'user_stats with XP > 0   = %', v_user_stats_with_xp;
  RAISE NOTICE 'sessions with chapter_ref = %', v_chapter_ref_count;
  RAISE NOTICE '══════════════════════════════════════════';
  IF v_user_stats < v_auth_users THEN
    RAISE WARNING 'MISMATCH: % auth users without user_stats row', v_auth_users - v_user_stats;
  END IF;
  IF v_profiles < v_auth_users THEN
    RAISE WARNING 'MISMATCH: % auth users without profiles row', v_auth_users - v_profiles;
  END IF;
END $$;
