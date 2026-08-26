-- ============================================================================
-- Migration 012: Fix off-by-one in start_book_index CHECK constraints
--
-- Bug: migrations 010/011 created CHECK constraints capped at book index 64,
-- but 啟示錄 (Revelation) is index **65** (66 books, 0-based indices 0..65).
-- The app UI allows selecting 啟示錄 as an NT start position (planGenerator,
-- getRemainingChapters and tests all support index 65), so any user picking
-- "start at 啟示錄" hit:
--
--   new row violates check constraint
--   "user_plan_enrollments_nt_start_book_index_chk"
--
-- Fix: widen both constraints to include index 65.
--   start_book_index     : BETWEEN 0 AND 64  →  BETWEEN 0 AND 65
--   nt_start_book_index  : BETWEEN 39 AND 64 →  BETWEEN 39 AND 65
--
-- Safety: ranges only WIDEN, so no existing row can violate the new checks.
-- Idempotent: safe to run more than once.
--
-- Canonical chapter counts (verified against public/bible-data.json):
--   OT = 929, NT = 260, Total = 1189. Last books: 瑪拉基 = 38, 啟示錄 = 65.
-- ============================================================================

ALTER TABLE public.user_plan_enrollments
  DROP CONSTRAINT IF EXISTS user_plan_enrollments_start_book_index_chk;

ALTER TABLE public.user_plan_enrollments
  DROP CONSTRAINT IF EXISTS user_plan_enrollments_nt_start_book_index_chk;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_plan_enrollments'::regclass
      AND conname = 'user_plan_enrollments_start_book_index_chk'
  ) THEN
    ALTER TABLE public.user_plan_enrollments
      ADD CONSTRAINT user_plan_enrollments_start_book_index_chk
      CHECK (start_book_index BETWEEN 0 AND 65);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.user_plan_enrollments'::regclass
      AND conname = 'user_plan_enrollments_nt_start_book_index_chk'
  ) THEN
    ALTER TABLE public.user_plan_enrollments
      ADD CONSTRAINT user_plan_enrollments_nt_start_book_index_chk
      CHECK (nt_start_book_index BETWEEN 39 AND 65);
  END IF;
END $$;

-- Comments (correct the misleading "64=啟示錄" from migrations 010/011)
COMMENT ON COLUMN public.user_plan_enrollments.start_book_index IS
  '0-based book index where the plan starts (創=0, …, 瑪=38, 太=39, …, 啓=65). NT plans default to 39 (馬太福音).';

COMMENT ON COLUMN public.user_plan_enrollments.nt_start_book_index IS
  '0-based NT book index (39=馬太 to 65=啟示錄) where the NT portion of the plan starts. Default 39.';

-- Verify: both constraints must now show BETWEEN ... 65
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.user_plan_enrollments'::regclass
  AND contype = 'c'
  AND conname IN (
    'user_plan_enrollments_start_book_index_chk',
    'user_plan_enrollments_nt_start_book_index_chk'
  );

-- Sanity check: these two inserts must SUCCEED after this migration
-- (run manually if you want proof):
--   INSERT INTO user_plan_enrollments (user_id, scope, total_days,
--     chapters_per_day, start_book_index, nt_start_book_index)
--   VALUES ('00000000-0000-0000-0000-000000000000', 'nt', 260, 1, 65, 65);
--   -- expect: constraint violation on user_id FK only, NOT on the *_chk above
