-- 2026-09-09 — bq_external_links
-- Centralized external links for /links page (Round 24 / 2026-09-09).
-- Source of truth: Google Sheet → Apps Script onChange → PostgREST upsert.
-- The Apps Script uses service_role key, so anon-only RLS is fine.
--
-- RLS path chosen: OWNER-ONLY (no admin clauses).
-- profiles.is_admin does NOT exist in this project (grep -rE "is_admin" supabase/ = 0 hits),
-- so the admin-clauses variant from the plan was dropped. KH LAI can add an
-- is_admin column later and re-introduce admin policies then.

create table public.bq_external_links (
  id uuid primary key default gen_random_uuid(),
  category text not null,            -- e.g. '靈修工具','查經資源','影音頻道','網站','其他'
  title text not null,
  url text not null,
  description text,                  -- 相關解說 (nullable, free text)
  submitter_id uuid references auth.users(id) on delete set null,
  is_published boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index bq_external_links_category_idx on public.bq_external_links(category);
create index bq_external_links_published_idx on public.bq_external_links(is_published, sort_order);

alter table public.bq_external_links enable row level security;

-- Public read of published links.
create policy "public read published" on public.bq_external_links
  for select using (is_published = true);

-- Any authenticated user can insert (Apps Script uses service_role to bypass RLS).
create policy "authenticated insert" on public.bq_external_links
  for insert with check (auth.role() = 'authenticated');

-- Owner-only update (no admin clause — see header note).
create policy "owner update" on public.bq_external_links
  for update using (submitter_id = auth.uid());

-- Owner-only delete (no admin clause — see header note).
create policy "owner delete" on public.bq_external_links
  for delete using (submitter_id = auth.uid());

-- updated_at trigger (idempotent: create-or-replace)
create or replace function public.touch_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger bq_external_links_touch
  before update on public.bq_external_links
  for each row execute function public.touch_updated_at();

-- Supabase RLS requires explicit table-level GRANTs on top of policies.
-- RLS policies gate WHICH rows a role can see; GRANT controls WHETHER the
-- role can read the table at all. Without these grants, anon / authenticated
-- SELECT will silently 42501 permission denied even with correct RLS policy.
-- (Round-24 lesson: discovered when /links page rendered empty after migration.
-- PostgREST hint was: "GRANT SELECT ON public.bq_external_links TO anon".
-- Round-24 follow-up: Apps Script onChange sync failed with 42501 even for
-- service_role — this Supabase project's service_role is NOT a Postgres
-- superuser and needs explicit GRANT too. Documented so future tables on
-- this project ship with all 3 role grants.)
-- Round-26 (2026-09-09) further refinement: even after the anon+service_role
-- grants, an AUTHENTICATED user (logged-in appkhlai account) got 42501 on
-- SELECT because the original GRANT statement was `grant insert, update,
-- delete ... to authenticated` — accidentally omitting SELECT. The bug
-- only surfaced when a real logged-in user navigated to /links; anon
-- requests (no login) hit the anon grant and worked. **ALWAYS grant ALL
-- 4 privileges (SELECT/INSERT/UPDATE/DELETE) to authenticated, not just D-I-U.**
grant select on public.bq_external_links to anon;
grant select, insert, update, delete on public.bq_external_links to authenticated;
grant select, insert, update, delete on public.bq_external_links to service_role;
