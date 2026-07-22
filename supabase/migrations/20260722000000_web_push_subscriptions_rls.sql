-- ─── Web Push subscriptions RLS policies ─────────────────────────────────────
-- This migration grants table access to the `authenticated` role and enables
-- RLS with policies that let users SELECT/INSERT/UPDATE/DELETE only their own
-- rows (filtered by auth.uid() = user_id).
--
-- Run via: Supabase Dashboard → SQL Editor → paste & run
-- (Or via: psql with service_role connection)
--
-- WHY: The web client (lib/push.ts, settings page) calls Supabase Rest API
-- with the anon/authenticated key to upsert subscription rows + write
-- reminder time. Without these grants/policies, all such calls fail with
-- "permission denied for table web_push_subscriptions" or 403.

-- ─── Ensure the authenticated role can use the schema and table ─────────────
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.web_push_subscriptions
  TO authenticated;

-- ─── Enable RLS (idempotent) ────────────────────────────────────────────────
ALTER TABLE public.web_push_subscriptions ENABLE ROW LEVEL SECURITY;

-- ─── Drop any old dev policies so we don't accumulate duplicates ───────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='web_push_subscriptions'
               AND policyname='push_sel_own') THEN
    DROP POLICY push_sel_own ON public.web_push_subscriptions;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='web_push_subscriptions'
               AND policyname='push_ins_own') THEN
    DROP POLICY push_ins_own ON public.web_push_subscriptions;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='web_push_subscriptions'
               AND policyname='push_upd_own') THEN
    DROP POLICY push_upd_own ON public.web_push_subscriptions;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies
             WHERE schemaname='public' AND tablename='web_push_subscriptions'
               AND policyname='push_del_own') THEN
    DROP POLICY push_del_own ON public.web_push_subscriptions;
  END IF;
END
$$;

-- ─── Policies ───────────────────────────────────────────────────────────────
-- Each user can only access rows whose user_id matches their auth.uid().
-- The cron uses service_role which bypasses RLS, so this does not affect it.

CREATE POLICY push_sel_own ON public.web_push_subscriptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY push_ins_own ON public.web_push_subscriptions
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY push_upd_own ON public.web_push_subscriptions
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY push_del_own ON public.web_push_subscriptions
  FOR DELETE TO authenticated
  USING (user_id = auth.uid());
