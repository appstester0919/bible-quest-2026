-- ============================================================
-- Bible Quest 2026 — Group Checkin Mismatch Audit
-- ============================================================
-- 連入: https://supabase.com/dashboard/project/xybrbennsttjttxuxqoq/sql/new
--
-- ⚠️  USAGE:
--   1. Run BLOCK 1 first (no substitution needed)
--   2. Copy the group_id from the result
--   3. Find/replace the literal string __CITYBUS_GROUP_ID__
--      with the actual UUID (38 chars, no angle brackets)
--   4. Run BLOCK 2 and BLOCK 3
-- ============================================================

-- ════════════════════════════════════════════════════════════════
-- BLOCK 1: Find CityBUs group_id (no substitution, run as-is)
-- ════════════════════════════════════════════════════════════════
SELECT id, name, invite_code, created_at
FROM groups
WHERE name ILIKE '%citybus%'
   OR name ILIKE '%city%bus%'
ORDER BY created_at DESC
LIMIT 5;

-- ════════════════════════════════════════════════════════════════
-- BLOCK 2: 14-day per-user × per-date diff
-- Replace the literal token below with the UUID from BLOCK 1
-- ════════════════════════════════════════════════════════════════
WITH g AS (
  SELECT '__CITYBUS_GROUP_ID__'::uuid AS gid
),
members AS (
  SELECT user_id FROM group_members WHERE group_id = (SELECT gid FROM g)
),
date_range AS (
  SELECT generate_series(
    (CURRENT_DATE - INTERVAL '14 days')::date,
    CURRENT_DATE::date,
    '1 day'::interval
  )::date AS date_local
)
SELECT
  au.id::text AS user_id,
  COALESCE(
    au.raw_user_meta->>'display_name',
    au.raw_user_meta->>'full_name',
    au.email::text,
    au.id::text
  ) AS who,
  dr.date_local::text AS date_local,
  EXISTS (
    SELECT 1 FROM reading_sessions rs
    WHERE rs.user_id = au.id AND rs.date_local = dr.date_local
  ) AS has_reading_session,
  EXISTS (
    SELECT 1 FROM group_checkins gc
    WHERE gc.group_id = (SELECT gid FROM g)
      AND gc.user_id = au.id
      AND gc.date_local = dr.date_local
  ) AS has_group_checkin,
  CASE
    WHEN EXISTS (
      SELECT 1 FROM reading_sessions rs
      WHERE rs.user_id = au.id AND rs.date_local = dr.date_local
    ) AND NOT EXISTS (
      SELECT 1 FROM group_checkins gc
      WHERE gc.group_id = (SELECT gid FROM g)
        AND gc.user_id = au.id
        AND gc.date_local = dr.date_local
    ) THEN 'MISMATCH_SESSION_NO_CHECKIN'
    WHEN EXISTS (
      SELECT 1 FROM group_checkins gc
      WHERE gc.group_id = (SELECT gid FROM g)
        AND gc.user_id = au.id
        AND gc.date_local = dr.date_local
    ) AND NOT EXISTS (
      SELECT 1 FROM reading_sessions rs
      WHERE rs.user_id = au.id AND rs.date_local = dr.date_local
    ) THEN 'MISMATCH_CHECKIN_NO_SESSION'
    WHEN EXISTS (
      SELECT 1 FROM reading_sessions rs
      WHERE rs.user_id = au.id AND rs.date_local = dr.date_local
    ) THEN 'MATCHED'
    ELSE 'NEITHER'
  END AS status
FROM auth.users au
CROSS JOIN date_range dr
WHERE au.id IN (SELECT user_id FROM members)
  AND dr.date_local >= (CURRENT_DATE - INTERVAL '14 days')::date
ORDER BY au.id, dr.date_local DESC;

-- ════════════════════════════════════════════════════════════════
-- BLOCK 3: per-user mismatch summary
-- Replace the literal token below with the UUID from BLOCK 1
-- ════════════════════════════════════════════════════════════════
SELECT
  COALESCE(
    au.raw_user_meta->>'display_name',
    au.raw_user_meta->>'full_name',
    au.email::text,
    au.id::text
  ) AS who,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM reading_sessions rs
      WHERE rs.user_id = au.id AND rs.date_local = d.d::date
    ) AND NOT EXISTS (
      SELECT 1 FROM group_checkins gc
      WHERE gc.group_id = '__CITYBUS_GROUP_ID__'::uuid
        AND gc.user_id = au.id
        AND gc.date_local = d.d::date
    )
  ) AS missing_checkins_count,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM group_checkins gc
      WHERE gc.group_id = '__CITYBUS_GROUP_ID__'::uuid
        AND gc.user_id = au.id
        AND gc.date_local = d.d::date
    ) AND NOT EXISTS (
      SELECT 1 FROM reading_sessions rs
      WHERE rs.user_id = au.id AND rs.date_local = d.d::date
    )
  ) AS orphan_checkins_count,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM reading_sessions rs
      WHERE rs.user_id = au.id AND rs.date_local = d.d::date
    )
  ) AS total_sessions,
  COUNT(*) FILTER (
    WHERE EXISTS (
      SELECT 1 FROM group_checkins gc
      WHERE gc.group_id = '__CITYBUS_GROUP_ID__'::uuid
        AND gc.user_id = au.id
        AND gc.date_local = d.d::date
    )
  ) AS total_checkins
FROM auth.users au
CROSS JOIN generate_series(
  (CURRENT_DATE - INTERVAL '14 days')::timestamp,
  CURRENT_DATE::timestamp,
  '1 day'::interval
) AS d(d)
WHERE au.id IN (
  SELECT user_id FROM group_members
  WHERE group_id = '__CITYBUS_GROUP_ID__'::uuid
)
GROUP BY au.id, au.raw_user_meta->>'display_name', au.raw_user_meta->>'full_name', au.email
ORDER BY missing_checkins_count DESC, who;