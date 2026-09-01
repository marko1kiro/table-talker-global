create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  display_name text not null check (char_length(display_name) between 1 and 80),
  is_active boolean not null default true,
  deactivated_reason text,
  catalog_version integer not null default 1 check (catalog_version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index restaurants_code_key on public.restaurants (lower(code));

-- H-03 (2026-09-02): a demo seed row used to be inserted right here. That
-- broke replaying this migration chain against an empty database: by the
-- time execution reached 20260823120000_remove_legacy_restaurant_code.sql,
-- its `UNPROVISIONED_RESTAURANT_CREDENTIALS` guard found this seeded row
-- with no code_hash/code_encrypted/credential_rotated_at populated and
-- raised on every fresh replay (CI, new environments, `supabase db reset`).
-- Demo/dev data now lives exclusively in `supabase/seed.sql`, applied only
-- via `supabase db reset` after every migration (including this one) has
-- already run against the final schema -- never inline in a versioned
-- migration.

alter table public.restaurants enable row level security;
revoke all on public.restaurants from anon, authenticated;
