-- =====================================================================
-- BibleQuest2026 — Archive duplicate active enrollments
-- Version: 0.5 — 2026-07-10
-- Purpose: One-time cleanup for users who have multiple status='active'
--          rows in user_plan_enrollments (likely from repeated onboarding
--          submissions without archiving the previous active row).
--
-- IDEMPOTENT: re-running this after archive is a no-op.
-- =====================================================================

-- For each user with multiple 'active' enrollments:
--   Keep the most recent active row, mark all older 'active' rows as
--   'abandoned'.
WITH ranked AS (
  SELECT
    id,
    user_id,
    created_at,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY created_at DESC
    ) AS rn
  FROM public.user_plan_enrollments
  WHERE status = 'active'
)
UPDATE public.user_plan_enrollments e
   SET status = 'abandoned'
  FROM ranked r
 WHERE e.id = r.id
   AND r.rn > 1;

-- Also: for users with ZERO active rows but >0 total rows that are
-- 'abandoned' or 'completed', promote the most recent completed/abandoned
-- back to active. (Optional — only helpful if a user accidentally
-- abandoned their plan. Safe because of WHERE 0 active check.)
DO $$
DECLARE
  v_promoted int := 0;
BEGIN
  WITH to_promote AS (
    SELECT DISTINCT ON (user_id) id, user_id
      FROM public.user_plan_enrollments
     WHERE user_id NOT IN (SELECT user_id FROM public.user_plan_enrollments WHERE status = 'active')
       AND status IN ('abandoned', 'completed')
     ORDER BY user_id, created_at DESC
  )
  UPDATE public.user_plan_enrollments e
     SET status = 'active'
    FROM to_promote p
   WHERE e.id = p.id;

  GET DIAGNOSTICS v_promoted = ROW_COUNT;
  RAISE NOTICE '[cleanup] Promoted % previously-archived enrollments back to active', v_promoted;
END $$;

-- Verify: report final state
DO $$
DECLARE
  v_duplicate_users int;
  v_total_active int;
BEGIN
  SELECT count(DISTINCT user_id) INTO v_duplicate_users
    FROM public.user_plan_enrollments
   WHERE status = 'active'
  HAVING count(*) > 1;

  SELECT count(*) INTO v_total_active
    FROM public.user_plan_enrollments
   WHERE status = 'active';

  RAISE NOTICE '═══════ Enrollment Cleanup Report ═══════';
  RAISE NOTICE 'users with multiple active enrollments = %', COALESCE(v_duplicate_users, 0);
  RAISE NOTICE 'total active enrollments                = %', v_total_active;
  RAISE NOTICE '══════════════════════════════════════════';
END $$;
