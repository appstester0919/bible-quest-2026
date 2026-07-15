-- ============================================================================
-- Migration 011: Add per-testament start position columns
--
-- Migration 010 added start_book_index + start_chapter, but those only model
-- a single start point — sufficient for scope='nt' or scope='ot', but
-- insufficient for scope='nt_ot' which can have two independent starts
-- (e.g. "read NT from 約 5, OT from 出 30, both running in parallel").
--
-- This migration adds 2 columns for the per-testament start:
--   - nt_start_book_index  (defaults to 39 = 馬太) — used when scope='nt'
--     or as the NT start when scope='nt_ot'
--   - ot_start_book_index  (defaults to 0  = 創世記) — used when scope='ot'
--     or as the OT start when scope='nt_ot'
--
-- Note: start_book_index (added in 010) is kept for backward compatibility —
-- it mirrors the relevant per-testament column. planGenerator will prefer
-- the per-testament columns for scope='nt_ot' plans and use start_book_index
-- as the single-testament signal.
-- ============================================================================

ALTER TABLE public.user_plan_enrollments
  ADD COLUMN IF NOT EXISTS nt_start_book_index INTEGER NOT NULL DEFAULT 39;

ALTER TABLE public.user_plan_enrollments
  ADD COLUMN IF NOT EXISTS ot_start_book_index INTEGER NOT NULL DEFAULT 0;

-- Defensive constraints
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_plan_enrollments'::regclass
      AND conname = 'user_plan_enrollments_nt_start_book_index_chk'
  ) THEN
    ALTER TABLE public.user_plan_enrollments
      ADD CONSTRAINT user_plan_enrollments_nt_start_book_index_chk
      CHECK (nt_start_book_index BETWEEN 39 AND 64);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_plan_enrollments'::regclass
      AND conname = 'user_plan_enrollments_ot_start_book_index_chk'
  ) THEN
    ALTER TABLE public.user_plan_enrollments
      ADD CONSTRAINT user_plan_enrollments_ot_start_book_index_chk
      CHECK (ot_start_book_index BETWEEN 0 AND 38);
  END IF;
END $$;

COMMENT ON COLUMN public.user_plan_enrollments.nt_start_book_index IS
  '0-based NT book index (39=馬太 to 64=啟示錄) where the NT portion of the plan starts. Default 39.';

COMMENT ON COLUMN public.user_plan_enrollments.ot_start_book_index IS
  '0-based OT book index (0=創世記 to 38=瑪拉基) where the OT portion of the plan starts. Default 0.';

-- Verify
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'user_plan_enrollments'
  AND column_name IN ('nt_start_book_index', 'ot_start_book_index')
ORDER BY column_name;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.user_plan_enrollments'::regclass
  AND contype = 'c'
  AND conname IN (
    'user_plan_enrollments_nt_start_book_index_chk',
    'user_plan_enrollments_ot_start_book_index_chk'
  );