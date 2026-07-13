-- ============================================================================
-- Migration 005: Allow group admins to rename their group
--
-- Adds the missing UPDATE policy on the groups table.
-- Without this, calling supabase.from('groups').update(...) fails with
-- 'permission denied for table groups' even for the group creator.
--
-- The USING and WITH CHECK clauses both check that the caller is the
-- group's created_by — so only the admin can rename.
-- ============================================================================

CREATE POLICY "Group admins can update their groups" ON groups
  FOR UPDATE
  USING (
    auth.uid() = (SELECT created_by FROM groups WHERE id = groups.id)
  )
  WITH CHECK (
    auth.uid() = (SELECT created_by FROM groups WHERE id = groups.id)
  );

-- Verify
SELECT policyname, cmd
FROM pg_policies
WHERE tablename = 'groups'
ORDER BY cmd, policyname;