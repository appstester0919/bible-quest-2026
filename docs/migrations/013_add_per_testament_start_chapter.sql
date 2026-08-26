-- ============================================================================
-- Migration 013: Add per-testament start chapter columns
--
-- Context: migration 011 added per-testament START BOOK indices
-- (nt_start_book_index / ot_start_book_index), but the start CHAPTER was a
-- single shared column (start_chapter). For scope='nt_ot' with custom starts
-- on both testaments, storing one chapter against both sides is ambiguous —
-- e.g. NT start 馬太 1 vs OT start 出 30 would need start_chapter to mean
-- two different things at once (see the legacy-data clamp fallback in
-- lib/bible/planGenerator.ts).
--
-- This migration adds:
--   - nt_start_chapter (1-based, default 1)
--   - ot_start_chapter (1-based, default 1)
--
-- Semantics (see planGenerator.ts EnrollmentLite):
--   For 'nt_ot' plans these take precedence over start_chapter for their
--   testament. For 'nt'/'ot' plans the generator falls back to start_chapter.
--
-- NOTE: this file was reconstructed retroactively. The columns went live in
-- the production database ad hoc (~2026-08, referenced by app code as
-- "Migration 013") but the SQL was never committed to the repo, violating
-- the "all DB changes need a migration file" rule. It is fully idempotent —
-- safe to run whether or not the columns already exist.
-- ============================================================================

ALTER TABLE public.user_plan_enrollments
  ADD COLUMN IF NOT EXISTS nt_start_chapter INTEGER NOT NULL DEFAULT 1;

ALTER TABLE public.user_plan_enrollments
  ADD COLUMN IF NOT EXISTS ot_start_chapter INTEGER NOT NULL DEFAULT 1;

-- Ensure defaults even on pre-existing ad-hoc columns (idempotent)
ALTER TABLE public.user_plan_enrollments
  ALTER COLUMN nt_start_chapter SET DEFAULT 1;

ALTER TABLE public.user_plan_enrollments
  ALTER COLUMN ot_start_chapter SET DEFAULT 1;

-- Defensive: start chapters must be >= 1 (planGenerator clamps out-of-range
-- values back to 1 at read time; this keeps garbage out of the DB too)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_plan_enrollments'::regclass
      AND conname = 'user_plan_enrollments_nt_start_chapter_chk'
  ) THEN
    ALTER TABLE public.user_plan_enrollments
      ADD CONSTRAINT user_plan_enrollments_nt_start_chapter_chk
      CHECK (nt_start_chapter >= 1);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_plan_enrollments'::regclass
      AND conname = 'user_plan_enrollments_ot_start_chapter_chk'
  ) THEN
    ALTER TABLE public.user_plan_enrollments
      ADD CONSTRAINT user_plan_enrollments_ot_start_chapter_chk
      CHECK (ot_start_chapter >= 1);
  END IF;
END $$;

-- Comments
COMMENT ON COLUMN public.user_plan_enrollments.nt_start_chapter IS
  '1-based start chapter within nt_start_book_index (39=馬太 to 65=啟示錄). Takes precedence over start_chapter for the NT side of nt_ot plans. Default 1.';

COMMENT ON COLUMN public.user_plan_enrollments.ot_start_chapter IS
  '1-based start chapter within ot_start_book_index (0=創世記 to 38=瑪拉基). Takes precedence over start_chapter for the OT side of nt_ot plans. Default 1.';

-- Verify
SELECT column_name, data_type, column_default, is_nullable
FROM information_schema.columns
WHERE table_name = 'user_plan_enrollments'
  AND column_name IN ('nt_start_chapter', 'ot_start_chapter')
ORDER BY column_name;

SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.user_plan_enrollments'::regclass
  AND contype = 'c'
  AND conname IN (
    'user_plan_enrollments_nt_start_chapter_chk',
    'user_plan_enrollments_ot_start_chapter_chk'
  );
