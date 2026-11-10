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
--   The function reads only the calling user's own rows (auth.uid()), so it
--   does not widen data access beyond what sessions_select RLS already grants;
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
  SELECT
    COALESCE(sum(rs.xp_earned), 0)::bigint AS total_xp,
    count(*)::bigint                       AS session_count,
    array(
      SELECT DISTINCT rs2.date_local
      FROM public.reading_sessions rs2
      WHERE rs2.user_id = p_user_id
      ORDER BY rs2.date_local
    )::date[]                             AS reading_dates
  FROM public.reading_sessions rs
  WHERE rs.user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION public.user_xp_streak_facts(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_xp_streak_facts(uuid) TO authenticated;

COMMIT;

-- VERIFY AFTER APPLY (expected for user 34f297de-70bd-45d6-81b6-4570227fafcc):
--   total_xp = 22660, session_count = 2266  (not 10000 / 1000)
-- SELECT * FROM public.user_xp_streak_facts(
--   '34f297de-70bd-45d6-81b6-4570227fafcc');
