-- ─── Migration 016: User identity enum on profiles ──────────────────────────
-- Adds a single 'identity' enum column to profiles so we can show identity-
-- appropriate backgrounds, copy, and (later) identity-exclusive features.
-- Existing users are silently backfilled to 'Uni' (大專/爾國臨格) since they
-- were all recruited from the 爾國臨格 summer camp.
--
-- Identity values:
--   'Uni'  — 大專生 / 爾國臨格 (university/college students)
--   'High' — 高中生 / 夥熱 (high school students)
--   'Prim' — 小五六 / 新生不Sick (primary 5-6 students)
--
-- Read from signup: the signup page passes `options.data: { identity: 'High' }`
-- to supabase.auth.signUp(). Supabase stores this in
-- auth.users.raw_user_meta_data. The trigger below copies it into
-- profiles.identity when the user is created.
--
-- Run via: Supabase Dashboard → SQL Editor → paste & run
-- (Cannot deploy DDL from WSL — service_role key alone cannot run DDL.)

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS identity TEXT NOT NULL DEFAULT 'Uni'
    CHECK (identity IN ('Uni', 'High', 'Prim'));

-- Backfill: existing rows already get 'Uni' from the DEFAULT, but be explicit.
-- No-op if all rows already have identity='Uni'.
UPDATE public.profiles SET identity = 'Uni' WHERE identity IS NULL;

-- Index for future "show all High users" admin queries
CREATE INDEX IF NOT EXISTS idx_profiles_identity ON public.profiles (identity);

-- ─── Trigger: copy signup identity into profiles.identity ──────────────────
-- Runs AFTER INSERT on auth.users (which fires the existing
-- handle_new_user trigger that creates the profiles row).
-- Reads raw_user_meta_data->>'identity' set by supabase.auth.signUp({ options: { data: { identity } } }).
-- Falls back to default 'Uni' (already the column default) if absent.
--
-- Idempotent: uses OR REPLACE; safe to re-run.

CREATE OR REPLACE FUNCTION public.copy_signup_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  picked TEXT;
BEGIN
  -- Read identity from raw_user_meta_data set by the signup form
  picked := NEW.raw_user_meta_data ->> 'identity';

  -- Validate against the CHECK constraint; ignore anything else
  IF picked IN ('Uni', 'High', 'Prim') THEN
    UPDATE public.profiles
    SET identity = picked
    WHERE id = NEW.id;
  END IF;
  -- If picked is NULL or invalid, leave the default 'Uni' from the
  -- column DEFAULT clause. User can fix later in Settings.

  RETURN NEW;
END;
$$;

-- Drop old trigger if it exists, then create
DROP TRIGGER IF EXISTS trg_copy_signup_identity ON auth.users;
CREATE TRIGGER trg_copy_signup_identity
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.copy_signup_identity();
