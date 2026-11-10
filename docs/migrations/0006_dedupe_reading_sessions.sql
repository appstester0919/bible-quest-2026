-- 0006 — Prevent duplicate reading_sessions rows
--
-- ROOT CAUSE
--   markDayCompleteBatch() bulk-INSERTs one row per chapter without checking
--   whether that (enrollment_id, date_local, chapter_ref) was already
--   recorded. Tapping "complete the day" twice, or a catch-up batch running
--   over days that were already marked, wrote the same completion event more
--   than once. The 2026-07-20 catch-up batch is the largest source.
--
--   Because handle_session_insert() adds XP on every inserted row, each
--   duplicate also inflated total_xp and therefore the user's level.
--
-- WHAT THIS MIGRATION DOES
--   Installs a BEFORE INSERT trigger that silently drops an insert whose
--   (user_id, enrollment_id, date_local, chapter_ref) already exists.
--
--   Scope: future writes only. No historical rows are deleted and no XP,
--   level, streak or badge is recalculated here — that is migration 0007
--   (separate, needs explicit sign-off).
--
-- DEDUPE KEY
--   enrollment_id IS PART OF THE KEY ON PURPOSE.
--   The same user reading the same chapter on the same day under a DIFFERENT
--   plan enrollment is a legitimate, distinct completion event (e.g. the user
--   finished an old plan and started a new one that also contains that
--   chapter). Only an exact 4-tuple match is a duplicate.
--
-- SECURITY
--   SECURITY DEFINER + fixed search_path so the existence check sees the
--   rows regardless of the caller's RLS state, and so the function cannot be
--   hijacked by a caller-controlled search_path.
--
-- KNOWN LIMITATION
--   A BEFORE ROW trigger does not see rows inserted earlier by the SAME
--   statement (PostgreSQL uses the statement's snapshot). A single bulk
--   INSERT containing the same chapter twice is therefore not caught here.
--   The app layer (lib/actions.ts) filters those before inserting. The
--   authoritative guarantee — a UNIQUE index on
--   (user_id, enrollment_id, date_local, chapter_ref) — can only be created
--   once the historical duplicates are removed (migration 0007).

BEGIN;

CREATE OR REPLACE FUNCTION public.dedupe_reading_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.reading_sessions rs
    WHERE rs.user_id IS NOT DISTINCT FROM NEW.user_id
      AND rs.enrollment_id IS NOT DISTINCT FROM NEW.enrollment_id
      AND rs.date_local IS NOT DISTINCT FROM NEW.date_local
      AND rs.chapter_ref IS NOT DISTINCT FROM NEW.chapter_ref
  ) THEN
    -- Duplicate completion event — drop the row so it never lands.
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dedupe_reading_session ON public.reading_sessions;

-- Name sorts after trg_backfill_chapter_ref ('b' < 'd') so chapter_ref is
-- already populated when the duplicate check runs.
CREATE TRIGGER trg_dedupe_reading_session
BEFORE INSERT ON public.reading_sessions
FOR EACH ROW
EXECUTE FUNCTION public.dedupe_reading_session();

COMMIT;

-- ── Verification ─────────────────────────────────────────────────────────────
-- 1) trigger exists
-- SELECT tgname, pg_get_triggerdef(oid) FROM pg_trigger
--  WHERE tgrelid = 'public.reading_sessions'::regclass AND NOT tgisinternal;
--
-- 2) live counts must be UNCHANGED by this migration
-- SELECT count(*) AS raw_rows FROM public.reading_sessions;              -- 11723
-- SELECT count(*) FROM public.global_stats;                              -- 1 row
-- SELECT * FROM public.global_stats;
--
-- 3) duplicate-suppression smoke test (run inside a transaction, then
--    ROLLBACK so no data is left behind)
-- BEGIN;
-- INSERT INTO public.reading_sessions
--   (user_id, enrollment_id, chapter_ref, xp_earned, date_local, day_number)
-- SELECT user_id, enrollment_id, chapter_ref, 10, date_local, 1
-- FROM public.reading_sessions LIMIT 1;      -- duplicate → 0 rows inserted
-- ROLLBACK;
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
-- DROP TRIGGER IF EXISTS trg_dedupe_reading_session ON public.reading_sessions;
-- DROP FUNCTION IF EXISTS public.dedupe_reading_session();
