-- Manager accounts + sessions (see docs/superpowers/specs/
-- 2026-09-04-manager-monitoring-dashboard-design.md). manager_sessions is the
-- manager analogue of role_session_tokens: a bearer token row with a lazily
-- bound auth_user_id for private-channel realtime. Passwords are hashed in the
-- Node server fn (scrypt); the DB only ever stores "saltHex:hashHex".

create table public.manager_accounts (
  id uuid primary key default gen_random_uuid(),
  id_manager text not null,
  password_hash text not null,
  full_name text not null,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  status text not null default 'aktif' check (status in ('aktif','nonaktif')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index manager_accounts_id_manager_key on public.manager_accounts (id_manager);
create index manager_accounts_restaurant_idx on public.manager_accounts (restaurant_id);
alter table public.manager_accounts enable row level security;
revoke all on public.manager_accounts from public, anon, authenticated;

create table public.manager_sessions (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references public.manager_accounts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  token_hash text not null unique,
  auth_user_id uuid default auth.uid() references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index manager_sessions_auth_restaurant_idx
  on public.manager_sessions (auth_user_id, restaurant_id)
  where auth_user_id is not null;
alter table public.manager_sessions enable row level security;
revoke all on public.manager_sessions from public, anon, authenticated;
