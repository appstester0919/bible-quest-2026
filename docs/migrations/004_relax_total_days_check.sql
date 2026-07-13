-- ============================================================================
-- Migration 004: Relax total_days_check lower bound
--
-- Previous: total_days BETWEEN 40 AND 365
-- New:      total_days BETWEEN 1 AND 365
--
-- Rationale: the old lower bound (40) was blocking legitimate plans like
-- "NT 20 chapters/day = 13 days". The minimum meaningful plan is 1 day.
-- Upper bound of 365 stays as a sanity cap.
-- ============================================================================

ALTER TABLE public.user_plan_enrollments
  DROP CONSTRAINT IF EXISTS user_plan_enrollments_total_days_check;

ALTER TABLE public.user_plan_enrollments
  ADD CONSTRAINT user_plan_enrollments_total_days_check
  CHECK (total_days BETWEEN 1 AND 365);

-- Verify
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.user_plan_enrollments'::regclass
  AND contype = 'c';