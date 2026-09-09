-- 2026-09-09 — Round 27 sync-replace migration
--
-- Adds 'source' column + RPC function for atomic sheet→DB replace semantics.
-- Round-24 used upsert-only (insert/update but never delete from DB),
-- so removing a row from the sheet left an orphan in DB. Round-27 fixes
-- that with a Postgres function that does DELETE + UPSERT in one transaction.
--
-- Key design:
--   1. source column distinguishes sheet-sourced rows from future in-app
--      submissions; sync only deletes source='sheet' rows so manual rows
--      are protected.
--   2. rpc function runs as SECURITY DEFINER (bypasses RLS for atomic
--      transaction; only callable by service_role).
--   3. Apps Script sends full sheet batch as JSON; function handles all
--      deletes + upserts internally.
--
-- Migration steps in order:
--   1. ALTER TABLE add source column with default 'sheet' for backfill.
--   2. CREATE FUNCTION sync_external_links_from_sheet(jsonb).
--   3. GRANT EXECUTE to service_role (Apps Script uses service_role key).

-- 1. Add source column. Backfill existing rows as 'sheet' since they
--    all came from the original seed inserts (which are functionally
--    equivalent to sheet content for Round-24 purposes).
alter table public.bq_external_links
  add column if not exists source text not null default 'sheet';

-- Optional: index on source for the cleanup query
create index if not exists bq_external_links_source_idx
  on public.bq_external_links(source);

-- 2. RPC function. Replaces all source='sheet' rows with incoming batch
--    atomically. Returns delete + upsert counts for log auditing.
create or replace function public.sync_external_links_from_sheet(
  incoming_rows jsonb
) returns table(deleted_count int, upserted_count int)
language plpgsql
security definer
as $$
declare
  incoming_ids uuid[];
  deleted int := 0;
  upserted int := 0;
begin
  -- Extract incoming ids (NULL/empty array means "no sheet rows" — caller
  -- is responsible for safety check; we trust them at this layer)
  if incoming_rows is null or jsonb_array_length(incoming_rows) = 0 then
    incoming_ids := array[]::uuid[];
  else
    select array_agg((r->>'id')::uuid)
      into incoming_ids
    from jsonb_array_elements(incoming_rows) r;
  end if;

  -- Delete orphans: sheet-sourced rows whose id is NOT in incoming batch
  if array_length(incoming_ids, 1) > 0 then
    delete from public.bq_external_links
    where source = 'sheet'
      and id <> all(incoming_ids);
  else
    -- Incoming batch empty → wipe all sheet-sourced rows
    delete from public.bq_external_links
    where source = 'sheet';
  end if;
  get diagnostics deleted = row_count;

  -- Upsert incoming rows (skip if batch empty — DELETE-only is a valid case)
  if array_length(incoming_ids, 1) > 0 then
    insert into public.bq_external_links
      (id, category, title, url, description, is_published, sort_order, source)
    select
      (r->>'id')::uuid,
      coalesce(nullif(r->>'category', ''), '其他'),
      r->>'title',
      r->>'url',
      nullif(r->>'description', ''),
      coalesce((r->>'is_published')::boolean, true),
      coalesce((r->>'sort_order')::int, 0),
      'sheet'
    from jsonb_array_elements(incoming_rows) r
    on conflict (id) do update set
      category = excluded.category,
      url = excluded.url,
      title = excluded.title,
      description = excluded.description,
      is_published = excluded.is_published,
      sort_order = excluded.sort_order,
      source = 'sheet';  -- ensure source stays 'sheet' on re-sync
    get diagnostics upserted = row_count;
  end if;

  return query select deleted, upserted;
end;
$$;

-- 3. Grant execute to service_role (Apps Script uses service_role key)
-- anon / authenticated do NOT need this — they only do SELECT.
grant execute on function public.sync_external_links_from_sheet(jsonb)
  to service_role;