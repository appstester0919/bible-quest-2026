-- ─── Group Accountability Nudge (Duolingo Friend Streak pattern) ───────────────
-- Created: 2026-08-15
-- Spec: ~/.hermes/plans/bible-quest-2026-group-nudge-2026-08-15.md
--
-- Two changes:
--   1. profiles.receive_nudges (global toggle, default ON)
--   2. group_nudges table (sender/receiver 1-per-day quota enforcement)
--
-- Push delivery is fire-and-forget from server action (lib/groupActions.ts
-- sendNudge) via /api/push/nudge route — does NOT need a DB column beyond
-- the audit trail (sender_id, recipient_id, custom_message, sent_at).

-- ─── 1. profiles.receive_nudges ────────────────────────────────────────────────
-- WHY: Per locked spec, the receiver-side opt-out is a user-level global
-- toggle, NOT per-group. Default ON so existing users are auto-enrolled.
-- Server action filters out recipients with receive_nudges=false BEFORE
-- inserting nudge rows, so sender's quota is NOT deducted for skipped
-- disabled recipients (spec rule #3).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS receive_nudges boolean NOT NULL DEFAULT true;

-- ─── 2. group_nudges ───────────────────────────────────────────────────────────
-- WHY: Track every nudge send for:
--   - Sender 1-per-day quota (UNIQUE on (sender_id, recipient_id, date)
--     lets us SELECT count(*) WHERE sender_id = me AND date = today)
--   - Receiver 1-per-day quota (UNIQUE blocks duplicate nudges to same
--     recipient from same sender; cross-sender dedup is by date filter
--     at query time)
--   - Audit trail (custom_message stored for forensic replay)
--
-- message_template is nullable: NULL means custom message, 1..12 means
-- a sample index from lib/nudgeSamples.ts.
--
-- group_id is nullable because recipients can be cross-group aggregated
-- (a recipient may belong to multiple groups with the sender — we store
-- the first group_id found at send time).

CREATE TABLE IF NOT EXISTS public.group_nudges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  group_id uuid REFERENCES public.groups(id) ON DELETE SET NULL,
  message_template smallint CHECK (message_template BETWEEN 1 AND 12),
  custom_message text NOT NULL,
  nudge_date_local date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  push_delivered boolean NOT NULL DEFAULT false,
  -- 1 nudge per (sender, recipient, date) — enforces BOTH sender 1/day
  -- AND receiver 1/day for any given pair in one shot
  UNIQUE (sender_id, recipient_id, nudge_date_local)
);

-- Index for sender quota check (lib/groupActions.ts checkSenderQuota)
CREATE INDEX IF NOT EXISTS idx_group_nudges_sender_date
  ON public.group_nudges (sender_id, nudge_date_local);

-- Index for receiver quota check (cross-sender, checkRecipientsQuota)
CREATE INDEX IF NOT EXISTS idx_group_nudges_recipient_date
  ON public.group_nudges (recipient_id, nudge_date_local);

-- ─── RLS ──────────────────────────────────────────────────────────────────────
-- Per locked spec, INSERTs go through the server action using the
-- authenticated user's session — so an authenticated INSERT policy is
-- needed (sender_id = auth.uid()). No service-role INSERT policy needed
-- for the v0.1 path; if we ever switch to a service-role client, GRANT
-- below covers it.

ALTER TABLE public.group_nudges ENABLE ROW LEVEL SECURITY;

-- Read: sender or recipient can see their own nudge rows
CREATE POLICY "nudges_select_own"
  ON public.group_nudges FOR SELECT
  USING (auth.uid() IN (sender_id, recipient_id));

-- Insert: only as self (sender_id must equal auth.uid())
CREATE POLICY "nudges_insert_self"
  ON public.group_nudges FOR INSERT
  WITH CHECK (auth.uid() = sender_id);

-- No UPDATE / DELETE policy — rows are immutable audit trail.
-- (push_delivered is updated via service-role only — see GRANT below)

-- ─── Grant service_role ───────────────────────────────────────────────────────
-- WHY: Future admin/debug routes may want direct table access via
-- service_role (the cron-relay pattern). RLS BYPASSES for service_role
-- but it still needs GRANT on the table.
-- Match the pattern from migration 20260723000000_grant_service_role_push_subs.sql.

GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.group_nudges TO service_role;