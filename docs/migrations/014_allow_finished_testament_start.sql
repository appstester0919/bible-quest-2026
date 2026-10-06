-- ============================================================================
-- Migration 014: Allow a per-testament start to say 「that testament is done」
--
-- The bug
-- -------
-- 「由最近嘅斷位接返」 on a parallel 新舊並行 plan whose NT had already been
-- read to the end: the most recent gap held OT chapters only, so the app now
-- parks the finished NT pointer past 啟示錄 (FINISHED_BOOK_INDEX = 66). The
-- UPDATE then hit this:
--
--   new row violates check constraint
--   "user_plan_enrollments_ot_start_book_index_chk"
--
-- The dialog previewed the plan perfectly and the write failed outright — the
-- reader pressed 「就係咁做」 and got an error, because migrations 011/012 bounded
-- every start column to a REAL book index:
--
--   start_book_index      BETWEEN  0 AND 65
--   nt_start_book_index   BETWEEN 39 AND 65
--   ot_start_book_index   BETWEEN  0 AND 38
--
-- There was no way to express 「NT 已讀完」. The parallel re-anchor needs one,
-- and the catch-up button is exactly the feature that needs it.
--
-- The fix
-- -------
-- One sentinel above every book index, allowed on all three columns:
--   66 = 「呢一約已經讀完，唔再有章要讀」
--
-- Ranges only WIDEN, so no existing row can violate the new checks.
-- planGenerator treats a start past the testament's last book as zero
-- remaining chapters and parks the cursor at books.length, so every inner
-- `idx < books.length` guard goes false and the daily quota falls entirely to
-- the other testament. Verified against the real account: re-anchoring on the
-- OT-only recent gap yields 詩篇 96-101 and no NT chapters at all.
--
-- Idempotent: safe to run more than once.
-- ============================================================================

-- Pre-flight: name any row that would break, so a silent widen can't hide a
-- value the app never intended to write.
DO $$
DECLARE
  bad record;
BEGIN
  FOR bad IN
    SELECT id, start_book_index, nt_start_book_index, ot_start_book_index
    FROM public.user_plan_enrollments
    WHERE start_book_index NOT BETWEEN 0 AND 66
       OR nt_start_book_index NOT BETWEEN 39 AND 66
       OR ot_start_book_index NOT BETWEEN 0 AND 66
  LOOP
    RAISE WARNING 'start index out of expected range: % % % %',
      bad.id, bad.start_book_index, bad.nt_start_book_index, bad.ot_start_book_index;
  END LOOP;
END $$;

ALTER TABLE public.user_plan_enrollments
  DROP CONSTRAINT IF EXISTS user_plan_enrollments_start_book_index_chk;
ALTER TABLE public.user_plan_enrollments
  DROP CONSTRAINT IF EXISTS user_plan_enrollments_nt_start_book_index_chk;
ALTER TABLE public.user_plan_enrollments
  DROP CONSTRAINT IF EXISTS user_plan_enrollments_ot_start_book_index_chk;

ALTER TABLE public.user_plan_enrollments
  ADD CONSTRAINT user_plan_enrollments_start_book_index_chk
  CHECK (start_book_index BETWEEN 0 AND 66);

ALTER TABLE public.user_plan_enrollments
  ADD CONSTRAINT user_plan_enrollments_nt_start_book_index_chk
  CHECK (nt_start_book_index BETWEEN 39 AND 66);

ALTER TABLE public.user_plan_enrollments
  ADD CONSTRAINT user_plan_enrollments_ot_start_book_index_chk
  CHECK (ot_start_book_index BETWEEN 0 AND 66);

COMMENT ON COLUMN public.user_plan_enrollments.start_book_index IS
  '0-based book index where the plan starts (創=0, …, 瑪=38, 太=39, …, 啓=65). 66 = 該約已讀完. NT plans default to 39 (馬太福音).';

COMMENT ON COLUMN public.user_plan_enrollments.nt_start_book_index IS
  '0-based NT book index (39=馬太 to 65=啟示錄) where the NT portion of the plan starts. 66 = 新約已讀完. Default 39.';

COMMENT ON COLUMN public.user_plan_enrollments.ot_start_book_index IS
  '0-based OT book index (0=創世記 to 38=瑪拉基) where the OT portion of the plan starts. 66 = 舊約已讀完. Default 0.';

-- Verify: all three must now show 66 as the upper bound
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.user_plan_enrollments'::regclass
  AND contype = 'c'
  AND conname IN (
    'user_plan_enrollments_start_book_index_chk',
    'user_plan_enrollments_nt_start_book_index_chk',
    'user_plan_enrollments_ot_start_book_index_chk'
  );

-- Sanity: this exact write is what 追趕進度 now performs on the real account,
-- and it must SUCCEED. Expect: 0 rows (the user_id FK stops it), NOT a
-- *_start_book_index_chk violation.
--   UPDATE public.user_plan_enrollments
--      SET nt_start_book_index = 66, ot_start_book_index = 18
--    WHERE user_id = '00000000-0000-0000-0000-000000000000';