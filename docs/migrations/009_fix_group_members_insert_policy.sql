-- =====================================================================
-- Migration 009: Fix group_members INSERT policy for admin approval flow
-- Version: 0.9 — 2026-07-14
--
-- ROOT CAUSE
-- ----------
-- After migration 008 (table-level GRANT), the user (praguewagon) was able
-- to insert into group_join_requests without 42501. Good.
--
-- But the admin approval flow (`approveJoinRequest` in lib/groupActions.ts
-- line 154-160) hits a different RLS policy failure:
--
--   await supabase.from('group_members').insert({
--     group_id: req.group_id,
--     user_id: req.user_id,        -- <-- INVITEE's uid, NOT admin's
--     display_name: req.display_name,
--     role: 'member',
--   })
--
-- The existing policy from group_schema.sql:
--
--   CREATE POLICY "Approved members can be inserted" ON group_members
--     FOR INSERT WITH CHECK (auth.uid() = user_id);
--
-- requires `auth.uid() = user_id` — i.e. the row being inserted must have
-- user_id == authenticated user. But when admin approves, the admin is
-- inserting on behalf of the invitee, so admin.uid != invitee.uid, the
-- CHECK fails, and Postgres returns 42501.
--
-- Reporter (praguewagon, via user apkhlai):
--   "我做組長 accept 組員申請嘅時候, 出現 審批失敗:
--    new row violates row-level security policy for table 'group_members'"
--
-- FIX
-- ---
-- Replace the INSERT policy with one that allows EITHER:
--   (a) self-insert: auth.uid() = user_id (direct join, e.g. future feature
--       where a user inserts themselves as member without approval), OR
--   (b) admin-insert: auth.uid() is the group's creator, OR
--       auth.uid() is already a member with role='admin' in that group
--
-- The DELETE policy already supports admin removal (similar pattern), so
-- this brings INSERT in line with DELETE.
--
-- SAFE TO RE-RUN: DROP IF EXISTS + CREATE, idempotent
-- =====================================================================

DROP POLICY IF EXISTS "Approved members can be inserted" ON public.group_members;

CREATE POLICY "Members can be inserted by self or group admin"
  ON public.group_members
  FOR INSERT
  WITH CHECK (
    -- Self-insert (joining yourself)
    auth.uid() = user_id
    -- OR group creator inserting someone else
    OR auth.uid() = (
      SELECT created_by FROM public.groups
      WHERE id = group_members.group_id
    )
    -- OR any existing admin in that group inserting someone else
    OR auth.uid() IN (
      SELECT user_id FROM public.group_members m
      WHERE m.group_id = group_members.group_id
        AND m.role = 'admin'
    )
  );

-- Verification report
DO $$
DECLARE
  v_policies int;
  v_insert_policy_text text;
BEGIN
  SELECT count(*) INTO v_policies
    FROM pg_policies
    WHERE tablename = 'group_members' AND cmd = 'INSERT';

  SELECT qual INTO v_insert_policy_text
    FROM pg_policies
    WHERE tablename = 'group_members' AND cmd = 'INSERT'
    LIMIT 1;

  RAISE NOTICE '═══════ Migration 009 Verification ═══════';
  RAISE NOTICE 'group_members INSERT policies count: %', v_policies;
  RAISE NOTICE 'Policy uses: %', v_insert_policy_text;
  RAISE NOTICE '══════════════════════════════════════════';
  RAISE NOTICE 'Expected: policies=1, uses auth.uid() with admin subquery';
END $$;
