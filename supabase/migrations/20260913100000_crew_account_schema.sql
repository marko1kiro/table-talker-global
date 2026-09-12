-- Poin 3: crew identity = akun email (auth.users uid) + pairing email<->resto.
-- Spec: docs/superpowers/specs/2026-09-13-poin-3-crew-account-login-design.md

create table public.crew_accounts (
  auth_uid uuid primary key,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  email text not null unique check (position('@' in email) > 1),
  full_name text not null check (char_length(full_name) between 1 and 40),
  status text not null default 'aktif' check (status in ('aktif', 'nonaktif')),
  active_device_hash text check (active_device_hash ~ '^[a-f0-9]{64}$' or active_device_hash is null),
  paired_by uuid references public.manager_accounts (id),
  paired_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index crew_accounts_restaurant_idx on public.crew_accounts (restaurant_id)
  where status = 'aktif';
alter table public.crew_accounts enable row level security;
revoke all on public.crew_accounts from public, anon, authenticated;

create table public.crew_pairing_requests (
  id uuid primary key default gen_random_uuid(),
  auth_uid uuid not null,
  restaurant_id uuid not null references public.restaurants (id) on delete cascade,
  email text not null,
  full_name text not null check (char_length(full_name) between 1 and 40),
  otp_hash text not null check (otp_hash ~ '^[a-f0-9]{64}$'),
  otp_encrypted text not null check (otp_encrypted ~ '^4c494d4551523031[a-f0-9]+$'),
  attempts integer not null default 0 check (attempts between 0 and 5),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'expired')),
  expires_at timestamptz not null,
  decided_by uuid references public.manager_accounts (id),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index crew_pairing_requests_single_pending_idx
  on public.crew_pairing_requests (auth_uid) where status = 'pending';
create index crew_pairing_requests_restaurant_pending_idx
  on public.crew_pairing_requests (restaurant_id, created_at) where status = 'pending';
alter table public.crew_pairing_requests enable row level security;
revoke all on public.crew_pairing_requests from public, anon, authenticated;

-- carrier bayangan untuk Manager/AM (GoTrue uid; tanpa FK)
alter table public.manager_accounts add column auth_user_id uuid;
alter table public.area_manager_accounts add column auth_user_id uuid;

-- jejak identitas pada sesi kerja (row historis tetap null = alur lama)
alter table public.crew_role_sessions add column auth_uid uuid;

-- dead code dari 20260907210000: satu sumber kebenaran provider = config GoTrue
drop function if exists public.is_anonymous_signup_enabled();
drop function if exists public.set_anonymous_signup_enabled(boolean);
drop table if exists public.system_config;
