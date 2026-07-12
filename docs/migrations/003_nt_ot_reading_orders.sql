-- ============================================================================
-- Migration 003: Allow nt_ot reading_order to be one of:
--   - "N-OT"  (e.g. "2-5") → parallel reading (existing format)
--   - 'nt_then_ot'         → finish all NT first, then OT
--   - 'ot_then_nt'         → finish all OT first, then NT
--
-- For sequential reading, chapters_per_day is the single daily total.
-- Total days = ceil(260 / cpd) + ceil(929 / cpd)
-- ============================================================================

ALTER TABLE public.user_plan_enrollments
  DROP CONSTRAINT IF EXISTS user_plan_enrollments_reading_order_format_chk;

ALTER TABLE public.user_plan_enrollments
  ADD CONSTRAINT user_plan_enrollments_reading_order_format_chk
  CHECK (
    (scope IN ('nt', 'ot') AND reading_order IS NULL)
    OR
    (scope = 'nt_ot' AND reading_order IS NOT NULL AND (
        reading_order ~ '^[0-9]+-[0-9]+$'              -- parallel: "N-OT"
        OR reading_order IN ('nt_then_ot', 'ot_then_nt')  -- sequential
    ))
  );

-- Verify
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.user_plan_enrollments'::regclass
  AND contype = 'c';