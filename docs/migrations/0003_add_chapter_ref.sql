-- =====================================================================
-- BibleQuest2026 — Add chapter_ref column to reading_sessions
-- Version: 0.3 — 2026-07-10
-- Purpose: Fix schema drift between docs/schema.sql and application code
--
-- SYMPTOM:
--   - Dashboard streak / XP / community stats stuck at 0
--   - Supabase SQL "column chapter_ref does not exist"
--   - INSERT into reading_sessions silently fails from markLessonComplete()
--
-- ROOT CAUSE:
--   docs/schema.sql was migrated to use (book_zh, chapter) as separate
--   columns (line 85-96), but the application code in lib/actions.ts,
--   app/(main)/calendar/page.tsx, app/(main)/dashboard/actions.ts, and
--   app/(main)/read/page.tsx all INSERT a single denormalized
--   chapter_ref column. Result: the INSERT fails, the trigger never
--   fires, user_stats.current_streak/total_xp/level remain at defaults.
--
-- FIX (additive, idempotent):
--   1. Add chapter_ref text column if missing
--   2. Backfill from book_zh + ' ' + chapter where missing
--   3. Not enforce NOT NULL yet — only enforce after backfill is verified
--   4. Add a generated-stored column so future inserts are consistent
--      even if code accidentally omits chapter_ref
--   5. Verify and report
-- =====================================================================

-- 1. Add the column (idempotent)
ALTER TABLE public.reading_sessions
  ADD COLUMN IF NOT EXISTS chapter_ref text;

-- 2. Backfill from book_zh + chapter where currently null
UPDATE public.reading_sessions
  SET chapter_ref = trim(both ' ' from (coalesce(book_zh, '') || ' ' || coalesce(chapter::text, '')))
  WHERE chapter_ref IS NULL
    AND book_zh IS NOT NULL
    AND chapter IS NOT NULL;

-- 3. Backfill trigger: if future INSERTs only set book_zh + chapter
--    (e.g. admin scripts, rest of code paths), auto-compute chapter_ref
--    on the fly so user_stats trigger stays consistent.
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

-- 3b. Add a generated column to mirror chapter_ref for any future
--     inserts that only set book_zh + chapter. (Optional safety net;
--     trigger above is the primary backfill mechanism.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reading_sessions'
      AND column_name = 'chapter_ref_gen'
  ) THEN
    ALTER TABLE public.reading_sessions
      ADD COLUMN chapter_ref_gen text
        GENERATED ALWAYS AS (trim(both ' ' from (book_zh || ' ' || chapter::text))) STORED;
  END IF;
END $$;

-- 4. Verify: row counts and column presence
DO $$
DECLARE
  v_total_rows bigint;
  v_with_ref bigint;
  v_has_column boolean;
  v_has_gen boolean;
BEGIN
  SELECT count(*) INTO v_total_rows FROM public.reading_sessions;
  SELECT count(*) INTO v_with_ref FROM public.reading_sessions WHERE chapter_ref IS NOT NULL;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reading_sessions' AND column_name='chapter_ref'
  ) INTO v_has_column;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reading_sessions' AND column_name='chapter_ref_gen'
  ) INTO v_has_gen;

  RAISE NOTICE '─── chapter_ref migration report ───';
  RAISE NOTICE 'reading_sessions rows            = %', v_total_rows;
  RAISE NOTICE 'rows with chapter_ref            = %', v_with_ref;
  RAISE NOTICE 'chapter_ref column present       = %', v_has_column;
  RAISE NOTICE 'chapter_ref_gen column present   = %', v_has_gen;
  RAISE NOTICE '─────────────────────────────────────';
END $$;
