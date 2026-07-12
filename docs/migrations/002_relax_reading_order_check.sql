-- ============================================================================
-- Migration 002: Relax reading_order CHECK + add redesigned-plan support
--
-- Run this ONCE in Supabase SQL Editor:
--   https://supabase.com/dashboard/project/xybrbennsttjttxuxqoq/sql/new
--
-- This is safe to re-run (uses IF EXISTS / DROP IF EXISTS).
-- ============================================================================

-- 1. Drop the old restrictive CHECK constraint on user_plan_enrollments.
--    The old constraint only allowed ('nt_ot', 'ot_nt', 'parallel') — too
--    restrictive for the new parallel-plan design where reading_order
--    stores "N-OT" format (e.g. "7-5" = nt 7ch/day, ot 5ch/day).
ALTER TABLE public.user_plan_enrollments
  DROP CONSTRAINT IF EXISTS user_plan_enrollments_reading_order_check;

-- 2. Add a new, more permissive CHECK constraint.
--    - For scope nt or ot: reading_order MUST be NULL
--    - For scope nt_ot:    reading_order MUST match "N-OT" (digits-dash-digits)
ALTER TABLE public.user_plan_enrollments
  ADD CONSTRAINT user_plan_enrollments_reading_order_format_chk
  CHECK (
    (scope IN ('nt', 'ot') AND reading_order IS NULL)
    OR
    (scope = 'nt_ot' AND reading_order IS NOT NULL AND reading_order ~ '^[0-9]+-[0-9]+$')
  );

-- 3. Verify constraint was replaced
SELECT
  conname,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.user_plan_enrollments'::regclass
  AND conname LIKE '%reading_order%';