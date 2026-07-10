-- Migration 0009: Create or replace all trigger functions and triggers
-- This ensures the actual Supabase database has the triggers defined in docs/triggers.sql
-- Status: idempotent

-- ===========================================================================
-- TRIGGER 1: handle_session_insert — updates streak + XP + level after reading session INSERT
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.handle_session_insert()
RETURNS TRIGGER AS $$
DECLARE
  last_date date;
  today_date date;
  yesterday_date date;
  v_current_streak int;
  xp_gained int;
  new_level int;
BEGIN
  today_date := CURRENT_DATE;
  yesterday_date := today_date - INTERVAL '1 day';
  
  SELECT current_streak, total_xp, level
  INTO v_current_streak, xp_gained, new_level
  FROM public.user_stats
  WHERE user_id = NEW.user_id;
  
  SELECT last_completed_date INTO last_date
  FROM public.user_stats
  WHERE user_id = NEW.user_id;
  
  xp_gained := COALESCE(xp_gained, 0) + COALESCE(NEW.xp_earned, 0);
  new_level := floor(sqrt(xp_gained::numeric / 100))::int + 1;
  
  IF last_date IS NULL THEN
    v_current_streak := 1;
  ELSIF last_date = today_date THEN
    v_current_streak := COALESCE(v_current_streak, 0);
  ELSIF last_date = yesterday_date THEN
    v_current_streak := COALESCE(v_current_streak, 0) + 1;
  ELSE
    v_current_streak := 1;
  END IF;
  
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

-- Drop and recreate trigger to ensure it's bound correctly
DROP TRIGGER IF EXISTS on_session_insert ON public.reading_sessions;
CREATE TRIGGER on_session_insert
  AFTER INSERT ON public.reading_sessions
  FOR EACH ROW EXECUTE FUNCTION public.handle_session_insert();

-- ===========================================================================
-- TRIGGER 2: handle_achievement_check — awards achievements after reading session INSERT
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.handle_achievement_check()
RETURNS TRIGGER AS $$
DECLARE
  user_streak int;
  session_count int;
  partner_count int;
  new_level int;
BEGIN
  SELECT current_streak INTO user_streak FROM public.user_stats WHERE user_id = NEW.user_id;
  SELECT COUNT(*) INTO session_count FROM public.reading_sessions WHERE user_id = NEW.user_id;
  
  IF session_count = 1 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW() FROM public.achievements WHERE code = 'first_lesson'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  IF user_streak >= 7 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW() FROM public.achievements WHERE code = 'streak_7'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  IF user_streak >= 30 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW() FROM public.achievements WHERE code = 'streak_30'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  IF user_streak >= 100 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW() FROM public.achievements WHERE code = 'streak_100'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  SELECT level INTO new_level FROM public.user_stats WHERE user_id = NEW.user_id;
  IF new_level >= 5 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW() FROM public.achievements WHERE code = 'level_5'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  IF new_level >= 10 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW() FROM public.achievements WHERE code = 'level_10'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  SELECT COUNT(*) INTO partner_count FROM public.partner_pairs
  WHERE (user_id = NEW.user_id OR partner_id = NEW.user_id) AND status = 'active';
  IF partner_count >= 1 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW() FROM public.achievements WHERE code = 'first_partner'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_achievement_check ON public.reading_sessions;
CREATE TRIGGER on_achievement_check
  AFTER INSERT ON public.reading_sessions
  FOR EACH ROW EXECUTE FUNCTION public.handle_achievement_check();

-- ===========================================================================
-- TRIGGER 3: handle_new_user — auto-creates profile + user_stats for new users
-- ===========================================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  
  INSERT INTO public.user_stats (user_id, current_streak, longest_streak, total_xp, level, streak_freezes_available)
  VALUES (NEW.id, 0, 0, 0, 1, 1)
  ON CONFLICT (user_id) DO NOTHING;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Verify: list all triggers on reading_sessions
SELECT event_object_table, trigger_name, action_statement, event_manipulation
FROM information_schema.triggers
WHERE event_object_schema = 'public'
ORDER BY event_object_table, trigger_name;
