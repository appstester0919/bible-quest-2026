-- ============================================================================
-- Migration 0007: Fix ambiguous current_streak in handle_session_insert trigger
-- ============================================================================
-- Problem: PL/pgSQL variable `current_streak` conflicts with table column name
-- in UPDATE statement: `current_streak = current_streak` is ambiguous (code 42702)
--
-- Fix: Rename PL/pgSQL variable to `v_current_streak` throughout the function
-- Status: idempotent — uses CREATE OR REPLACE
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_session_insert()
RETURNS TRIGGER AS $$
DECLARE
  last_date date;
  today_date date;
  yesterday_date date;
  v_current_streak int;  -- renamed to avoid ambiguous column reference
  xp_gained int;
  new_level int;
BEGIN
  today_date := CURRENT_DATE;
  yesterday_date := today_date - INTERVAL '1 day';
  
  -- Get current stats
  SELECT current_streak, total_xp, level
  INTO v_current_streak, xp_gained, new_level
  FROM public.user_stats
  WHERE user_id = NEW.user_id;
  
  -- Get last completed date
  SELECT last_completed_date INTO last_date
  FROM public.user_stats
  WHERE user_id = NEW.user_id;
  
  -- Award XP (10 XP per chapter completed)
  xp_gained := COALESCE(xp_gained, 0) + COALESCE(NEW.xp_earned, 0);
  
  -- Calculate new level: level = floor(sqrt(total_xp / 100)) + 1
  new_level := floor(sqrt(xp_gained::numeric / 100))::int + 1;
  
  -- Determine streak logic
  IF last_date IS NULL THEN
    -- First session ever
    v_current_streak := 1;
  ELSIF last_date = today_date THEN
    -- Already completed today, preserve streak
    v_current_streak := COALESCE(v_current_streak, 0);
  ELSIF last_date = yesterday_date THEN
    -- Consecutive day, increment streak
    v_current_streak := COALESCE(v_current_streak, 0) + 1;
  ELSE
    -- Streak broken, reset to 1
    v_current_streak := 1;
  END IF;
  
  -- Update user_stats
  UPDATE public.user_stats SET
    current_streak = v_current_streak,
    longest_streak = GREATEST(COALESCE(longest_streak, 0), v_current_streak),
    last_completed_date = today_date,
    total_xp = xp_gained,
    level = new_level
  WHERE user_id = NEW.user_id;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
