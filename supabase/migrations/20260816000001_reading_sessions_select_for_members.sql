-- Migration: relax reading_sessions SELECT RLS so co-members can see each other's
-- completed chapters (needed by NudgeButton's getIncompleteGroupMembersToday filter).
--
-- Bug: original policy `auth.uid() = user_id` blocked reading_sessions cross-member reads,
-- so sender's `completedToday` filter always returned empty Set. As a result, every group
-- member appeared "incomplete" and was nudgable even when they had finished reading.
--
-- Fix: split single ALL policy into 4 cmd-specific policies:
--   - INSERT/UPDATE/DELETE stay self-only (no cross-member writes)
--   - SELECT broadened: self OR co-members in same group
--
-- Verified 2026-08-15 HKT: apkhlai can now query Testing 2 co-members' reading_sessions
-- date_local=2026-08-15 and sees both his own 8 chapters and 123's batch correctly.

DROP POLICY IF EXISTS sessions_self ON public.reading_sessions;

CREATE POLICY sessions_write ON public.reading_sessions
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY sessions_update ON public.reading_sessions
  FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY sessions_delete ON public.reading_sessions
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY sessions_select ON public.reading_sessions
  FOR SELECT
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
