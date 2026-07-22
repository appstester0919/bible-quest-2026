-- ─── Web Push support for Bible Quest ────────────────────────────────────────
-- Existing table: public.web_push_subscriptions
--   (id uuid PK, user_id uuid, endpoint, p256dh, auth, active, user_agent,
--    created_at, updated_at)
-- We ALTER the table to add reminder-schedule columns so the existing single
-- table holds both per-device subscription data AND per-user reminder config.
-- The client upserts the same reminder_hour/minute/timezone/enabled_reminder
-- to every device row for that user (so all devices share the same schedule).
--
-- RPC:
--   public.process_due_reminders() — find rows whose reminder time matches
--                                    the current 15-min tick in their tz,
--                                    who haven't been notified today and
--                                    haven't completed reading today.

-- ─── Add reminder-schedule columns to web_push_subscriptions ─────────────────
ALTER TABLE public.web_push_subscriptions
  ADD COLUMN IF NOT EXISTS reminder_hour smallint NOT NULL DEFAULT 20
    CHECK (reminder_hour BETWEEN 0 AND 23);
ALTER TABLE public.web_push_subscriptions
  ADD COLUMN IF NOT EXISTS reminder_minute smallint NOT NULL DEFAULT 0
    CHECK (reminder_minute BETWEEN 0 AND 59);
ALTER TABLE public.web_push_subscriptions
  ADD COLUMN IF NOT EXISTS timezone text NOT NULL DEFAULT 'Asia/Hong_Kong';
ALTER TABLE public.web_push_subscriptions
  ADD COLUMN IF NOT EXISTS enabled_reminder boolean NOT NULL DEFAULT true;
ALTER TABLE public.web_push_subscriptions
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE public.web_push_subscriptions
  ADD COLUMN IF NOT EXISTS last_notified_at timestamptz;

-- ─── UNIQUE constraint on (user_id, endpoint) ───────────────────────────────
-- Required for the client to upsert in lib/push.ts with onConflict='user_id,endpoint'.
-- Without it, every browser session inserts a new row instead of upserting.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'web_push_subscriptions_user_id_endpoint_key'
  ) THEN
    -- Only add if no duplicate (user_id, endpoint) pairs exist
    IF (SELECT COUNT(*) FROM (
            SELECT user_id, endpoint FROM public.web_push_subscriptions
            GROUP BY user_id, endpoint HAVING COUNT(*) > 1
           ) d) = 0 THEN
      ALTER TABLE public.web_push_subscriptions
        ADD CONSTRAINT web_push_subscriptions_user_id_endpoint_key UNIQUE (user_id, endpoint);
    ELSE
      RAISE NOTICE 'web_push_subscriptions has duplicate (user_id, endpoint) pairs; skipping UNIQUE constraint';
    END IF;
  END IF;
END
$$;

-- ─── Indexes for cron queries ────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_web_push_subs_enabled_active
  ON public.web_push_subscriptions (reminder_hour, reminder_minute)
  WHERE enabled_reminder = true AND active = true;

-- ─── RPC: process_due_reminders ─────────────────────────────────────────────
-- Single-table design. We compute user_now once per row, match against the
-- reminder_hour/minute in the user's tz, skip if already notified or completed
-- today in their tz. Each matching row = one push to that device.
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
           s.timezone,
           s.last_notified_at,
           s.completed_at,
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
           OR (d.last_notified_at AT TIME ZONE d.timezone)::date < (d.user_now)::date)
      AND (d.completed_at IS NULL
           OR (d.completed_at AT TIME ZONE d.timezone)::date < (d.user_now)::date)
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

-- ─── Helper RPC: deactivate push subscription ──────────────────────────────
CREATE OR REPLACE FUNCTION public.deactivate_web_push_subscription(
  p_user_id uuid,
  p_endpoint text
)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.web_push_subscriptions
  SET active = false, updated_at = now()
  WHERE user_id = p_user_id AND endpoint = p_endpoint;
$$;

-- ─── Helper RPC: mark today's reading completed ─────────────────────────────
-- Called by the client when user completes reading for the day, so the cron
-- skips them. Idempotent — sets completed_at = today in HKT.
CREATE OR REPLACE FUNCTION public.mark_reading_completed(p_user_id uuid)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.web_push_subscriptions
  SET completed_at = now()
  WHERE user_id = p_user_id
    AND (completed_at IS NULL
         OR (completed_at AT TIME ZONE COALESCE(timezone, 'Asia/Hong_Kong'))::date
            < (now() AT TIME ZONE 'Asia/Hong_Kong')::date);
$$;