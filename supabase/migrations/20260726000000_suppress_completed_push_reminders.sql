-- Fix reminder suppression by deriving completion from reading_sessions.
--
-- Root cause: process_due_reminders previously checked only
-- web_push_subscriptions.completed_at, but no completion flow called
-- mark_reading_completed(), so that column stayed NULL even when today's
-- reading_sessions existed. reading_sessions.date_local is the canonical
-- source of truth for daily completion.
--
-- Idempotent: CREATE OR REPLACE only.

CREATE OR REPLACE FUNCTION public.process_due_reminders(p_now timestamptz DEFAULT now())
RETURNS TABLE (
  user_id uuid,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT s.id,
           s.user_id,
           s.endpoint,
           s.p256dh,
           s.auth,
           COALESCE(s.timezone, 'Asia/Hong_Kong') AS timezone,
           s.last_notified_at,
           (p_now AT TIME ZONE COALESCE(s.timezone, 'Asia/Hong_Kong')) AS user_now,
           s.reminder_hour,
           s.reminder_minute
    FROM public.web_push_subscriptions s
    WHERE s.enabled_reminder = true
      AND s.active = true
      AND s.reminder_hour IS NOT NULL
      AND s.reminder_minute IS NOT NULL
  ),
  matches AS (
    SELECT d.*
    FROM due d
    WHERE EXTRACT(HOUR FROM d.user_now)::int = d.reminder_hour
      AND EXTRACT(MINUTE FROM d.user_now)::int / 15 = d.reminder_minute / 15
      AND (d.last_notified_at IS NULL
           OR (d.last_notified_at AT TIME ZONE d.timezone)::date < d.user_now::date)
      AND NOT EXISTS (
        SELECT 1
        FROM public.reading_sessions rs
        WHERE rs.user_id = d.user_id
          AND rs.date_local = d.user_now::date
      )
  ),
  marked AS (
    UPDATE public.web_push_subscriptions s
    SET last_notified_at = p_now
    FROM matches m
    WHERE s.id = m.id
    RETURNING s.id
  )
  SELECT m.user_id,
         m.id AS subscription_id,
         m.endpoint,
         m.p256dh,
         m.auth
  FROM matches m
  WHERE m.id IN (SELECT id FROM marked);
END;
$$;

-- Keep execution permissions explicit when the function is replaced.
REVOKE ALL ON FUNCTION public.process_due_reminders(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.process_due_reminders(timestamptz) TO service_role;
