-- ============================================================================
-- Migration 010: Add start_book_index + start_chapter to user_plan_enrollments
--
-- Purpose: allow users to pick a custom starting book + chapter for their
-- reading plan (previously all plans started at 創世記 1 / 馬太福音 1).
-- The plan always ends at 瑪拉基 (OT) or 啟示錄 (NT) — the start position
-- is the only free parameter.
--
-- Backwards compatibility:
--   start_book_index defaults to 0  (創世記) — matches legacy behavior
--   start_chapter defaults to 1     (chapter 1) — matches legacy behavior
--
--   For scope='nt' the legacy default was 馬太福音 1 (index 39). To preserve
--   that, the application layer sets start_book_index=39 explicitly when
--   creating an NT plan. The DB default of 0 is only relevant for OT plans
--   created without the new fields (defensive).
-- ============================================================================

ALTER TABLE public.user_plan_enrollments
  ADD COLUMN IF NOT EXISTS start_book_index INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.user_plan_enrollments
  ADD COLUMN IF NOT EXISTS start_chapter INTEGER NOT NULL DEFAULT 1;

-- Defensive: start_chapter must be >= 1
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_plan_enrollments'::regclass
      AND conname = 'user_plan_enrollments_start_chapter_chk'
  ) THEN
    ALTER TABLE public.user_plan_enrollments
      ADD CONSTRAINT user_plan_enrollments_start_chapter_chk
      CHECK (start_chapter >= 1);
  END IF;
END $$;

-- Defensive: start_book_index must be a valid bible book index (0..64)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_plan_enrollments'::regclass
      AND conname = 'user_plan_enrollments_start_book_index_chk'
  ) THEN
    ALTER TABLE public.user_plan_enrollments
      ADD CONSTRAINT user_plan_enrollments_start_book_index_chk
      CHECK (start_book_index BETWEEN 0 AND 64);
  END IF;
END $$;

-- Comments
COMMENT ON COLUMN public.user_plan_enrollments.start_book_index IS
  '0-based book index where the plan starts (創=0, …, 瑪=38, 太=39, …, 啓=64). NT plans default to 39 (馬太福音).';

COMMENT ON COLUMN public.user_plan_enrollments.start_chapter IS
  '1-based chapter within the start book (1 to book.chapters). Always defaults to 1.';

-- Verify
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'user_plan_enrollments'
  AND column_name IN ('start_book_index', 'start_chapter')
ORDER BY column_name;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.user_plan_enrollments'::regclass
  AND contype = 'c'
  AND conname IN ('user_plan_enrollments_start_chapter_chk', 'user_plan_enrollments_start_book_index_chk');