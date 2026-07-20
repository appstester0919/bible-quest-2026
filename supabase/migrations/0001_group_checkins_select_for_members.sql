-- Migration: relax group_checkins SELECT RLS so group co-members can see each other's check-ins
-- Bug: original policy `auth.uid() = user_id` blocked group cards from showing
-- other members' progress. Replace with broader policy that allows same-group read.

DROP POLICY IF EXISTS checkin_select ON public.group_checkins;

CREATE POLICY checkin_select ON public.group_checkins
  FOR SELECT
  USING (
    -- User can always see their own check-ins
    auth.uid() = user_id
    OR
    -- User can see check-ins of co-members in groups they belong to
    EXISTS (
      SELECT 1
      FROM public.group_members gm1
      JOIN public.group_members gm2
        ON gm1.group_id = gm2.group_id
      WHERE gm1.user_id = auth.uid()
        AND gm2.user_id = group_checkins.user_id
    )
  );
