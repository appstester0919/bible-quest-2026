-- 0008 — Clean up duplicate completion events and recompute derived stats
--
-- WHY
--   markDayCompleteBatch() bulk-INSERTed one row per chapter without checking
--   whether that (enrollment_id, date_local, chapter_ref) was already
--   recorded. Re-completing a day, or a catch-up batch running over days that
--   were already marked, wrote the same completion event more than once —
--   worst on 2026-07-20. Because handle_session_insert() adds XP on every
--   inserted row, each duplicate inflated total_xp and therefore the level.
--
--   A second, separate defect inflated the same number: recalcUserStatsAfter
--   Completion() summed xp_earned over a bare SELECT, which PostgREST
--   silently caps at its max-rows default (1000 in production). One reader
--   with 2266 sessions was written total_xp = 10,000 instead of 22,660.
--   App-side paging (lib/readingSessionsScan.ts) fixes the second defect for
--   future recalcs; this migration recomputes the historical rows that were
--   written while it was broken.
--
-- WHAT THIS MIGRATION DOES
--   1. Deletes duplicate rows, keeping the EARLIEST row of each group.
--   2. Recomputes user_stats.total_xp / level from the deduplicated rows.
--   3. Leaves current_streak / longest_streak untouched — see STREAKS below.
--   4. Leaves user_achievements untouched — badges are kept, per owner
--      decision. Four users will hold a level badge above their recomputed
--      level; that is intended, a badge records "you reached this once".
--   5. Recomputes public.global_stats so total_chapters_read counts UNIQUE
--      completion events instead of raw rows.
--
-- DEDUPE KEY
--   (user_id, enrollment_id, date_local, chapter_ref).
--   enrollment_id IS PART OF THE KEY ON PURPOSE: the same user reading the
--   same chapter on the same day under a DIFFERENT plan enrollment is a
--   legitimate, distinct completion event (old plan finished, new plan
--   started), and is preserved.
--
-- WHICH ROW IS KEPT
--   The earliest by (completed_at, id). completed_at is the write timestamp
--   and id is the tiebreaker, so the survivor is deterministic. Every row in a
--   duplicate group carries the same xp_earned, so the choice does not
--   affect any user's XP.
--
-- STREAKS
--   current_streak / longest_streak are NOT rewritten. A streak is computed
--   from the set of DISTINCT date_local values, and the duplicate rows share
--   their date_local with the row they duplicate — so deduplication leaves
--   every user's distinct-date set byte-identical. Verified before applying:
--   44 users, 1133 distinct dates before and after, 0 differences.
--
-- LAUNCH BOUNDARY
--   No date cutoff is applied. Every row in the table was WRITTEN on or after
--   2026-07-17 (min(completed_at)), i.e. after the app was public; the
--   earlier date_local values are backfilled catch-up plan days, not
--   pre-launch data. A cutoff would therefore delete real readings.
--
-- SAFETY
--   Runs in one transaction. The deleted rows are first copied into
--   reading_sessions_dup_backup_0008 so they can be restored.

BEGIN;

-- ── 1. Back up the rows that are about to be deleted ───────────────────────
-- The column list is explicit rather than "LIKE ... INCLUDING ALL" because
-- chapter_ref_gen is a GENERATED column and cannot be written to directly.
CREATE TABLE IF NOT EXISTS public.reading_sessions_dup_backup_0008 (
  id                uuid,
  user_id           uuid,
  enrollment_id     uuid,
  day_number        integer,
  book_zh           text,
  chapter           integer,
  completed_at      timestamptz,
  date_local        date,
  xp_earned         integer,
  duration_sec      integer,
  chapter_ref       text
);

INSERT INTO public.reading_sessions_dup_backup_0008
  (id, user_id, enrollment_id, day_number, book_zh, chapter, completed_at,
   date_local, xp_earned, duration_sec, chapter_ref)
SELECT rs.id, rs.user_id, rs.enrollment_id, rs.day_number, rs.book_zh, rs.chapter,
       rs.completed_at, rs.date_local, rs.xp_earned, rs.duration_sec, rs.chapter_ref
FROM public.reading_sessions rs
WHERE EXISTS (
  SELECT 1 FROM public.reading_sessions k
  WHERE k.user_id = rs.user_id
    AND k.enrollment_id = rs.enrollment_id
    AND k.date_local = rs.date_local
    AND k.chapter_ref = rs.chapter_ref
    AND (k.completed_at, k.id) < (rs.completed_at, rs.id)
);

-- ── 2. Delete the duplicates, keeping the earliest row of each group ───────
DELETE FROM public.reading_sessions rs
USING public.reading_sessions k
WHERE k.user_id = rs.user_id
  AND k.enrollment_id = rs.enrollment_id
  AND k.date_local = rs.date_local
  AND k.chapter_ref = rs.chapter_ref
  AND (k.completed_at, k.id) < (rs.completed_at, rs.id);

-- ── 3. Recompute XP and level from the deduplicated rows ───────────────────
-- level = floor(sqrt(total_xp / 100)) + 1 — the same formula the app uses in
-- lib/actions.ts (recalcUserStatsAfterCompletion) and the DB trigger
-- handle_session_insert uses.
WITH agg AS (
  SELECT user_id, SUM(COALESCE(xp_earned, 0))::bigint AS xp
  FROM public.reading_sessions
  GROUP BY user_id
)
UPDATE public.user_stats us
SET total_xp = agg.xp,
    level = floor(sqrt(agg.xp::numeric / 100))::int + 1
FROM agg
WHERE us.user_id = agg.user_id
  AND (us.total_xp IS DISTINCT FROM agg.xp
       OR us.level IS DISTINCT FROM floor(sqrt(agg.xp::numeric / 100))::int + 1);

-- ── 4. global_stats: count UNIQUE completion events, not raw rows ─────────
CREATE OR REPLACE VIEW public.global_stats AS
SELECT
  (SELECT count(*) FROM (
      SELECT DISTINCT rs.user_id, rs.enrollment_id, rs.date_local, rs.chapter_ref
      FROM public.reading_sessions rs
    ) AS uniq_events) AS total_chapters_read,
  (SELECT count(DISTINCT reading_sessions.user_id)
     FROM public.reading_sessions
    WHERE reading_sessions.date_local >=
      (((now() AT TIME ZONE 'Asia/Hong_Kong')::date) - 30)) AS active_readers,
  (SELECT count(*)
     FROM public.user_plan_enrollments
    WHERE status = 'completed') AS total_plans_completed;

COMMIT;

-- ── 6. UNIQUE index — the authoritative integrity constraint ───────────────
-- The BEFORE INSERT trigger (migration 0006) is a guard, but a BEFORE ROW
-- trigger does not see rows written earlier by the SAME statement, and two
-- concurrent requests can both pass the EXISTS check before either commits.
-- The unique index closes both gaps at the storage layer: it is checked per
-- row as it is written, so it cannot be raced past.
--
-- This can only be created AFTER the historical duplicates are removed,
-- which is what step 2 above does.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_reading_session_event
  ON public.reading_sessions (user_id, enrollment_id, date_local, chapter_ref);

-- ── Verification ─────────────────────────────────────────────────────────────
-- SELECT * FROM public.global_stats;
--   total_chapters_read  = unique completion events (was the raw row count)
--   active_readers       = 30-day distinct readers (unchanged by this migration)
--   total_plans_completed = unchanged
--
-- SELECT count(*) FROM public.reading_sessions;
--   = raw rows after cleanup; must equal total_chapters_read, because after
--   deduplication every remaining row IS a distinct completion event.
--
-- SELECT count(*) FROM public.reading_sessions_dup_backup_0008;
--   = number of rows that were removed (2694 at time of writing).
--
-- SELECT u.total_xp, u.level, sum(rs.xp_earned) AS actual_xp
-- FROM public.user_stats u JOIN public.reading_sessions rs ON rs.user_id = u.user_id
-- GROUP BY u.user_id, u.total_xp, u.level
-- HAVING u.total_xp <> sum(rs.xp_earned);
--   = must return 0 rows.
--
-- ── Rollback ─────────────────────────────────────────────────────────────────
-- INSERT INTO public.reading_sessions SELECT * FROM public.reading_sessions_dup_backup_0008;
-- DROP VIEW public.global_stats;
-- CREATE OR REPLACE VIEW public.global_stats AS
-- SELECT
--   (SELECT count(*) FROM public.reading_sessions) AS total_chapters_read,
--   (SELECT count(DISTINCT reading_sessions.user_id)
--      FROM public.reading_sessions
--     WHERE reading_sessions.date_local >=
--       (((now() AT TIME ZONE 'Asia/Hong_Kong')::date) - 30)) AS active_readers,
--   (SELECT count(*) FROM public.user_plan_enrollments
--     WHERE status = 'completed') AS total_plans_completed;
-- DROP TABLE public.reading_sessions_dup_backup_0008;
