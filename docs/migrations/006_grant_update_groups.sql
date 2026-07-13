-- ============================================================================
-- Migration 006: Grant table-level UPDATE on groups
--
-- Even with RLS policies in place, Postgres requires explicit table-level
-- GRANTs for each privilege. Without GRANT UPDATE on 'groups' for the
-- 'authenticated' role, all UPDATE attempts fail with
--   "permission denied for table groups"
-- regardless of RLS policy content.
--
-- This migration:
--   1. Diagnostic: shows current grants
--   2. Grants UPDATE on groups to authenticated
--   3. Re-verifies
-- ============================================================================

-- Step 1: Show current grants
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'groups'
ORDER BY grantee, privilege_type;

-- Step 2: Grant UPDATE on groups to authenticated
-- (This is idempotent — safe to re-run)
GRANT UPDATE ON public.groups TO authenticated;

-- Step 3: Verify the new grant
SELECT grantee, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public'
  AND table_name = 'groups'
  AND grantee = 'authenticated'
ORDER BY privilege_type;