-- ============================================================================
-- Migration 005c: Add UPDATE policy with IF NOT EXISTS check
--
-- First check what policies already exist, then add the missing one.
-- Run SELECT first to diagnose, then CREATE if missing.
-- ============================================================================

-- Step 1: See what UPDATE policies exist
SELECT polname, polcmd
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
WHERE c.relname = 'groups'
  AND p.polcmd = 'u';  -- 'u' = UPDATE

-- Step 2: Force-add the policy (drop then create to ensure clean state)
DROP POLICY IF EXISTS "Group admins can update their groups" ON public.groups;

CREATE POLICY "Group admins can update their groups"
  ON public.groups
  FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- Step 3: Confirm policy exists
SELECT polname, polcmd,
  pg_get_expr(polqual, polrelid) AS using_clause,
  pg_get_expr(polwithcheck, polrelid) AS with_check_clause
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
WHERE c.relname = 'groups';