-- 0007 — Optional DB-side XP aggregate RPC (performance upgrade, NOT required
--        for correctness of the truncation fix)
--
-- WHY THIS EXISTS
--   recalcUserStatsAfterCompletion() / markDayCompleteBatch Step 2 used a bare
--   SELECT over reading_sessions to sum xp_earned and collect unique dates.
--   PostgREST silently caps a bare SELECT at its max-rows default (1000 in
--   production), so the reader with 2266 sessions got total_xp = 10,000 instead
--   of 22,660 — level and streak were computed from truncated data.
--
--   The app layer now fixes that by paging with .range() below the cap until a
--   short page proves the end (lib/readingSessionsScan.ts). That is correct at
--   any row count, but it ships every row to the client just to add them up.
--   This RPC does the summing inside Postgres instead: one round-trip, O(1)
--   payload, immune to max-rows forever.
--
-- APPLY OR SKIP?
--   The app code works WITHOUT this migration (paging fallback). Apply it when
--   you want to cut per-completion latency/payload for high-volume readers;
--   then switch the three recalc call sites in lib/actions.ts to
--   supabase.rpc('user_xp_streak_facts', { p_user_id: user.id }) — the returned
--   shape maps 1:1 onto what the current code derives locally.
--
-- SECURITY
--   SECURITY DEFINER + fixed search_path, following migration 0006's style.
--   The caller must be asking about their OWN user id: the function refuses
--   p_user_id <> auth.uid() outright. Without that check, SECURITY DEFINER
--   would let any signed-in user read another user's XP total and every
--   reading date they have logged — a data leak wider than the
--   sessions_select RLS policy it is meant to mirror.
--   EXECUTE is granted to authenticated only.
--
-- NOTE ON DISTINCT-USER COUNTS ELSEWHERE
--   global_stats.active_readers already uses count(DISTINCT user_id) at the DB
--   layer (migration 0005), so it never suffered this truncation class. No
--   app-layer code counts distinct users from raw reading_sessions rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.user_xp_streak_facts(p_user_id uuid)
RETURNS TABLE (
  total_xp bigint,          -- sum(xp_earned) over EVERY row for this user
  session_count bigint,    -- how many completion events exist (dedupe audit aid)
  reading_dates date[]     -- DISTINCT date_local, ascending — full list, no cap
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Every column is derived from ONE filtered set. A scalar subquery in the
  -- SELECT list does NOT inherit the outer WHERE clause, so a reading_dates
  -- array built as a standalone subquery would leak another user's dates
  -- even while total_xp and session_count were correctly withheld.
  WITH mine AS (
    SELECT rs.xp_earned, rs.date_local
    FROM public.reading_sessions rs
    WHERE rs.user_id = p_user_id
      AND p_user_id = auth.uid()
  )
  SELECT
    COALESCE(sum(mine.xp_earned), 0)::bigint AS total_xp,
    count(*)::bigint                       AS session_count,
    array(
      SELECT DISTINCT m2.date_local
      FROM mine m2
      ORDER BY m2.date_local
    )::date[]                             AS reading_dates
  FROM mine;
$$;

REVOKE ALL ON FUNCTION public.user_xp_streak_facts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_xp_streak_facts(uuid) TO authenticated;

COMMIT;

-- VERIFY AFTER APPLY (expected for user 34f297de-70bd-45d6-81b6-4570227fafcc):
--   total_xp = 22660, session_count = 2266  (not 10000 / 1000)
-- SELECT * FROM public.user_xp_streak_facts(
--   '34f297de-70bd-45d6-81b6-4570227fafcc');
