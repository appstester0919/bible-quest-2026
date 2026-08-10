-- ─── Grant service_role access to web_push_subscriptions ──────────────────
-- WHY: The /api/push/debug route (and any future direct-table query) uses
-- Supabase service-role key from Vercel. While the service-role Postgres
-- role BYPASSES RLS, it still needs explicit GRANT on tables in the public
-- schema — otherwise queries like
--   supabase.from('web_push_subscriptions').select(...)
-- return "permission denied for table web_push_subscriptions".
--
-- The cron-relay route doesn't need this because it only calls the
-- process_due_reminders() RPC, which is SECURITY DEFINER (runs as the
-- function owner = postgres superuser, which already has table access).
--
-- This migration also adds grants for cron-relay consistency in case we
-- ever do direct-table work in that route too.
--
-- Run via: Supabase Dashboard → SQL Editor → paste & run
-- (Service-role key alone cannot execute DDL — must use SQL Editor)

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.web_push_subscriptions
  TO service_role;
