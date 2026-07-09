-- Add completed_plans counter to user_stats (cumulative plan completions)
ALTER TABLE public.user_stats
  ADD COLUMN IF NOT EXISTS completed_plans int NOT NULL DEFAULT 0;

-- Add a function to bump the counter when an enrollment completes
CREATE OR REPLACE FUNCTION public.bump_completed_plans()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'completed' AND (OLD.status IS NULL OR OLD.status <> 'completed') THEN
    UPDATE public.user_stats
      SET completed_plans = completed_plans + 1
      WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bump_completed_plans ON public.user_plan_enrollments;
CREATE TRIGGER trg_bump_completed_plans
  AFTER UPDATE OF status ON public.user_plan_enrollments
  FOR EACH ROW
  EXECUTE FUNCTION public.bump_completed_plans();

-- A view for global stats (cumulative chapter reads across all users)
CREATE OR REPLACE VIEW public.global_stats AS
  SELECT
    (SELECT count(*) FROM public.reading_sessions) AS total_chapters_read,
    (SELECT count(distinct user_id) FROM public.reading_sessions) AS active_readers,
    (SELECT count(*) FROM public.user_plan_enrollments WHERE status = 'completed') AS total_plans_completed;