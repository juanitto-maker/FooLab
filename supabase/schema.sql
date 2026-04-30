-- FooLab catalog schema. Run this once in the Supabase SQL editor against a
-- fresh project. Idempotent — safe to re-run after edits.

create extension if not exists pgcrypto;

-- Each row is one regional variant of one product. Many users scanning the
-- same item bump scan_count; an AI dedup step in /api/publish decides whether
-- a new scan is a duplicate, a better version of the same variant, or a
-- different regional variant that should live as its own row.
create table if not exists catalog_scans (
  id              uuid primary key default gen_random_uuid(),
  product_key     text not null,
  region          text,
  product_name    text not null,
  brand           text,
  category        text,
  kind            text not null default 'food' check (kind in ('food','drink')),
  nutri_score     text not null check (nutri_score in ('A','B','C','D','E')),
  health_score    int,
  summary         text,
  ingredients     jsonb not null default '[]'::jsonb,
  e_numbers       jsonb not null default '[]'::jsonb,
  red_flags       jsonb not null default '[]'::jsonb,
  nutrition       jsonb,
  allergens       jsonb not null default '[]'::jsonb,
  confidence      text not null,
  thumbnail_path  text,
  scan_count      int not null default 1,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Idempotent column add for projects created before kind was introduced.
alter table catalog_scans add column if not exists kind text not null default 'food';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'catalog_scans_kind_check'
  ) then
    alter table catalog_scans add constraint catalog_scans_kind_check
      check (kind in ('food','drink'));
  end if;
end$$;

-- Computed search column for fulltext.
alter table catalog_scans
  add column if not exists search_text text
  generated always as (
    coalesce(product_name,'') || ' ' ||
    coalesce(brand,'') || ' ' ||
    coalesce(category,'')
  ) stored;

create index if not exists idx_catalog_product_key on catalog_scans(product_key);
create index if not exists idx_catalog_nutri       on catalog_scans(nutri_score);
create index if not exists idx_catalog_brand       on catalog_scans(brand);
create index if not exists idx_catalog_kind        on catalog_scans(kind);
create index if not exists idx_catalog_updated     on catalog_scans(updated_at desc);
create index if not exists idx_catalog_scan_count  on catalog_scans(scan_count desc);
create index if not exists idx_catalog_search      on catalog_scans
  using gin (to_tsvector('simple', search_text));

-- updated_at trigger
create or replace function set_updated_at() returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_catalog_updated on catalog_scans;
create trigger trg_catalog_updated
  before update on catalog_scans
  for each row execute function set_updated_at();

-- RLS: anyone can browse, only the server (service_role) can write.
alter table catalog_scans enable row level security;

drop policy if exists "catalog_public_read" on catalog_scans;
create policy "catalog_public_read"
  on catalog_scans for select
  using (true);

-- No insert/update/delete policy for anon — service_role bypasses RLS so the
-- server can still write through it.

-- Storage bucket for thumbnails. Run this section after creating the bucket
-- "catalog-thumbnails" in the Supabase Storage UI (set Public = true).
-- Then run these policies so anon can read and the server can write.
do $$
begin
  if exists (select 1 from storage.buckets where id = 'catalog-thumbnails') then
    -- public read
    drop policy if exists "catalog_thumb_public_read" on storage.objects;
    create policy "catalog_thumb_public_read"
      on storage.objects for select
      using (bucket_id = 'catalog-thumbnails');
  end if;
end$$;
