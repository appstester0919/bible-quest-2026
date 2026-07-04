-- =====================================================================
-- Bible Quest — MVP Database Schema (PostgreSQL / Supabase)
-- Version: 0.1 — 2026-07-04
-- Convention: snake_case, plural table names, id UUID PK, created/updated
-- =====================================================================

-- Enable extensions
create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- =====================================================================
-- 1. profiles — extends auth.users
-- =====================================================================
create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text not null,
  avatar_url      text,
  locale          text not null default 'zh-HK',
  timezone        text not null default 'Asia/Hong_Kong',
  push_token      text,                        -- Web Push subscription endpoint
  onboarding_done boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index on public.profiles (display_name);

-- =====================================================================
-- 2. user_stats — progression (one row per user, hot path)
-- =====================================================================
create table public.user_stats (
  user_id                  uuid primary key references public.profiles(id) on delete cascade,
  current_streak           int  not null default 0,
  longest_streak           int  not null default 0,
  last_completed_date      date,
  total_xp                 int  not null default 0,
  level                    int  not null default 1,
  streak_freezes_available int  not null default 1,    -- 每月補發
  streak_freeze_used_on    date,
  updated_at               timestamptz not null default now()
);

-- =====================================================================
-- 3. reading_plans_catalog — curated plans (seed data)
-- =====================================================================
create table public.reading_plans_catalog (
  id              uuid primary key default uuid_generate_v4(),
  slug            text unique not null,        -- 'nt-40', 'ot-40', 'nt-ot-40', 'custom'
  name_zh         text not null,
  description_zh  text,
  duration_days   int not null,
  is_standard     boolean not null default true,
  structure       jsonb not null,              -- [{day:1, book:'Matt', chapter:1}, ...]
  cover_image_url text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Custom plans (user-created) share this table but is_standard=false
alter table public.reading_plans_catalog
  add column if not exists created_by uuid references public.profiles(id);

create index on public.reading_plans_catalog (slug);
create index on public.reading_plans_catalog (is_standard);

-- =====================================================================
-- 4. user_plan_enrollments — user joined a plan
-- =====================================================================
create table public.user_plan_enrollments (
  id                   uuid primary key default uuid_generate_v4(),
  user_id              uuid not null references public.profiles(id) on delete cascade,
  plan_slug            text not null references public.reading_plans_catalog(slug) on delete restrict,
  started_at           timestamptz not null default now(),
  current_day          int  not null default 1,
  daily_chapter_count  int  not null default 1,
  status               text not null default 'active'
                         check (status in ('active', 'paused', 'completed', 'abandoned')),
  completed_at         timestamptz,
  paused_at            timestamptz,
  unique (user_id, plan_slug)
);

create index on public.user_plan_enrollments (user_id, status);
create index on public.user_plan_enrollments (plan_slug);

-- =====================================================================
-- 5. reading_sessions — every "I read X chapter" event
-- =====================================================================
create table public.reading_sessions (
  id              uuid primary key default uuid_generate_v4(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  enrollment_id   uuid not null references public.user_plan_enrollments(id) on delete cascade,
  plan_slug       text not null references public.reading_plans_catalog(slug),
  day_number      int  not null,               -- 第幾日 (1-based)
  book_zh         text not null,
  chapter         int  not null,
  completed_at    timestamptz not null default now(),
  date_local      date not null,                -- user local date (for streak counting)
  xp_earned       int  not null,
  duration_sec    int                           -- optional: how long they spent
);

create index on public.reading_sessions (user_id, date_local desc);
create index on public.reading_sessions (enrollment_id, day_number);

-- =====================================================================
-- 6. partner_invites — pending pair-up requests
-- =====================================================================
create table public.partner_invites (
  id            uuid primary key default uuid_generate_v4(),
  inviter_id    uuid not null references public.profiles(id) on delete cascade,
  invitee_email text not null,
  token         text unique not null default encode(gen_random_bytes(24), 'hex'),
  status        text not null default 'pending'
                  check (status in ('pending', 'accepted', 'expired', 'revoked')),
  expires_at    timestamptz not null default (now() + interval '14 days'),
  created_at    timestamptz not null default now()
);

create index on public.partner_invites (token);
create index on public.partner_invites (invitee_email);

-- =====================================================================
-- 7. partner_pairs — active 1-on-1 pairs
-- =====================================================================
create table public.partner_pairs (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  partner_id  uuid not null references public.profiles(id) on delete cascade,
  paired_at   timestamptz not null default now(),
  ended_at    timestamptz,
  status      text not null default 'active'
                check (status in ('active', 'ended')),
  unique (user_id, partner_id),
  check (user_id <> partner_id)
);

create index on public.partner_pairs (user_id) where status = 'active';
create index on public.partner_pairs (partner_id) where status = 'active';

-- =====================================================================
-- 8. achievements — catalog of badge definitions
-- =====================================================================
create table public.achievements (
  id            uuid primary key default uuid_generate_v4(),
  code          text unique not null,           -- 'read_john', 'streak_7'
  name_zh       text not null,
  description_zh text not null,
  icon_url      text,
  tier          text not null default 'bronze'
                  check (tier in ('bronze', 'silver', 'gold', 'platinum')),
  criteria      jsonb not null,                 -- {type:'streak', days:7} etc
  created_at    timestamptz not null default now()
);

-- =====================================================================
-- 9. user_achievements — which user unlocked what
-- =====================================================================
create table public.user_achievements (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  achievement_id uuid not null references public.achievements(id) on delete cascade,
  unlocked_at    timestamptz not null default now(),
  primary key (user_id, achievement_id)
);

create index on public.user_achievements (user_id, unlocked_at desc);

-- =====================================================================
-- 10. notifications_log — push delivery audit trail
-- =====================================================================
create table public.notifications_log (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid not null references public.profiles(id) on delete cascade,
  kind        text not null,                    -- 'streak_reminder', 'partner_done', 'achievement_unlocked'
  sent_at     timestamptz not null default now(),
  delivered   boolean not null default false,
  payload     jsonb
);

create index on public.notifications_log (user_id, sent_at desc);

-- =====================================================================
-- 11. audit_log — generic event log (privacy-friendly)
-- =====================================================================
create table public.audit_log (
  id          uuid primary key default uuid_generate_v4(),
  user_id     uuid references public.profiles(id) on delete set null,
  event       text not null,
  metadata    jsonb,
  created_at  timestamptz not null default now()
);

create index on public.audit_log (user_id, created_at desc);
create index on public.audit_log (event, created_at desc);

-- =====================================================================
-- VIEWS
-- =====================================================================

-- v_partner_progress — what partner can see about you
create or replace view public.v_partner_progress as
select
  p.partner_id                                          as viewer_id,
  prof.id                                               as subject_id,
  prof.display_name,
  prof.avatar_url,
  s.current_streak,
  s.longest_streak,
  s.last_completed_date,
  (s.last_completed_date = current_date)                as completed_today,
  s.total_xp,
  s.level
from public.partner_pairs p
join public.profiles prof on prof.id = p.user_id
join public.user_stats  s  on s.user_id  = p.user_id
where p.status = 'active'
union all
select
  p.user_id                                             as viewer_id,
  prof.id                                               as subject_id,
  prof.display_name,
  prof.avatar_url,
  s.current_streak,
  s.longest_streak,
  s.last_completed_date,
  (s.last_completed_date = current_date)                as completed_today,
  s.total_xp,
  s.level
from public.partner_pairs p
join public.profiles prof on prof.id = p.partner_id
join public.user_stats  s  on s.user_id  = p.partner_id
where p.status = 'active';

-- v_user_dashboard — aggregated for /dashboard route
create or replace view public.v_user_dashboard as
select
  prof.id                                                as user_id,
  prof.display_name,
  s.current_streak,
  s.longest_streak,
  s.last_completed_date,
  (s.last_completed_date = current_date)                 as completed_today,
  s.streak_freezes_available,
  s.total_xp,
  s.level,
  (
    select json_agg(json_build_object(
      'enrollment_id', e.id,
      'plan_slug',     e.plan_slug,
      'plan_name',     c.name_zh,
      'current_day',   e.current_day,
      'duration_days', c.duration_days,
      'status',        e.status,
      'today',         (
        select json_build_object(
          'book_zh',  rs.book_zh,
          'chapter',  rs.chapter,
          'day',      rs.day_number
        )
        from public.reading_sessions rs
        where rs.enrollment_id = e.id
          and rs.date_local    = current_date
        limit 1
      )
    ))
    from public.user_plan_enrollments e
    join public.reading_plans_catalog c on c.slug = e.plan_slug
    where e.user_id = prof.id and e.status = 'active'
  ) as active_plans
from public.profiles prof
join public.user_stats s on s.user_id = prof.id;

-- =====================================================================
-- FUNCTIONS / TRIGGERS
-- =====================================================================

-- Auto-create profile + stats row on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1))
  );

  insert into public.user_stats (user_id)
  values (new.id);

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Replenish streak freeze monthly
create or replace function public.replenish_streak_freezes()
returns void
language sql
security definer
as $$
  update public.user_stats
  set    streak_freezes_available = least(streak_freezes_available + 1, 1)
  where  streak_freeze_used_on < date_trunc('month', current_date)
     or  streak_freeze_used_on is null;
$$;

-- updated_at auto-touch
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

create trigger trg_user_stats_updated_at
  before update on public.user_stats
  for each row execute function public.touch_updated_at();

create trigger trg_plans_updated_at
  before update on public.reading_plans_catalog
  for each row execute function public.touch_updated_at();

create trigger trg_enrollments_updated_at
  before update on public.user_plan_enrollments
  for each row execute function public.touch_updated_at();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================

alter table public.profiles                 enable row level security;
alter table public.user_stats               enable row level security;
alter table public.reading_plans_catalog    enable row level security;
alter table public.user_plan_enrollments    enable row level security;
alter table public.reading_sessions         enable row level security;
alter table public.partner_invites          enable row level security;
alter table public.partner_pairs            enable row level security;
alter table public.achievements             enable row level security;
alter table public.user_achievements        enable row level security;
alter table public.notifications_log        enable row level security;
alter table public.audit_log                enable row level security;

-- Profiles: own row read + update; public display_name + avatar readable by authenticated
create policy "profiles_self_read"    on public.profiles for select using (auth.uid() = id);
create policy "profiles_self_update"  on public.profiles for update using (auth.uid() = id);
create policy "profiles_public_read"  on public.profiles for select to authenticated
                                       using (true);  -- display fields only

-- user_stats: own row only
create policy "user_stats_self_read"   on public.user_stats for select using (auth.uid() = user_id);
create policy "user_stats_self_update" on public.user_stats for update using (auth.uid() = user_id);

-- reading_plans_catalog: standard plans public, custom plans owner-only
create policy "plans_standard_read"   on public.reading_plans_catalog for select
                                       using (is_standard or auth.uid() = created_by);
create policy "plans_owner_write"     on public.reading_plans_catalog for all
                                       using (auth.uid() = created_by) with check (auth.uid() = created_by);

-- enrollments: own rows only
create policy "enrollments_self"      on public.user_plan_enrollments for all
                                       using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- reading_sessions: own rows only
create policy "sessions_self"         on public.reading_sessions for all
                                       using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- partner_invites: inviter can manage own; invitee can read by token
create policy "invites_inviter_all"   on public.partner_invites for all
                                       using (auth.uid() = inviter_id) with check (auth.uid() = inviter_id);
create policy "invites_token_read"    on public.partner_invites for select using (true);

-- partner_pairs: each side can read own; can update own row
create policy "pairs_self_read"       on public.partner_pairs for select
                                       using (auth.uid() = user_id or auth.uid() = partner_id);
create policy "pairs_self_update"     on public.partner_pairs for update
                                       using (auth.uid() = user_id or auth.uid() = partner_id);

-- achievements: catalog public, user_achievements own
create policy "achievements_public_read" on public.achievements for select using (true);
create policy "user_achievements_self"   on public.user_achievements for all
                                          using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- notifications_log + audit_log: own rows only
create policy "notifications_self"    on public.notifications_log for select
                                       using (auth.uid() = user_id);
create policy "audit_self_read"       on public.audit_log for select
                                       using (auth.uid() = user_id);

-- =====================================================================
-- SEED: achievements catalog (MVP starter set)
-- =====================================================================
insert into public.achievements (code, name_zh, description_zh, tier, criteria) values
  ('first_lesson',     '初次讀經',     '完成你嘅第一日讀經',         'bronze', '{"type":"sessions","count":1}'),
  ('streak_7',         '連續 7 日',    '連續 7 日完成讀經',           'bronze', '{"type":"streak","days":7}'),
  ('streak_30',        '連續 30 日',   '連續 30 日完成讀經',          'silver', '{"type":"streak","days":30}'),
  ('streak_100',       '連續 100 日',  '連續 100 日完成讀經',         'gold',   '{"type":"streak","days":100}'),
  ('read_nt',          '新約完成',     '完成新約 40 日計劃',          'silver', '{"type":"plan_complete","slug":"nt-40"}'),
  ('read_ot',          '舊約完成',     '完成舊約 40 日計劃',          'silver', '{"type":"plan_complete","slug":"ot-40"}'),
  ('read_full',        '新舊約完成',   '完成新舊約 40 日計劃',        'gold',   '{"type":"plan_complete","slug":"nt-ot-40"}'),
  ('first_partner',    '同行者',       '邀請第一位讀經拍檔',          'bronze', '{"type":"partner_count","count":1}'),
  ('level_5',          'LEVEL 5',      '達到 Level 5',               'silver', '{"type":"level","min":5}'),
  ('level_10',         'LEVEL 10',     '達到 Level 10',              'gold',   '{"type":"level","min":10}');

-- =====================================================================
-- SEED: standard reading plans (structure TBD by content team)
-- Slugs locked: nt-40, ot-40, nt-ot-40, custom
-- =====================================================================
insert into public.reading_plans_catalog (slug, name_zh, description_zh, duration_days, is_standard, structure) values
  ('nt-40',     '40 日新約 1 次',     '40 日讀完整本新約',  40, true, '{"placeholder": true, "note": "待內容編輯填入章節編排"}'),
  ('ot-40',     '40 日舊約 1 次',     '40 日讀完整本舊約',  40, true, '{"placeholder": true, "note": "待內容編輯填入章節編排"}'),
  ('nt-ot-40',  '40 日新舊約 1 次',   '40 日新約 + 舊約並行', 40, true, '{"placeholder": true, "note": "待內容編輯填入章節編排"}');