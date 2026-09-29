-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: close the profiles_public_read hole.
--
-- EFFECT: `profiles_public_read` is `USING (true)` — any signed-in user can
-- read EVERY row of profiles, including the email column. This drops it and
-- replaces it with a co-member-scoped SELECT, which is the minimum the app
-- actually needs.
--
-- CONTEXT — this CORRECTS 20260928000000_enable_rls_core_tables.sql, which
-- was written from a repo-only audit. That audit grepped supabase/migrations
-- for `ENABLE ROW LEVEL SECURITY`, found nothing for profiles / user_stats /
-- reading_sessions, and concluded all three were unprotected. That conclusion
-- was WRONG. Verified against the live database 2026-09-28:
--
--   profiles          RLS ALREADY true — 4 policies, of which
--                     profiles_public_read is USING (true)   ← the only hole
--   user_stats        RLS ALREADY true — self read/update, correct
--   reading_sessions  RLS ALREADY true — the 4 sessions_* policies from
--                     20260816000001, correct
--
-- They were applied by hand in the Dashboard SQL editor, not through the repo.
-- Repo migrations are NOT the source of truth for this project — query the
-- live DB before writing any RLS change. Keep the superseded file for the
-- record; do not run it.
--
-- ⚠️ Production database. Back up first (Dashboard → Database → Backups).
--    Idempotent, and the whole change is one DROP, so fully reversible via the
--    rollback block at the bottom.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Why the public read existed, and why it can go ─────────────────────────
-- Group features display member names. Those come from group_members
-- .display_name, which is ALREADY readable by every authenticated user by
-- design (group_schema.sql:76 is USING (true)). Not from profiles.
--
-- Every profiles call site in the app is self-scoped except one deliberate
-- cross-user read:
--   dashboard/page.tsx:151         .eq('id', authUser.id)
--   settings/actions.ts:52,96      .eq('id', user.id)
--   settings/page.tsx:103,142,150  .eq('id', user.id)
--   join/[code]/page.tsx:33,75     .eq('id', user.id)
--   onboarding/actions.ts:262      .eq('id', user.id)
--   NudgeButton.tsx:89             .eq('id', user.id)
--   groupActions.ts:71             .eq('id', userId)   (own id)
--   groupActions.ts:617            .eq('id', user.id)
--   groupActions.ts:854-856        .in('id', recipientIds)  ← the ONLY one
--                                   reading other users, for receive_nudges.
--                                   Recipients are co-members, so a co-member
--                                   policy covers it.
--
-- The public read was almost certainly a quick fix for that one call site:
-- under a self-only policy the recipient query returns nothing and the nudge
-- feature silently breaks (every member looks nudgeable) — the exact failure
-- mode migration 20260816000001 documents for reading_sessions.

-- ─── 1. Drop the blanket public SELECT ─────────────────────────────────────
-- Own-row access is unaffected: profiles_select_own and profiles_self_read
-- already give SELECT (auth.uid() = id), and profiles_self_update gives the
-- UPDATE. Only the ability to read OTHER users' rows goes away.
DROP POLICY IF EXISTS profiles_public_read ON public.profiles;

-- ─── 2. Restore exactly the cross-member visibility the app needs ─────────
-- Deliberately the same shape as the proven reading_sessions policy, so the
-- behaviour and the correlated-join cost are already known-good in production.
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

-- ─── 3. Drop the duplicate self-only SELECT ──────────────────────────────
-- profiles_select_own and profiles_self_read are byte-identical
-- ((auth.uid() = id)). RLS OR-s the policies together, so one is pure noise;
-- keeping a single one makes the policy set auditable.
DROP POLICY IF EXISTS profiles_self_read ON public.profiles;

-- ─── 4. Index the membership join ────────────────────────────────────────
-- The new policy runs the same correlated subquery as reading_sessions'
-- sessions_select, for every candidate profiles row. group_members already has
-- idx_group_members_group and idx_group_members_user (group_schema.sql:104-105)
-- but neither is composite, so add the (user_id, group_id) pair the join needs,
-- in both directions.
CREATE INDEX IF NOT EXISTS idx_group_members_user_group
  ON public.group_members (user_id, group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_group_user
  ON public.group_members (group_id, user_id);

-- ═══ Rollback (keep handy) ═══════════════════════════════════════════════
-- DROP POLICY IF EXISTS profiles_select_self_or_group ON public.profiles;
-- CREATE POLICY profiles_public_read ON public.profiles
--   FOR SELECT TO authenticated USING (true);
-- CREATE POLICY profiles_self_read ON public.profiles
--   FOR SELECT TO authenticated USING (auth.uid() = id);

-- ═══ Verification (read-only, run after) ═════════════════════════════════
-- Expected: NO row named profiles_public_read; profiles_select_self_or_group
-- present; exactly one (auth.uid() = id) SELECT remains.
SELECT policyname, cmd, qual
FROM pg_policies
WHERE schemaname='public' AND tablename='profiles'
ORDER BY policyname;

-- Expected: idx_group_members_group_user and idx_group_members_user_group.
SELECT indexname FROM pg_indexes
WHERE schemaname='public' AND indexname LIKE 'idx_group_members%'
ORDER BY 1;
