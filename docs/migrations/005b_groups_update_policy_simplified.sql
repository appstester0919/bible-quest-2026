-- ============================================================================
-- Migration 005b: Simplified UPDATE policy for groups
--
-- Previous migration (005) used a correlated subquery:
--   USING (auth.uid() = (SELECT created_by FROM groups WHERE id = groups.id))
-- Which may have failed silently if the subquery plan was rejected.
--
-- This migration drops and re-creates the policy using a direct column
-- reference. The RLS engine handles the per-row auth.uid() comparison
-- natively for FOR UPDATE policies, so the subquery is unnecessary.
-- ============================================================================

DROP POLICY IF EXISTS "Group admins can update their groups" ON groups;

CREATE POLICY "Group admins can update their groups"
  ON groups
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Verify
SELECT policyname, cmd, qual, with_check
FROM pg_policies
WHERE tablename = 'groups'
ORDER BY cmd;