-- 0005 — global_stats.active_readers: restore the 30-day window
--
-- WHY
--   The dashboard label 「活躍讀者」 is defined as "distinct users who pressed
--   完成進度 in the last 30 days". That definition lived in the dashboard
--   component (commit 1e71326, 2026-07-11):
--
--       // Active readers: distinct users with sessions in last 30 days
--       const thirtyDaysAgo = new Date(Date.now() - 30*86400000).toISOString().split('T')[0]
--       const activeReaders = new Set(recentSessions.map(s => s.user_id)).size
--
--   Commit 455a004 (2026-07-15) replaced that client-side computation with a
--   single read of the `global_stats` view — but the view was defined as
--
--       (SELECT count(DISTINCT user_id) FROM public.reading_sessions) AS active_readers
--
--   with NO time window. The view was already correct for `total_chapters_read`
--   (cumulative by design) but `active_readers` silently became an ALL-TIME
--   count. The label never changed, so the number on screen started meaning
--   something else than the word under it.
--
--   Measured on production 2026-11-10:
--       before (all-time)   : 44
--       after  (30 days)    :  9
--       distinct users with a session in the last 7 days : 5
--
-- WHAT CHANGES
--   Only `active_readers`. `total_chapters_read` (總章數) and
--   `total_plans_completed` (完成計劃) stay cumulative — their labels match
--   their all-time semantics.
--
-- HOW TO APPLY
--   Either:
--     (a) run this file in the Supabase SQL Editor, or
--     (b) apply it via the Management API (works from this host):
--         curl -s -X POST "https://api.supabase.com/v1/projects/xybrbennsttjttxuxqoq/database/query" \
--           -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
--           -H "Content-Type: application/json" \
--           -d '{"query":"<contents of this file>"}'
--
-- NOTE ON TIMEZONE
--   The DB session timezone is UTC, but `reading_sessions.date_local` is an
--   HKT-based READING date (05:00 HKT cutoff — see lib/readingDate.ts). Using
--   bare `current_date` would compare a UTC date against an HKT reading date
--   and shift the window by up to 8 hours. The window is therefore anchored on
--   `(now() AT TIME ZONE 'Asia/Hong_Kong')::date`.

CREATE OR REPLACE VIEW public.global_stats AS
  SELECT
    (SELECT count(*) FROM public.reading_sessions) AS total_chapters_read,
    (SELECT count(DISTINCT reading_sessions.user_id)
       FROM public.reading_sessions
      WHERE reading_sessions.date_local >= (((now() AT TIME ZONE 'Asia/Hong_Kong')::date) - 30)
    ) AS active_readers,
    (SELECT count(*) FROM public.user_plan_enrollments
      WHERE status = 'completed') AS total_plans_completed;

GRANT SELECT ON public.global_stats TO anon, authenticated;

-- ── Verify ────────────────────────────────────────────────────────────────
-- Expect: active_readers = 9 (not 44), total_chapters_read = 11715,
--         total_plans_completed = 6
SELECT total_chapters_read, active_readers, total_plans_completed
  FROM public.global_stats;
