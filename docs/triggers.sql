-- ============================================================================
-- BibleQuest2026 Supabase Database Triggers
-- ============================================================================
-- Contains:
--   1. on_session_insert - handles streak + XP + level updates after reading sessions
--   2. on_achievement_check - awards achievements based on user progress
--   3. on_auth_user_created - auto-creates profile + user_stats for new users
-- ============================================================================

-- TRIGGER 1: on_session_insert (for streak + XP + level)
-- Fires AFTER INSERT on reading_sessions to update user_stats
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

CREATE TRIGGER on_session_insert
  AFTER INSERT ON public.reading_sessions
  FOR EACH ROW EXECUTE FUNCTION public.handle_session_insert();

-- ============================================================================
-- TRIGGER 2: on_achievement_check (for achievements)
-- Fires AFTER INSERT on reading_sessions to check and award achievements
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_achievement_check()
RETURNS TRIGGER AS $$
DECLARE
  user_streak int;
  nt_done bool;
  ot_done bool;
  session_count int;
  partner_count int;
  new_level int;
BEGIN
  -- Get user stats
  SELECT current_streak INTO user_streak
  FROM public.user_stats WHERE user_id = NEW.user_id;
  
  -- Count sessions
  SELECT COUNT(*) INTO session_count
  FROM public.reading_sessions WHERE user_id = NEW.user_id;
  
  -- Check NT completion: user has read all 260 NT chapters
  -- (simplified: if enrollment NT is completed based on session count)
  -- For now: first_lesson always check
  IF session_count = 1 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW()
    FROM public.achievements
    WHERE code = 'first_lesson'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  -- Streak achievements
  IF user_streak >= 7 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW()
    FROM public.achievements WHERE code = 'streak_7'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  IF user_streak >= 30 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW()
    FROM public.achievements WHERE code = 'streak_30'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  IF user_streak >= 100 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW()
    FROM public.achievements WHERE code = 'streak_100'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  -- Level achievements
  SELECT level INTO new_level FROM public.user_stats WHERE user_id = NEW.user_id;
  IF new_level >= 5 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW()
    FROM public.achievements WHERE code = 'level_5'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  IF new_level >= 10 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW()
    FROM public.achievements WHERE code = 'level_10'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  -- Partner achievement
  SELECT COUNT(*) INTO partner_count
  FROM public.partner_pairs
  WHERE (user_id = NEW.user_id OR partner_id = NEW.user_id) AND status = 'active';
  IF partner_count >= 1 THEN
    INSERT INTO public.user_achievements (user_id, achievement_id, unlocked_at)
    SELECT NEW.user_id, id, NOW()
    FROM public.achievements WHERE code = 'first_partner'
    ON CONFLICT (user_id, achievement_id) DO NOTHING;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_achievement_check
  AFTER INSERT ON public.reading_sessions
  FOR EACH ROW EXECUTE FUNCTION public.handle_achievement_check();

-- ============================================================================
-- TRIGGER 3: New user auto-setup (instead of supabase managed trigger)
-- Auto-creates profile + user_stats when a new user is created via auth
-- This replaces the need for Supabase Auth webhooks for user setup
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  -- Create profile
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  
  -- Create user_stats with defaults
  INSERT INTO public.user_stats (user_id, current_streak, longest_streak, total_xp, level, streak_freezes_available)
  VALUES (NEW.id, 0, 0, 0, 1, 1);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fire after INSERT on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
