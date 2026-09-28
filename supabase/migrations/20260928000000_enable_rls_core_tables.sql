-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: enable RLS on the three un-protected core tables
--
-- WHY: repo-wide grep for `ENABLE ROW LEVEL SECURITY` found policies defined
-- for 7 tables (web_push_subscriptions, group_nudges, discipline_*, groups,
-- group_members, group_join_requests, group_checkins) but NONE for profiles,
-- user_stats or reading_sessions — while app code queries all three directly
-- from the browser with the anon key. Postgres does NOT enforce a policy until
-- RLS is enabled on the table, so every policy written for reading_sessions
-- (migration 20260816000001_reading_sessions_select_for_members.sql) has been
-- inert: any visitor could read every user's profile, XP/streak, and full
-- reading history.
--
-- SCOPE — deliberately NOT touched:
--   * public.global_stats is a VIEW, intentionally `GRANT SELECT ... TO anon`
--     (docs/migrations/0004_consolidated_fix.sql:94). It is the community-wide
--     read-progress counter the dashboard shows to every user. Views execute
--     with the view owner's privileges, so it keeps working regardless of RLS
--     on the tables underneath. DO NOT enable RLS on it.
--   * user_plan_enrollments is already self-scoped everywhere it is queried
--     (dashboard/page.tsx:158, read/page.tsx:231, settings, onboarding — all
--     filter on user_id = authUser.id) but is left alone here to keep this
--     migration to the three tables that are demonstrably un-protected AND
--     that this audit found being read cross-user.
--
-- ⚠️ RUN ORDER: this is a PRODUCTION database. Take a backup first
--    (Supabase Dashboard → Database → Backups, or `pg_dump`). Every statement
--    is idempotent so a partial re-run is safe, but a half-applied policy set
--    can lock the app out.
--
-- ─── Behavioural change to be aware of before you run ───────────────────────
-- 1. profiles becomes readable as: your own full row, OR any user you share a
--    group with. That is required — lib/groupActions.ts:853 reads
--    `receive_nudges` for every nudge recipient via `.in('id', recipientIds)`,
--    and those recipients are co-members. A self-only policy would silently
--    break the nudge feature (every member would look nudgeable).
--    Consequence to accept: co-members can read co-members' `profiles` rows
--    including the `email` column. group_members / groups already expose
--    member lists to all authenticated users (group_schema.sql:69,76 — both
--    `USING (true)`), so co-membership is not a secret. If you want email
--    hidden even from co-members, say so and I will split the cross-member
--    reads onto a column-limited view instead.
--
-- 2. user_stats becomes self-only. Every call site already filters on
--    user_id = authUser.id (dashboard:153, read:226, actions:132,245,386,433,
--    437, settings:192), so this is a no-op for the app.
--
-- 3. reading_sessions gets RLS enabled, activating the 4 policies already
--    written in 20260816000001: INSERT/UPDATE/DELETE self-only, SELECT = self
--    OR co-member. lib/groupActions.ts:775 and :184 depend on that cross-member
--    SELECT and will keep working.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Indexes first (safe, independent of RLS) ───────────────────────────────
-- The sessions_select policy runs a correlated self-join over group_members for
-- every candidate row, and lib/groupActions.ts:775 does a cross-member
-- `.in('user_id', ...)` scan. Without this composite index that EXISTS is a
-- seq scan per row.
CREATE INDEX IF NOT EXISTS idx_group_members_user_group
  ON public.group_members (user_id, group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group_user
  ON public.group_members (group_id, user_id);

-- reading_sessions is queried by enrollment (calendar:92, dashboard:195,
-- read:238) and by (user_id, date_local) (NudgeButton:56, groupActions:184).
CREATE INDEX IF NOT EXISTS idx_reading_sessions_enrollment
  ON public.reading_sessions (enrollment_id);
CREATE INDEX IF NOT EXISTS idx_reading_sessions_user_date
  ON public.reading_sessions (user_id, date_local);

-- ─── 1. profiles ───────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Own row, or any row belonging to a user you share at least one group with.
DROP POLICY IF EXISTS profiles_select_self_or_group ON public.profiles;
CREATE POLICY profiles_select_self_or_group ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = id
    OR EXISTS (
      SELECT 1
      FROM public.group_members mine
      JOIN public.group_members theirs
        ON mine.group_id = theirs.group_id
      WHERE mine.user_id = auth.uid()
        AND theirs.user_id = profiles.id
    )
  );

-- Writes stay self-only. The handle_new_user trigger runs as SECURITY DEFINER
-- and is unaffected by RLS.
DROP POLICY IF EXISTS profiles_insert_self ON public.profiles;
CREATE POLICY profiles_insert_self ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS profiles_delete_self ON public.profiles;
CREATE POLICY profiles_delete_self ON public.profiles
  FOR DELETE
  TO authenticated
  USING (auth.uid() = id);

-- ─── 2. user_stats — self only ─────────────────────────────────────────────
-- Every call site already filters user_id = authUser.id, so this changes
-- nothing for the app; it only closes cross-user reads.
ALTER TABLE public.user_stats ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_stats_select_self ON public.user_stats;
CREATE POLICY user_stats_select_self ON public.user_stats
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS user_stats_insert_self ON public.user_stats;
CREATE POLICY user_stats_insert_self ON public.user_stats
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS user_stats_update_self ON public.user_stats;
CREATE POLICY user_stats_update_self ON public.user_stats
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- No delete policy: nothing in the app deletes user_stats, so denying it by
-- omission is correct.

-- ─── 3. reading_sessions ───────────────────────────────────────────────────
-- The four policies already exist from 20260816000001. Re-creating them here
-- makes this migration self-contained and safe to run on a DB where that file
-- was applied by hand in the Dashboard SQL editor.
ALTER TABLE public.reading_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sessions_write ON public.reading_sessions;
CREATE POLICY sessions_write ON public.reading_sessions
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS sessions_update ON public.reading_sessions;
CREATE POLICY sessions_update ON public.reading_sessions
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS sessions_delete ON public.reading_sessions;
CREATE POLICY sessions_delete ON public.reading_sessions
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS sessions_select ON public.reading_sessions;
CREATE POLICY sessions_select ON public.reading_sessions
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.group_members gm1
      JOIN public.group_members gm2
        ON gm1.group_id = gm2.group_id
      WHERE gm1.user_id = auth.uid()
        AND gm2.user_id = reading_sessions.user_id
    )
  );

-- ─── Verification (read-only, safe to run any time after the above) ─────────
-- Expected: profiles/user_stats/reading_sessions = 'ROW LEVEL SECURITY ENABLED'
SELECT c.relname AS table, c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('profiles','user_stats','reading_sessions','global_stats')
ORDER BY c.relname;

-- Expected: 4 policies each on reading_sessions, 4 on profiles, 3 on user_stats.
SELECT tablename, count(*) AS policies
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles','user_stats','reading_sessions')
GROUP BY tablename
ORDER BY tablename;

-- Expected: global_stats still selectable by anon (the community counter).
-- If this errors, the view grant was lost and the dashboard's global stats
-- tile will break — restore with:
--   GRANT SELECT ON public.global_stats TO anon, authenticated;
SELECT count(*) FROM public.global_stats;
