-- Fix group_nudges permissions: re-apply grants + security definer functions
-- to bypass any residual RLS edge cases

-- Re-grant for service_role (handles /api/push/nudge route)
GRANT USAGE ON SCHEMA public TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.group_nudges TO service_role;

-- Create security-definer wrapper so user-client INSERT always works
-- regardless of RLS edge cases (auth.uid() resolution in server actions)
CREATE OR REPLACE FUNCTION public.insert_group_nudge(
  p_sender_id uuid,
  p_recipient_id uuid,
  p_group_id uuid,
  p_custom_message text,
  p_nudge_date_local text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  nudge_id uuid;
BEGIN
  INSERT INTO public.group_nudges (
    sender_id, recipient_id, group_id,
    custom_message, message_template,
    nudge_date_local, push_delivered
  ) VALUES (
    p_sender_id, p_recipient_id, p_group_id,
    p_custom_message, NULL,
    p_nudge_date_local, FALSE
  ) RETURNING id INTO nudge_id;
  RETURN nudge_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.insert_group_nudge(uuid, uuid, uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.insert_group_nudge(uuid, uuid, uuid, text, text) TO service_role;
