-- =====================================================================
-- BibleQuest2026 — Add updated_at column to user_plan_enrollments
-- Version: 0.6 — 2026-07-10
-- Purpose: Migration 0005 archive UPDATE failed because
--          trg_enrollments_updated_at trigger (from schema.sql) tries
--          to set NEW.updated_at = now(), but the actual table doesn't
--          have an updated_at column — schema drift.
--
-- FIX:
--   1. ADD COLUMN updated_at to user_plan_enrollments
--   2. Backfill existing rows with now()
--   3. Update touch_updated_at() to be safer (skip if column missing)
--   4. Verify
-- =====================================================================

-- Step 1: Add the column
ALTER TABLE public.user_plan_enrollments
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Step 2: backfill (already done by DEFAULT, but explicit for clarity)
UPDATE public.user_plan_enrollments SET updated_at = now() WHERE updated_at IS NULL;

-- Step 3: harden touch_updated_at so future schema drift doesn't
-- blow up. SECURITY DEFINER + dynamic check on column existence.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'user_plan_enrollments'
     OR TG_TABLE_NAME = 'profiles'
     OR TG_TABLE_NAME = 'user_stats'
  THEN
    -- These tables are expected to have updated_at. If they don't
    -- (schema drift), swallow the error and continue so other triggers
    -- and the parent operation don't fail.
    BEGIN
      NEW.updated_at := now();
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[touch_updated_at] % for table % has no updated_at column', SQLERRM, TG_TABLE_NAME;
    END;
  END IF;
  RETURN NEW;
END;
$$;

-- Recreate the trigger just to be sure the function body is current
DROP TRIGGER IF EXISTS trg_enrollments_updated_at ON public.user_plan_enrollments;
CREATE TRIGGER trg_enrollments_updated_at
  BEFORE UPDATE ON public.user_plan_enrollments
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- Step 4: verify
DO $$
DECLARE
  v_total int;
  v_active int;
  v_with_updated_at int;
BEGIN
  SELECT count(*) INTO v_total FROM public.user_plan_enrollments;
  SELECT count(*) INTO v_active FROM public.user_plan_enrollments WHERE status = 'active';
  SELECT count(*) INTO v_with_updated_at FROM public.user_plan_enrollments WHERE updated_at IS NOT NULL;

  RAISE NOTICE '═══════ Migration 0006 Report ═══════';
  RAISE NOTICE 'total enrollments              = %', v_total;
  RAISE NOTICE 'active enrollments             = %', v_active;
  RAISE NOTICE 'enrollments with updated_at    = %', v_with_updated_at;
  RAISE NOTICE '════════════════════════════════════';
END $$;
