create table public.audio_manifests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null
    constraint audio_manifests_restaurant_id_fkey
    references public.restaurants (id) on delete cascade,
  audio_id text not null,
  label text not null,
  category text not null default 'BASE',
  r2_url text not null,
  content_hash text not null,
  byte_size integer not null check (byte_size > 0),
  active boolean not null default true,
  ordering integer not null default 0,
  catalog_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index audio_manifests_restaurant_audio_version_idx
  on public.audio_manifests (restaurant_id, audio_id, catalog_version);

create index audio_manifests_restaurant_active_idx
  on public.audio_manifests (restaurant_id, active)
  where active = true;

alter table public.audio_manifests enable row level security;
revoke all on public.audio_manifests from anon, authenticated;

-- Service-role reads for manifest fetch
grant select on public.audio_manifests to authenticated;
create policy "crew reads restaurant manifests"
  on public.audio_manifests for select to authenticated
  using (true);
