-- ================================================================
-- Group Reading Feature Schema (idempotent - safe to re-run)
-- Run this in Supabase SQL Editor
-- ================================================================

-- 1. Add display_name to profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS display_name TEXT;
COMMENT ON COLUMN profiles.display_name IS '3-char name shown in group cards';

-- 2. Groups table
CREATE TABLE IF NOT EXISTS groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL CHECK (char_length(name) <= 30),
  created_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  invite_code TEXT UNIQUE NOT NULL DEFAULT lower(substring(md5(random()::text) from 1 for 8)),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Group members (approved)
CREATE TABLE IF NOT EXISTS group_members (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (char_length(display_name) <= 3),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

-- 4. Join requests (pending approval)
CREATE TABLE IF NOT EXISTS group_join_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL CHECK (char_length(display_name) <= 3),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (group_id, user_id)
);

-- 5. Group check-ins (daily attendance)
CREATE TABLE IF NOT EXISTS group_checkins (
  group_id UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  date_local DATE NOT NULL,
  checked_in_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (group_id, user_id, date_local)
);

-- ================================================================
-- Row Level Security
-- ================================================================

ALTER TABLE groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_join_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_checkins ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (to make this idempotent)
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN (SELECT policyname, tablename FROM pg_policies WHERE tablename IN ('groups', 'group_members', 'group_join_requests', 'group_checkins')) LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- Groups
CREATE POLICY "Groups are viewable by everyone" ON groups FOR SELECT USING (true);
CREATE POLICY "Authenticated users can create groups" ON groups FOR INSERT WITH CHECK (auth.uid() = created_by);
CREATE POLICY "Group admins can delete groups" ON groups FOR DELETE USING (
  auth.uid() = (SELECT created_by FROM groups WHERE id = groups.id)
);

-- Group members
CREATE POLICY "Group members are viewable by everyone" ON group_members FOR SELECT USING (true);
CREATE POLICY "Approved members can be inserted" ON group_members FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can delete members" ON group_members FOR DELETE USING (
  auth.uid() = (SELECT created_by FROM groups WHERE id = group_members.group_id)
  OR auth.uid() IN (SELECT user_id FROM group_members m WHERE m.group_id = group_members.group_id AND m.role = 'admin')
);

-- Join requests
CREATE POLICY "Join requests viewable" ON group_join_requests FOR SELECT USING (
  auth.uid() = user_id
  OR auth.uid() = (SELECT created_by FROM groups WHERE id = group_join_requests.group_id)
);
CREATE POLICY "Users can create requests" ON group_join_requests FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Admins can update requests" ON group_join_requests FOR UPDATE USING (
  auth.uid() = (SELECT created_by FROM groups WHERE id = group_join_requests.group_id)
);
CREATE POLICY "Requestor can delete own request" ON group_join_requests FOR DELETE USING (auth.uid() = user_id);

-- Check-ins
CREATE POLICY "Check-ins viewable by group members" ON group_checkins FOR SELECT USING (
  auth.uid() IN (SELECT user_id FROM group_members WHERE group_id = group_checkins.group_id)
);
CREATE POLICY "Group members can check in" ON group_checkins FOR INSERT WITH CHECK (
  auth.uid() = user_id
  AND auth.uid() IN (SELECT user_id FROM group_members WHERE group_id = group_checkins.group_id)
);
CREATE POLICY "Members can undo own check-in" ON group_checkins FOR DELETE USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_group_members_group ON group_members(group_id);
CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members(user_id);
CREATE INDEX IF NOT EXISTS idx_group_join_requests_group ON group_join_requests(group_id);
CREATE INDEX IF NOT EXISTS idx_group_checkins_group_date ON group_checkins(group_id, date_local);
CREATE INDEX IF NOT EXISTS idx_groups_invite_code ON groups(invite_code);
